/**
 * Gadget JSVM lifecycle and script evaluation (see js/jsvm.h).
 *
 * Dynamic code execution runs in the gadget's own JSVM because the host ArkTS
 * runtime forbids evaluation (napi_run_script is a stub and eval/new Function
 * throw "Not support eval..."). The VM must live on the host JS thread: the
 * OHOS V8 build relies on thread-local runtime state that only the app's JS
 * thread has (creating it on a private pthread aborts the process).
 * @Author: jmp0
 */
#include "js/jsvm.h"

#include <vector>

#include "ark_runtime/jsvm.h"
#include "js/module/console.h"
#include "js/module/host_bridge.h"
#include "js/module/patch_bridge.h"
#include "js/module/bridge_utils.h"
#include "common/log.h"
#include "js/jsvm_value.h"
#include "common/mini_json.h"

namespace xpanda {

/**
 * The JSVM instance lives on the host JS thread and is touched only there.
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

/**
 * V8 requires explicit scopes around any value creation in a JSVM env:
 * VM scope -> env scope -> handle scope (closed in reverse). Without them the
 * first CreateStringUtf8 / CreateObject aborts the process.
 */
struct JsvmScopes {
    JSVM_VMScope vmScope = nullptr;
    JSVM_EnvScope envScope = nullptr;
    JSVM_HandleScope handleScope = nullptr;
    bool ok = false;

    JsvmScopes(JSVM_VM vm, JSVM_Env env) : vm(vm), env(env) {
        if (vm == nullptr || env == nullptr) return;
        ok = OH_JSVM_OpenVMScope(vm, &vmScope) == JSVM_OK
            && OH_JSVM_OpenEnvScope(env, &envScope) == JSVM_OK
            && OH_JSVM_OpenHandleScope(env, &handleScope) == JSVM_OK;
    }

    ~JsvmScopes() {
        if (handleScope != nullptr) OH_JSVM_CloseHandleScope(env, handleScope);
        if (envScope != nullptr) OH_JSVM_CloseEnvScope(env, envScope);
        if (vmScope != nullptr) OH_JSVM_CloseVMScope(vm, vmScope);
    }

    JsvmScopes(const JsvmScopes&) = delete;
    JsvmScopes& operator=(const JsvmScopes&) = delete;

private:
    JSVM_VM vm = nullptr;
    JSVM_Env env = nullptr;
};

bool ensureJsvm(std::string* error) {
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
    {
        // Creating values (the console object/functions) requires the full scope chain,
        // even though CreateVM/CreateEnv themselves work without it.
        JsvmScopes scopes(g_jsvm.vm, g_jsvm.env);
        if (!scopes.ok) {
            GADGET_LOG_ERROR("failed to open jsvm scopes for the console bridge");
        } else if (!installConsole(g_jsvm.env)) {
            GADGET_LOG_ERROR("failed to install the console bridge (console.* will be unavailable)");
        }
        if (scopes.ok && !installHostBridge(g_jsvm.env)) {
            GADGET_LOG_ERROR("failed to install the host globalThis bridge");
        }
    }
    g_jsvm.ready = true;
    GADGET_LOG_INFO("jsvm runtime ready (v8 on the host JS thread)");
    return true;
}

void destroyJsvm() {
    if (!g_jsvm.ready) return;
    // Restore patched host methods before their JSVM references die with the VM.
    releasePatchHooks(g_jsvm.env);
    releaseHostModules();
    OH_JSVM_DestroyEnv(g_jsvm.env);
    OH_JSVM_DestroyVM(g_jsvm.vm);
    g_jsvm.env = nullptr;
    g_jsvm.vm = nullptr;
    g_jsvm.ready = false;
    // allow the next evaluation to create a fresh VM (used by the reset command)
    g_jsvm.tried = false;
    g_jsvm.error.clear();
}

bool evaluateInJsvm(const std::string& code, std::string* valueJson, std::string* error) {
    std::string runtimeError;
    if (!ensureJsvm(&runtimeError)) {
        *error = runtimeError;
        return false;
    }
    JSVM_Env env = g_jsvm.env;
    JsvmScopes scopes(g_jsvm.vm, g_jsvm.env);
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

bool callJsvmPatch(JSVM_Ref fnRef, int instanceId, int originalId,
                   const std::string& taggedArgs,
                   std::string* taggedResult, std::string* error) {
    if (!g_jsvm.ready || g_jsvm.env == nullptr || g_jsvm.vm == nullptr) {
        if (error) *error = "jsvm runtime is not ready";
        return false;
    }
    JSVM_Env env = g_jsvm.env;
    JsvmScopes scopes(g_jsvm.vm, env);
    if (!scopes.ok) {
        if (error) *error = "failed to open jsvm scopes";
        return false;
    }

    JSVM_Value fn = nullptr;
    if (OH_JSVM_GetReferenceValue(env, fnRef, &fn) != JSVM_OK || fn == nullptr) {
        if (error) *error = "patch: replacement reference is dead";
        return false;
    }

    JSVM_Value global = nullptr;
    JSVM_Value arkts = nullptr;
    JSVM_Value patchThis = nullptr;
    JSVM_Value decodeTags = nullptr;
    JSVM_Value tagResult = nullptr;
    if (OH_JSVM_GetGlobal(env, &global) != JSVM_OK || global == nullptr
        || OH_JSVM_GetNamedProperty(env, global, "ArkTS", &arkts) != JSVM_OK || arkts == nullptr
        || OH_JSVM_GetNamedProperty(env, arkts, "__decodeTags", &decodeTags) != JSVM_OK
        || decodeTags == nullptr
        || OH_JSVM_GetNamedProperty(env, arkts, "__tagResult", &tagResult) != JSVM_OK
        || tagResult == nullptr) {
        if (error) *error = "patch: tagged value helpers are unavailable";
        return false;
    }

    JSVM_Value thisProxy = nullptr;
    if (instanceId > 0) {
        if (OH_JSVM_GetNamedProperty(env, arkts, "__patchThis", &patchThis) != JSVM_OK
            || patchThis == nullptr) {
            if (error) *error = "patch: ArkTS.__patchThis is unavailable";
            return false;
        }
        JSVM_Value idValue = nullptr;
        JSVM_Value originalValue = nullptr;
        if (OH_JSVM_CreateInt32(env, instanceId, &idValue) != JSVM_OK
            || OH_JSVM_CreateInt32(env, originalId, &originalValue) != JSVM_OK) {
            if (error) *error = "patch: failed to create instance ids";
            return false;
        }
        JSVM_Value thisArgs[2] = {idValue, originalValue};
        if (OH_JSVM_CallFunction(env, arkts, patchThis, 2, thisArgs, &thisProxy) != JSVM_OK
            || thisProxy == nullptr) {
            clearJsvmException(env, error);
            if (error && error->empty()) *error = "patch: failed to create this proxy";
            return false;
        }
    } else {
        OH_JSVM_GetUndefined(env, &thisProxy);
    }

    JSVM_Value argsSource = createString(env, taggedArgs);
    JSVM_Value decodedArgs = nullptr;
    if (argsSource == nullptr
        || OH_JSVM_CallFunction(env, arkts, decodeTags, 1, &argsSource, &decodedArgs) != JSVM_OK
        || decodedArgs == nullptr) {
        clearJsvmException(env, error);
        if (error && error->empty()) *error = "patch: failed to decode arguments";
        return false;
    }
    uint32_t argc = 0;
    if (OH_JSVM_GetArrayLength(env, decodedArgs, &argc) != JSVM_OK) {
        if (error) *error = "patch: failed to read argument count";
        return false;
    }
    std::vector<JSVM_Value> argv(argc);
    for (uint32_t i = 0; i < argc; i++) {
        if (OH_JSVM_GetElement(env, decodedArgs, i, &argv[i]) != JSVM_OK) argv[i] = nullptr;
    }

    JSVM_Value result = nullptr;
    if (OH_JSVM_CallFunction(env, thisProxy, fn, argc, argv.empty() ? nullptr : argv.data(),
                             &result) != JSVM_OK) {
        clearJsvmException(env, error);
        if (error && error->empty()) *error = "patch: replacement threw";
        return false;
    }

    JSVM_Value tagged = nullptr;
    if (OH_JSVM_CallFunction(env, arkts, tagResult, 1, &result, &tagged) != JSVM_OK
        || tagged == nullptr) {
        clearJsvmException(env, error);
        if (error && error->empty()) *error = "patch: failed to encode result";
        return false;
    }
    if (!jsvmValueToText(env, tagged, taggedResult)) {
        if (error) *error = "patch: failed to read tagged result";
        return false;
    }
    return true;
}

bool runJsvmProbe(std::string* valueJson, std::string* error) {
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

} // namespace xpanda
