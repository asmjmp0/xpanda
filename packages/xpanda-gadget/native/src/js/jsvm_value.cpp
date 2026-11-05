/**
 * JSVM value/exception conversion helpers (see js/jsvm_value.h).
 * @Author: jmp0
 */
#include "js/jsvm_value.h"

#include "common/mini_json.h"

namespace xpanda {

bool jsvmValueToText(JSVM_Env env, JSVM_Value value, std::string* out) {
    size_t size = 0;
    if (OH_JSVM_GetValueStringUtf8(env, value, nullptr, 0, &size) != JSVM_OK) return false;
    std::string buffer(size, '\0');
    size_t copied = 0;
    if (OH_JSVM_GetValueStringUtf8(env, value, buffer.data(), buffer.size() + 1, &copied) != JSVM_OK) return false;
    buffer.resize(copied);
    *out = std::move(buffer);
    return true;
}

bool jsvmValueToJson(JSVM_Env env, JSVM_Value value, std::string* out) {
    JSVM_ValueType type = JSVM_UNDEFINED;
    if (OH_JSVM_Typeof(env, value, &type) != JSVM_OK
        || type == JSVM_UNDEFINED || type == JSVM_FUNCTION || type == JSVM_SYMBOL) {
        *out = "null";
        return true;
    }
    JSVM_Value json = nullptr;
    if (OH_JSVM_JsonStringify(env, value, &json) == JSVM_OK && json != nullptr) {
        std::string text;
        if (jsvmValueToText(env, json, &text) && !text.empty() && text != "undefined") {
            *out = std::move(text);
            return true;
        }
    }
    // JSON.stringify throws on circular structures (e.g. globalThis.self = globalThis):
    // drop the pending exception before the string fallback.
    bool pending = false;
    if (OH_JSVM_IsExceptionPending(env, &pending) == JSVM_OK && pending) {
        JSVM_Value ignored = nullptr;
        OH_JSVM_GetAndClearLastException(env, &ignored);
    }
    // Non-stringifyable values (BigInt, circular structures): render a quoted string.
    JSVM_Value text = nullptr;
    if (OH_JSVM_CoerceToString(env, value, &text) == JSVM_OK && text != nullptr) {
        std::string raw;
        if (jsvmValueToText(env, text, &raw) && raw != "undefined") {
            *out = MiniJson::escape(raw);
            return true;
        }
    }
    *out = "null";
    return false;
}

void clearJsvmException(JSVM_Env env, std::string* text) {
    bool pending = false;
    if (OH_JSVM_IsExceptionPending(env, &pending) != JSVM_OK || !pending) return;
    JSVM_Value exception = nullptr;
    if (OH_JSVM_GetAndClearLastException(env, &exception) != JSVM_OK || exception == nullptr) return;
    JSVM_Value message = nullptr;
    if (OH_JSVM_CoerceToString(env, exception, &message) == JSVM_OK && message != nullptr) {
        jsvmValueToText(env, message, text);
    }
}

} // namespace xpanda
