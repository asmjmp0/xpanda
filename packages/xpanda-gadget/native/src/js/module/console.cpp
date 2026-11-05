/**
 * console.* bridge for the gadget JSVM (see js/console.h).
 *
 * The gadget VM is a bare V8 environment: V8 itself has no `console` global
 * (embedders provide it), so evaluated scripts would fail with
 * "console is not defined". Install a small console whose methods stream every
 * call to the socket clients and mirror the same line to hilog. This is what
 * makes `gadget shell` / `gadget file` behave like a normal JS REPL.
 * @Author: jmp0
 */
#include "js/module/console.h"

#include <string>

#include "common/context.h"
#include "common/log.h"
#include "js/jsvm_value.h"
#include "common/mini_json.h"

namespace xpanda {

/** Human-readable rendering of one console argument. */
static std::string formatConsoleValue(JSVM_Env env, JSVM_Value value) {
    JSVM_ValueType type = JSVM_UNDEFINED;
    if (OH_JSVM_Typeof(env, value, &type) != JSVM_OK) return "";
    if (type == JSVM_STRING) {
        std::string text;
        jsvmValueToText(env, value, &text);
        return text;
    }
    if (type == JSVM_UNDEFINED) return "undefined";
    if (type == JSVM_NULL) return "null";
    if (type == JSVM_SYMBOL) return "Symbol";
    if (type == JSVM_NUMBER || type == JSVM_BOOLEAN || type == JSVM_BIGINT) {
        JSVM_Value text = nullptr;
        std::string out;
        if (OH_JSVM_CoerceToString(env, value, &text) == JSVM_OK && text != nullptr) {
            jsvmValueToText(env, text, &out);
        }
        return out;
    }
    if (type == JSVM_FUNCTION) {
        JSVM_Value nameValue = nullptr;
        std::string name;
        if (OH_JSVM_GetNamedProperty(env, value, "name", &nameValue) == JSVM_OK && nameValue != nullptr) {
            jsvmValueToText(env, nameValue, &name);
        }
        return name.empty() ? "[Function]" : ("[Function: " + name + "]");
    }
    if (type == JSVM_OBJECT) {
        // Errors stringify to "{}"; their stack is what a developer expects to see.
        JSVM_Value stack = nullptr;
        if (OH_JSVM_GetNamedProperty(env, value, "stack", &stack) == JSVM_OK && stack != nullptr) {
            JSVM_ValueType stackType = JSVM_UNDEFINED;
            if (OH_JSVM_Typeof(env, stack, &stackType) == JSVM_OK && stackType == JSVM_STRING) {
                std::string text;
                if (jsvmValueToText(env, stack, &text) && !text.empty()) return text;
            }
        }
        bool pending = false;
        if (OH_JSVM_IsExceptionPending(env, &pending) == JSVM_OK && pending) {
            JSVM_Value ignored = nullptr;
            OH_JSVM_GetAndClearLastException(env, &ignored);
        }
    }
    JSVM_Value json = nullptr;
    if (OH_JSVM_JsonStringify(env, value, &json) == JSVM_OK && json != nullptr) {
        JSVM_ValueType jsonType = JSVM_UNDEFINED;
        if (OH_JSVM_Typeof(env, json, &jsonType) == JSVM_OK && jsonType == JSVM_STRING) {
            std::string text;
            if (jsvmValueToText(env, json, &text) && text != "undefined") return text;
        }
    } else {
        bool pending = false;
        if (OH_JSVM_IsExceptionPending(env, &pending) == JSVM_OK && pending) {
            JSVM_Value ignored = nullptr;
            OH_JSVM_GetAndClearLastException(env, &ignored);
        }
    }
    // BigInt / circular structures / values with a throwing toJSON: fall back to String().
    JSVM_Value text = nullptr;
    std::string out;
    if (OH_JSVM_CoerceToString(env, value, &text) == JSVM_OK && text != nullptr) {
        jsvmValueToText(env, text, &out);
    } else {
        bool pending = false;
        if (OH_JSVM_IsExceptionPending(env, &pending) == JSVM_OK && pending) {
            JSVM_Value ignored = nullptr;
            OH_JSVM_GetAndClearLastException(env, &ignored);
        }
    }
    return out;
}

/** Broadcast one console line to every client and mirror it to hilog. */
static void emitConsoleLine(const std::string& level, const std::string& text) {
    GADGET_LOG_INFO("console.%{public}s: %{public}s", level.c_str(), text.c_str());
    if (!socketServer().isRunning()) return;
    socketServer().broadcast("{\"type\":\"console\",\"level\":" + MiniJson::escape(level)
        + ",\"text\":" + MiniJson::escape(text) + "}");
}

static constexpr size_t kMaxConsoleArgs = 32;

/** Shared console method body: format every argument and emit one line. */
static JSVM_Value consoleWrite(JSVM_Env env, JSVM_CallbackInfo info, const char* level, bool assertion) {
    JSVM_Value undefined = nullptr;
    OH_JSVM_GetUndefined(env, &undefined);
    JSVM_Value argv[kMaxConsoleArgs];
    size_t argc = kMaxConsoleArgs;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK) argc = 0;
    size_t first = 0;
    if (assertion) {
        bool passed = false;
        if (argc > 0) {
            JSVM_Value boolValue = nullptr;
            if (OH_JSVM_CoerceToBool(env, argv[0], &boolValue) == JSVM_OK && boolValue != nullptr) {
                OH_JSVM_GetValueBool(env, boolValue, &passed);
            }
        }
        if (passed) return undefined;
        first = 1;
    }
    std::string text = assertion ? "Assertion failed" : "";
    for (size_t i = first; i < argc; i++) {
        if (!text.empty()) text.push_back(' ');
        text += formatConsoleValue(env, argv[i]);
    }
    emitConsoleLine(level, text);
    return undefined;
}

static JSVM_Value JSVM_CDECL ConsoleLogCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    return consoleWrite(env, info, "log", false);
}
static JSVM_Value JSVM_CDECL ConsoleInfoCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    return consoleWrite(env, info, "info", false);
}
static JSVM_Value JSVM_CDECL ConsoleDebugCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    return consoleWrite(env, info, "debug", false);
}
static JSVM_Value JSVM_CDECL ConsoleWarnCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    return consoleWrite(env, info, "warn", false);
}
static JSVM_Value JSVM_CDECL ConsoleErrorCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    return consoleWrite(env, info, "error", false);
}
static JSVM_Value JSVM_CDECL ConsoleTraceCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    return consoleWrite(env, info, "trace", false);
}
static JSVM_Value JSVM_CDECL ConsoleAssertCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    return consoleWrite(env, info, "error", true);
}

static JSVM_CallbackStruct g_consoleLogCallback{ConsoleLogCallback, nullptr};
static JSVM_CallbackStruct g_consoleInfoCallback{ConsoleInfoCallback, nullptr};
static JSVM_CallbackStruct g_consoleDebugCallback{ConsoleDebugCallback, nullptr};
static JSVM_CallbackStruct g_consoleWarnCallback{ConsoleWarnCallback, nullptr};
static JSVM_CallbackStruct g_consoleErrorCallback{ConsoleErrorCallback, nullptr};
static JSVM_CallbackStruct g_consoleTraceCallback{ConsoleTraceCallback, nullptr};
static JSVM_CallbackStruct g_consoleAssertCallbackFunc{ConsoleAssertCallback, nullptr};

bool installConsole(JSVM_Env env) {
    JSVM_Value consoleObject = nullptr;
    if (OH_JSVM_CreateObject(env, &consoleObject) != JSVM_OK || consoleObject == nullptr) return false;
    const struct {
        const char* name;
        JSVM_Callback callback;
    } methods[] = {
        {"log", &g_consoleLogCallback},
        {"info", &g_consoleInfoCallback},
        {"debug", &g_consoleDebugCallback},
        {"warn", &g_consoleWarnCallback},
        {"error", &g_consoleErrorCallback},
        {"trace", &g_consoleTraceCallback},
        {"dir", &g_consoleLogCallback},
        {"assert", &g_consoleAssertCallbackFunc},
    };
    for (const auto& method : methods) {
        JSVM_Value function = nullptr;
        if (OH_JSVM_CreateFunction(env, method.name, JSVM_AUTO_LENGTH, method.callback, &function) == JSVM_OK
            && function != nullptr) {
            OH_JSVM_SetNamedProperty(env, consoleObject, method.name, function);
        }
    }
    JSVM_Value global = nullptr;
    if (OH_JSVM_GetGlobal(env, &global) != JSVM_OK || global == nullptr) return false;
    return OH_JSVM_SetNamedProperty(env, global, "console", consoleObject) == JSVM_OK;
}

} // namespace xpanda
