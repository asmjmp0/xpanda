/**
 * xpanda-gadget: a Frida-Gadget-style NAPI library for HarmonyOS.
 *
 * Loaded by the injected bootstrap (`import gadget from "libxpanda_gadget.so"`),
 * registered through napi_module_register in a dlopen constructor, and exposes:
 *   - start({port?}) / stop()               socket lifecycle
 *   - info()                                pid / endpoint / version / uptime
 *   - send(value)                           push a message to every socket client
 *   - poll()                                drain messages sent by socket clients
 *   - executeJs(code)                       evaluate JavaScript
 *
 * JS execution runs in the HOST ArkTS runtime through napi_run_script — no second
 * engine is created. The socket thread hops onto the JS thread through a
 * napi_threadsafe_function, so evaluated code shares globals/modules with the app.
 * @Author: jmp0
 */
#include <unistd.h>

#include <condition_variable>
#include <cstring>
#include <mutex>
#include <string>

#include "napi/native_api.h"
#include "ark_runtime/jsvm.h"
#include "mini_json.h"
#include "socket_server.h"

#if __has_include(<node_api.h>)
#include <node_api.h>
#endif

#if __has_include(<hilog/log.h>)
#include <hilog/log.h>
#define GADGET_LOG_INFO(...) \
    ((void)OH_LOG_Print(LOG_APP, LOG_INFO, 0x3201, "xpanda-gadget", __VA_ARGS__))
#define GADGET_LOG_ERROR(...) \
    ((void)OH_LOG_Print(LOG_APP, LOG_ERROR, 0x3201, "xpanda-gadget", __VA_ARGS__))
#else
#define GADGET_LOG_INFO(...) do {} while (0)
#define GADGET_LOG_ERROR(...) do {} while (0)
#endif

namespace xpanda {

inline constexpr int kJsTimeoutMs = 10000;

static SocketServer g_server;
static napi_threadsafe_function g_jsThreadFunction = nullptr;

// ------------------------------------------------------------------ napi helpers

/** Call global JSON.<method>(input) — used to (de)serialize messages without extra deps. */
static bool callJsonMethod(napi_env env, const char* method, napi_value input, napi_value* out) {
    napi_value global = nullptr;
    napi_value json = nullptr;
    napi_value fn = nullptr;
    if (napi_get_global(env, &global) != napi_ok) return false;
    if (napi_get_named_property(env, global, "JSON", &json) != napi_ok) return false;
    if (napi_get_named_property(env, json, method, &fn) != napi_ok) return false;
    return napi_call_function(env, global, fn, 1, &input, out) == napi_ok;
}

static std::string napiValueToText(napi_env env, napi_value value) {
    size_t size = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok) return "";
    std::string out(size, '\0');
    size_t copied = 0;
    if (napi_get_value_string_utf8(env, value, out.data(), out.size() + 1, &copied) != napi_ok) return "";
    out.resize(copied);
    return out;
}

/** JSON-stringify a JS value; non-stringifyable values fall back to a JSON string. */
static bool napiValueToJson(napi_env env, napi_value value, std::string* out) {
    napi_value json = nullptr;
    if (callJsonMethod(env, "stringify", value, &json) && json != nullptr) {
        napi_valuetype type = napi_undefined;
        if (napi_typeof(env, json, &type) == napi_ok && type == napi_string) {
            *out = napiValueToText(env, json);
            return true;
        }
    }
    // undefined / function / circular structure: render as a JSON string
    napi_value text = nullptr;
    if (napi_coerce_to_string(env, value, &text) == napi_ok && text != nullptr) {
        *out = MiniJson::escape(napiValueToText(env, text));
        return true;
    }
    *out = "null";
    return false;
}

static napi_value napiValueFromJson(napi_env env, const std::string& json) {
    napi_value jsonText = nullptr;
    napi_value parsed = nullptr;
    if (napi_create_string_utf8(env, json.data(), json.size(), &jsonText) == napi_ok
        && callJsonMethod(env, "parse", jsonText, &parsed)) {
        return parsed;
    }
    return nullptr;
}

/**
 * Dynamic code execution runs in the gadget's own JSVM because the host ArkTS
 * runtime forbids evaluation (napi_run_script is a stub and eval/new Function
 * throw "Not support eval..."). The VM must live on the host JS thread — see
 * ensureJsvm.
 */

// ------------------------------------------------------------------ JSVM runtime (JS thread only)

/**
 * The JSVM instance lives on the host JS thread and is touched only there.
 * Creating it on a private pthread aborts the process: the OHOS V8 build relies
 * on thread-local runtime state that only the app's JS thread has.
 * libjsvm.so is a link-time dependency (see native/build.sh).
 */
struct JsvmRuntime {
    bool tried = false;
    bool ready = false;
    std::string error;
    JSVM_VM vm = nullptr;
    JSVM_Env env = nullptr;
};

static JsvmRuntime g_jsvm;

/** Create VM/Env on the calling (JS) thread. Idempotent. */
static bool ensureJsvm(std::string* error) {
    if (g_jsvm.ready) return true;
    if (g_jsvm.tried) {
        if (error) *error = g_jsvm.error;
        return false;
    }
    g_jsvm.tried = true;

    // interpreter-only: OHOS V8 uses JitFort for W^X and the JIT permission
    // device (/dev/xpm) is absent on some images; --jitless keeps the VM portable.
    static char flagProgram[] = "xpanda-gadget";
    static char flagJitless[] = "--jitless";
    static char* flagArgv[] = {flagProgram, flagJitless, nullptr};
    static int flagArgc = 2;
    JSVM_InitOptions initOptions{};
    initOptions.argc = &flagArgc;
    initOptions.argv = flagArgv;
    initOptions.removeFlags = false;
    OH_JSVM_Init(&initOptions); // status ignored: already-initialized VMs are fine

    JSVM_CreateVMOptions vmOptions{};
    if (OH_JSVM_CreateVM(&vmOptions, &g_jsvm.vm) != JSVM_OK || g_jsvm.vm == nullptr) {
        g_jsvm.error = "OH_JSVM_CreateVM failed";
        if (error) *error = g_jsvm.error;
        return false;
    }
    if (OH_JSVM_CreateEnv(g_jsvm.vm, 0, nullptr, &g_jsvm.env) != JSVM_OK || g_jsvm.env == nullptr) {
        OH_JSVM_DestroyVM(g_jsvm.vm);
        g_jsvm.vm = nullptr;
        g_jsvm.error = "OH_JSVM_CreateEnv failed";
        if (error) *error = g_jsvm.error;
        return false;
    }
    g_jsvm.ready = true;
    GADGET_LOG_INFO("jsvm runtime ready (v8 on the host JS thread)");
    return true;
}

static void destroyJsvm() {
    if (!g_jsvm.ready) return;
    OH_JSVM_DestroyEnv(g_jsvm.env);
    OH_JSVM_DestroyVM(g_jsvm.vm);
    g_jsvm.env = nullptr;
    g_jsvm.vm = nullptr;
    g_jsvm.ready = false;
    // allow the next evaluation to create a fresh VM (used by the reset command)
    g_jsvm.tried = false;
    g_jsvm.error.clear();
}

/**
 * V8 requires explicit scopes around any value creation in a JSVM env:
 * VM scope -> env scope -> handle scope (closed in reverse). Without them the
 * first CreateStringUtf8 aborts the process.
 */
struct JsvmScopes {
    JSVM_VMScope vmScope = nullptr;
    JSVM_EnvScope envScope = nullptr;
    JSVM_HandleScope handleScope = nullptr;
    bool ok = false;

    JsvmScopes() {
        if (!g_jsvm.ready) return;
        ok = OH_JSVM_OpenVMScope(g_jsvm.vm, &vmScope) == JSVM_OK
            && OH_JSVM_OpenEnvScope(g_jsvm.env, &envScope) == JSVM_OK
            && OH_JSVM_OpenHandleScope(g_jsvm.env, &handleScope) == JSVM_OK;
    }

    ~JsvmScopes() {
        if (handleScope != nullptr) OH_JSVM_CloseHandleScope(g_jsvm.env, handleScope);
        if (envScope != nullptr) OH_JSVM_CloseEnvScope(g_jsvm.env, envScope);
        if (vmScope != nullptr) OH_JSVM_CloseVMScope(g_jsvm.vm, vmScope);
    }
};

/** Read a JSVM value as raw UTF-8 text (no JSON quoting). */
static bool jsvmValueToText(JSVM_Env env, JSVM_Value value, std::string* out) {
    size_t size = 0;
    if (OH_JSVM_GetValueStringUtf8(env, value, nullptr, 0, &size) != JSVM_OK) return false;
    std::string buffer(size, '\0');
    size_t copied = 0;
    if (OH_JSVM_GetValueStringUtf8(env, value, buffer.data(), buffer.size() + 1, &copied) != JSVM_OK) return false;
    buffer.resize(copied);
    *out = std::move(buffer);
    return true;
}

/** Stringify a JSVM value into valid JSON text (undefined/function/symbol → null). */
static bool jsvmValueToJson(JSVM_Env env, JSVM_Value value, std::string* out) {
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

static void clearJsvmException(JSVM_Env env, std::string* text) {
    bool pending = false;
    if (OH_JSVM_IsExceptionPending(env, &pending) != JSVM_OK || !pending) return;
    JSVM_Value exception = nullptr;
    if (OH_JSVM_GetAndClearLastException(env, &exception) != JSVM_OK || exception == nullptr) return;
    JSVM_Value message = nullptr;
    if (OH_JSVM_CoerceToString(env, exception, &message) == JSVM_OK && message != nullptr) {
        jsvmValueToText(env, message, text);
    }
}

/**
 * Runs `code` in the gadget's JSVM (created on the host JS thread) and
 * stringifies the result. Must be called on the JS thread.
 */
static bool evaluateInJsvm(const std::string& code, std::string* valueJson, std::string* error) {
    std::string runtimeError;
    if (!ensureJsvm(&runtimeError)) {
        *error = runtimeError;
        return false;
    }
    JSVM_Env env = g_jsvm.env;
    JsvmScopes scopes;
    if (!scopes.ok) {
        *error = "failed to open jsvm scopes";
        return false;
    }
    GADGET_LOG_INFO("eval: runtime ready, creating source string");
    JSVM_Value source = nullptr;
    if (OH_JSVM_CreateStringUtf8(env, code.data(), code.size(), &source) != JSVM_OK || source == nullptr) {
        *error = "failed to create script string";
        return false;
    }
    GADGET_LOG_INFO("eval: compiling script");
    JSVM_Script script = nullptr;
    if (OH_JSVM_CompileScript(env, source, nullptr, 0, false, nullptr, &script) != JSVM_OK || script == nullptr) {
        // A bare object literal / expression that the parser reads as a block
        // (`{"a":1}`) is a SyntaxError in statement position. REPLs retry such
        // input as a parenthesized expression; keep the original error if that fails.
        std::string statementError;
        clearJsvmException(env, &statementError);
        std::string expression = "(" + code + ")";
        JSVM_Value expressionSource = nullptr;
        bool retried = OH_JSVM_CreateStringUtf8(env, expression.data(), expression.size(), &expressionSource) == JSVM_OK
            && expressionSource != nullptr
            && OH_JSVM_CompileScript(env, expressionSource, nullptr, 0, false, nullptr, &script) == JSVM_OK
            && script != nullptr;
        if (!retried) {
            std::string expressionError;
            clearJsvmException(env, &expressionError);
            *error = statementError.empty()
                ? (expressionError.empty() ? "compile failed" : expressionError)
                : statementError;
            GADGET_LOG_ERROR("eval: compile failed: %{public}s", error->c_str());
            return false;
        }
        GADGET_LOG_INFO("eval: retried as parenthesized expression");
    }
    GADGET_LOG_INFO("eval: running script");
    JSVM_Value result = nullptr;
    if (OH_JSVM_RunScript(env, script, &result) != JSVM_OK) {
        clearJsvmException(env, error);
        if (error->empty()) *error = "runtime error";
        GADGET_LOG_ERROR("eval: run failed: %{public}s", error->c_str());
        return false;
    }
    GADGET_LOG_INFO("eval: script completed");
    jsvmValueToJson(env, result, valueJson);
    return true;
}

/** Compatibility wrapper: NAPI callbacks already run on the JS thread. */
static bool runScriptInEnv(napi_env env, const std::string& code, std::string* valueJson, std::string* error) {
    (void)env;
    return evaluateInJsvm(code, valueJson, error);
}

/**
 * JSVM health probe (diagnostic for the `probe` socket request): ensures the
 * gadget's JSVM runtime exists on the JS thread and reports it.
 */
static bool runJsvmProbe(std::string* valueJson, std::string* error) {
    std::string runtimeError;
    bool ok = ensureJsvm(&runtimeError);
    std::string step = ok
        ? "jsvm runtime ready (v8 on the host JS thread)"
        : ("jsvm unavailable: " + runtimeError);
    JSVM_VMInfo info{};
    if (OH_JSVM_GetVMInfo(&info) == JSVM_OK) {
        step += std::string(" engine=") + (info.engine ? info.engine : "?")
            + " version=" + (info.version ? info.version : "?");
    }
    GADGET_LOG_INFO("jsvm-probe: %{public}s", step.c_str());
    *valueJson = "[" + MiniJson::escape(step) + "]";
    if (!ok) *error = runtimeError;
    return ok;
}

// ------------------------------------------------------------------ JS thread hop

/** One queued execution; owned by the waiting thread until completion. */
struct JsJob {
    std::string code;
    std::string valueJson;
    std::string error;
    bool ok = false;
    bool done = false;
    bool abandoned = false;
    bool probe = false;
    bool reset = false;
    std::mutex mutex;
    std::condition_variable cv;
};

/** Thread-safe-function callback: runs on the host JS thread. */
static void CallJs(napi_env env, napi_value jsCallback, void* context, void* data) {
    auto* job = static_cast<JsJob*>(data);
    std::string valueJson;
    std::string error;
    bool ok = false;
    if (job->probe) {
        ok = runJsvmProbe(&valueJson, &error);
    } else if (job->reset) {
        destroyJsvm();
        valueJson = "null";
        ok = true;
    } else if (env != nullptr) {
        ok = runScriptInEnv(env, job->code, &valueJson, &error);
    } else {
        error = "js env released";
    }
    bool abandoned = false;
    {
        std::lock_guard<std::mutex> lock(job->mutex);
        job->ok = ok;
        job->valueJson = std::move(valueJson);
        job->error = std::move(error);
        job->done = true;
        abandoned = job->abandoned;
    }
    job->cv.notify_all();
    if (abandoned) delete job;
}

/** Socket-thread entry: hop to the JS thread and wait for the result. */
static bool executeOnJsThread(const std::string& code, std::string* valueJson, std::string* error,
                              int timeoutMs, std::string* err) {
    if (g_jsThreadFunction == nullptr) {
        if (err) *err = "js runtime not attached";
        return false;
    }
    auto* job = new JsJob();
    job->code = code;
    if (napi_call_threadsafe_function(g_jsThreadFunction, job, napi_tsfn_blocking) != napi_ok) {
        delete job;
        if (err) *err = "thread-safe call to the js thread failed";
        return false;
    }

    std::unique_lock<std::mutex> lock(job->mutex);
    bool finished = job->cv.wait_for(lock, std::chrono::milliseconds(timeoutMs),
                                     [job]() { return job->done; });
    if (!finished) {
        // the JS side may still complete and delete this job later
        job->abandoned = true;
        if (err) *err = "js execution timed out";
        return false;
    }
    bool ok = job->ok;
    if (ok) {
        if (valueJson) *valueJson = job->valueJson;
    } else {
        if (error) *error = job->error;
    }
    lock.unlock();
    delete job;
    return ok;
}

/** Socket-thread entry for the `probe` request: run the JSVM diagnosis on the JS thread. */
static bool probeOnJsThread(std::string* report, std::string* error) {
    if (g_jsThreadFunction == nullptr) {
        if (error) *error = "js runtime not attached";
        return false;
    }
    auto* job = new JsJob();
    job->probe = true;
    if (napi_call_threadsafe_function(g_jsThreadFunction, job, napi_tsfn_blocking) != napi_ok) {
        delete job;
        if (error) *error = "thread-safe call to the js thread failed";
        return false;
    }
    std::unique_lock<std::mutex> lock(job->mutex);
    bool finished = job->cv.wait_for(lock, std::chrono::milliseconds(20000),
                                     [job]() { return job->done; });
    if (!finished) {
        job->abandoned = true;
        if (error) *error = "jsvm probe timed out (process likely died inside CreateVM)";
        return false;
    }
    bool ok = job->ok;
    if (report) *report = job->valueJson;
    if (!ok && error) *error = job->error;
    lock.unlock();
    delete job;
    return ok;
}

/** Socket-thread entry for the `reset` request: destroy the VM on the JS thread. */
static bool resetOnJsThread(std::string* error) {
    if (g_jsThreadFunction == nullptr) {
        if (error) *error = "js runtime not attached";
        return false;
    }
    auto* job = new JsJob();
    job->reset = true;
    if (napi_call_threadsafe_function(g_jsThreadFunction, job, napi_tsfn_blocking) != napi_ok) {
        delete job;
        if (error) *error = "thread-safe call to the js thread failed";
        return false;
    }
    std::unique_lock<std::mutex> lock(job->mutex);
    bool finished = job->cv.wait_for(lock, std::chrono::milliseconds(kJsTimeoutMs),
                                     [job]() { return job->done; });
    if (!finished) {
        job->abandoned = true;
        if (error) *error = "jsvm reset timed out";
        return false;
    }
    bool ok = job->ok;
    if (!ok && error) *error = job->error;
    lock.unlock();
    delete job;
    return ok;
}

// ------------------------------------------------------------------ exported functions

static napi_value Start(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

    int port = kDefaultPort;
    if (argc >= 1 && argv[0] != nullptr) {
        napi_value portValue = nullptr;
        if (napi_get_named_property(env, argv[0], "port", &portValue) == napi_ok && portValue != nullptr) {
            int32_t requested = 0;
            if (napi_get_value_int32(env, portValue, &requested) == napi_ok && requested > 0) {
                port = requested;
            }
        }
    }

    if (g_jsThreadFunction == nullptr) {
        napi_value resourceName = nullptr;
        napi_create_string_utf8(env, "xpanda-gadget", NAPI_AUTO_LENGTH, &resourceName);
        napi_status status = napi_create_threadsafe_function(
            env, nullptr, nullptr, resourceName, 0, 1, nullptr, nullptr, nullptr, CallJs, &g_jsThreadFunction);
        if (status != napi_ok) {
            g_jsThreadFunction = nullptr;
            g_server.setJsError("napi_create_threadsafe_function failed");
            GADGET_LOG_ERROR("thread-safe function creation failed (%{public}d)", static_cast<int>(status));
        }
    }
    g_server.setJsExecutor(executeOnJsThread);
    g_server.setProbeExecutor(probeOnJsThread);
    g_server.setResetExecutor(resetOnJsThread);

    xpanda::SocketServer::Config config;
    config.name = "xpanda_gadget_" + std::to_string(port);
    std::string error;
    if (!g_server.start(config, &error)) {
        GADGET_LOG_ERROR("start failed: %{public}s", error.c_str());
        napi_throw_error(env, nullptr, ("xpanda-gadget start failed: " + error).c_str());
        return nullptr;
    }
    GADGET_LOG_INFO("started %{public}s js=%{public}d (pid %{public}d)", g_server.endpoint().c_str(),
        g_jsThreadFunction != nullptr ? 1 : 0, static_cast<int>(getpid()));

    napi_value result = nullptr;
    napi_get_boolean(env, true, &result);
    return result;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
    g_server.stop();
    destroyJsvm();
    if (g_jsThreadFunction != nullptr) {
        napi_release_threadsafe_function(g_jsThreadFunction, napi_tsfn_release);
        g_jsThreadFunction = nullptr;
    }
    napi_value undefined = nullptr;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value Info(napi_env env, napi_callback_info info) {
    napi_value object = nullptr;
    napi_create_object(env, &object);
    napi_value pid = nullptr;
    napi_create_int64(env, static_cast<int64_t>(getpid()), &pid);
    napi_set_named_property(env, object, "pid", pid);
    napi_value endpoint = nullptr;
    std::string endpointText = g_server.endpoint();
    napi_create_string_utf8(env, endpointText.data(), endpointText.size(), &endpoint);
    napi_set_named_property(env, object, "endpoint", endpoint);
    napi_value running = nullptr;
    napi_get_boolean(env, g_server.isRunning(), &running);
    napi_set_named_property(env, object, "running", running);
    napi_value jsReady = nullptr;
    napi_get_boolean(env, g_jsThreadFunction != nullptr && g_server.hasJsExecutor(), &jsReady);
    napi_set_named_property(env, object, "js", jsReady);
    if (g_jsThreadFunction == nullptr) {
        std::string jsError = g_server.jsError();
        napi_value jsErrorValue = nullptr;
        napi_create_string_utf8(env, jsError.data(), jsError.size(), &jsErrorValue);
        napi_set_named_property(env, object, "jsError", jsErrorValue);
    }
    napi_value version = nullptr;
    napi_create_string_utf8(env, kGadgetVersion, NAPI_AUTO_LENGTH, &version);
    napi_set_named_property(env, object, "version", version);
    napi_value uptime = nullptr;
    napi_create_int64(env, static_cast<int64_t>(g_server.uptimeMs()), &uptime);
    napi_set_named_property(env, object, "uptimeMs", uptime);
    return object;
}

static napi_value Send(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc >= 1 && argv[0] != nullptr) {
        std::string payload = "null";
        napiValueToJson(env, argv[0], &payload);
        g_server.broadcast("{\"type\":\"msg\",\"payload\":" + payload + "}");
    }
    napi_value undefined = nullptr;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value Poll(napi_env env, napi_callback_info info) {
    std::string message;
    if (!g_server.pollInbox(&message)) {
        napi_value undefined = nullptr;
        napi_get_undefined(env, &undefined);
        return undefined;
    }
    napi_value parsed = napiValueFromJson(env, message);
    if (parsed != nullptr) return parsed;
    napi_value undefined = nullptr;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value ExecuteJs(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 1 || argv[0] == nullptr) {
        napi_throw_error(env, nullptr, "executeJs requires a code string");
        return nullptr;
    }
    std::string code = napiValueToText(env, argv[0]);

    // already on the JS thread: run directly, no hop needed
    std::string valueJson;
    std::string error;
    if (!runScriptInEnv(env, code, &valueJson, &error)) {
        napi_throw_error(env, nullptr, ("executeJs failed: " + error).c_str());
        return nullptr;
    }
    napi_value parsed = napiValueFromJson(env, valueJson);
    if (parsed != nullptr) return parsed;
    napi_value undefined = nullptr;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/** Destroy the JSVM (fresh VM on the next evaluation). Runs on the JS thread. */
static napi_value Reset(napi_env env, napi_callback_info info) {
    destroyJsvm();
    napi_value undefined = nullptr;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value Init(napi_env env, napi_value exports) {
    const napi_property_attributes attrs
        = static_cast<napi_property_attributes>(napi_writable | napi_enumerable | napi_configurable);
    const napi_property_descriptor properties[] = {
        {"start", nullptr, Start, nullptr, nullptr, nullptr, attrs, nullptr},
        {"stop", nullptr, Stop, nullptr, nullptr, nullptr, attrs, nullptr},
        {"reset", nullptr, Reset, nullptr, nullptr, nullptr, attrs, nullptr},
        {"info", nullptr, Info, nullptr, nullptr, nullptr, attrs, nullptr},
        {"send", nullptr, Send, nullptr, nullptr, nullptr, attrs, nullptr},
        {"poll", nullptr, Poll, nullptr, nullptr, nullptr, attrs, nullptr},
        {"executeJs", nullptr, ExecuteJs, nullptr, nullptr, nullptr, attrs, nullptr},
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    return exports;
}

static napi_module g_gadgetModule = {
    NAPI_MODULE_VERSION,
    0,
    "xpanda_gadget.js",
    Init,
    "xpanda_gadget",
    nullptr,
    {nullptr, nullptr, nullptr, nullptr},
};

} // namespace xpanda

extern "C" __attribute__((constructor)) void RegisterXpandaGadgetModule(void) {
    napi_module_register(&xpanda::g_gadgetModule);
}
