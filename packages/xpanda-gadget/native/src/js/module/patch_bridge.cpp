/**
 * Runtime method patching for ArkTS.patch.patchMethod().
 *
 * The replacement function lives in the gadget JSVM, while the patched method
 * lives in the host ArkTS runtime. Installing a patch therefore puts a host
 * NAPI trampoline on the class prototype; when the app calls it, the trampoline
 * calls into the JSVM (jsvm::callJsvmPatch) with a `this` proxy and JSON args.
 * @Author: jmp0
 */
#include "js/module/patch_bridge.h"

#include <string>
#include <vector>

#include "common/log.h"
#include "js/jsvm.h"
#include "js/jsvm_value.h"
#include "js/module/bridge_utils.h"
#include "js/module/napi_bridge.h"
#include "napi/napi_utils.h"

namespace xpanda {

namespace {

/** One installed ArkTS.patch.patchMethod() hook. */
struct PatchHook {
    JSVM_Ref replacement = nullptr;
    napi_ref target = nullptr;
    napi_ref original = nullptr;
    std::string methodName;
};

std::vector<PatchHook*> g_patchHooks;

/** Per-call data for this.__original: the current instance + original method. */
struct PatchCall {
    napi_ref instance = nullptr;
    napi_ref original = nullptr;
};

/** Find an existing hook for the same target object + method name. */
PatchHook* findPatchHook(napi_env env, napi_value target, const std::string& methodName) {
    for (PatchHook* hook : g_patchHooks) {
        if (hook == nullptr || hook->methodName != methodName) continue;
        napi_value existing = nullptr;
        if (napi_get_reference_value(env, hook->target, &existing) != napi_ok
            || existing == nullptr) {
            continue;
        }
        bool equal = false;
        if (napi_strict_equals(env, existing, target, &equal) == napi_ok && equal) return hook;
    }
    return nullptr;
}

napi_value HostPatchOriginalTrampoline(napi_env env, napi_callback_info info) {
    size_t argc = 16;
    napi_value argv[16] = {nullptr};
    napi_value thisArg = nullptr;
    PatchCall* call = nullptr;
    if (napi_get_cb_info(env, info, &argc, argv, &thisArg,
                         reinterpret_cast<void**>(&call)) != napi_ok
        || call == nullptr) {
        napi_throw_error(env, nullptr, "patched original: missing call context");
        return nullptr;
    }
    napi_value instance = nullptr;
    napi_value original = nullptr;
    if (napi_get_reference_value(env, call->instance, &instance) != napi_ok
        || napi_get_reference_value(env, call->original, &original) != napi_ok
        || instance == nullptr || original == nullptr) {
        napi_throw_error(env, nullptr, "patched original: dead reference");
        return nullptr;
    }
    napi_value result = nullptr;
    if (napi_call_function(env, instance, original, argc, argv, &result) != napi_ok) {
        std::string error = takeHostException("patched original: call failed");
        napi_throw_error(env, nullptr, error.c_str());
        return nullptr;
    }
    return result;
}

/** Host function installed on the class: forwards the call to the VM replacement. */
napi_value HostPatchTrampoline(napi_env env, napi_callback_info info) {
    size_t argc = 32;
    napi_value argv[32] = {nullptr};
    napi_value thisArg = nullptr;
    PatchHook* hook = nullptr;
    if (napi_get_cb_info(env, info, &argc, argv, &thisArg,
                         reinterpret_cast<void**>(&hook)) != napi_ok
        || hook == nullptr) {
        napi_throw_error(env, nullptr, "patched method: missing hook");
        return nullptr;
    }

    // Make `this` available to the VM as a live host object proxy.
    int instanceId = retainHostValue(thisArg);
    if (instanceId == 0) {
        napi_throw_error(env, nullptr, "patched method: cannot reference this");
        return nullptr;
    }

    // Bind the original method for this.__original(...).
    auto* call = new PatchCall();
    napi_value original = nullptr;
    napi_value originalFn = nullptr;
    int originalId = 0;
    bool originalReady = napi_get_reference_value(env, hook->original, &original) == napi_ok
        && original != nullptr
        && napi_create_reference(env, thisArg, 1, &call->instance) == napi_ok
        && call->instance != nullptr
        && napi_create_reference(env, original, 1, &call->original) == napi_ok
        && call->original != nullptr
        && napi_create_function(env, "original", NAPI_AUTO_LENGTH,
                                HostPatchOriginalTrampoline, call, &originalFn) == napi_ok
        && originalFn != nullptr;
    if (originalReady) {
        originalId = retainHostValue(originalFn);
    }
    if (originalId == 0) {
        if (call->instance != nullptr) napi_delete_reference(env, call->instance);
        if (call->original != nullptr) napi_delete_reference(env, call->original);
        delete call;
        call = nullptr;
    }

    std::string argsJson = "[";
    for (size_t i = 0; i < argc; i++) {
        std::string item;
        napiValueToJson(env, argv[i], &item);
        if (i > 0) argsJson += ",";
        argsJson += item;
    }
    argsJson += "]";

    std::string resultJson;
    std::string error;
    bool ok = callJsvmPatch(hook->replacement, instanceId, originalId, argsJson, &resultJson, &error);

    releaseHostValue(instanceId);
    if (originalId != 0) {
        releaseHostValue(originalId);
        napi_delete_reference(env, call->instance);
        napi_delete_reference(env, call->original);
        delete call;
    }

    if (!ok) {
        napi_throw_error(env, nullptr, error.c_str());
        return nullptr;
    }
    napi_value result = napiValueFromJson(env, resultJson);
    if (result == nullptr) napi_get_undefined(env, &result);
    return result;
}

/** Install the trampoline on the host prototype (or the class for statics). */
bool installHostPatch(JSVM_Env jsEnv, const std::string& path, const std::string& className,
                      const std::string& methodName, JSVM_Ref replacement, std::string* error) {
    napi_env env = hostBridgeEnv();
    if (env == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_value receiver = nullptr;
    napi_value module = nullptr;
    if (!resolveHostPathForBridge(path, &receiver, &module, error)) return false;

    napi_value target = nullptr;
    napi_value original = nullptr;
    napi_valuetype originalType = napi_undefined;

    if (className.empty()) {
        // Patch a module-level export / object method: patchMethod(module, null, name, fn).
        target = module;
        if (napi_get_named_property(env, module, methodName.c_str(), &original) != napi_ok
            || original == nullptr) {
            *error = "function not found: " + methodName;
            return false;
        }
        napi_typeof(env, original, &originalType);
        if (originalType != napi_function) {
            *error = "not a function: " + methodName;
            return false;
        }
    } else {
        napi_value classValue = nullptr;
        napi_valuetype type = napi_undefined;
        if (napi_get_named_property(env, module, className.c_str(), &classValue) == napi_ok
            && classValue != nullptr) {
            napi_typeof(env, classValue, &type);
        }
        if (type != napi_function) {
            // Allow the class name of a default export ("EntryAbility") as well
            // as the export key itself ("default").
            napi_value defaultValue = nullptr;
            if (napi_get_named_property(env, module, "default", &defaultValue) == napi_ok
                && defaultValue != nullptr) {
                napi_valuetype defaultType = napi_undefined;
                napi_typeof(env, defaultValue, &defaultType);
                if (defaultType == napi_function) {
                    napi_value nameValue = nullptr;
                    std::string defaultName;
                    if (napi_get_named_property(env, defaultValue, "name", &nameValue) == napi_ok
                        && nameValue != nullptr) {
                        defaultName = napiValueToText(env, nameValue);
                    }
                    if (defaultName == className) {
                        classValue = defaultValue;
                        type = napi_function;
                    }
                }
            }
        }
        if (type != napi_function) {
            *error = "class not found: " + className;
            return false;
        }

        if (napi_get_named_property(env, classValue, "prototype", &target) != napi_ok
            || target == nullptr) {
            *error = "class has no prototype";
            return false;
        }
        if (napi_get_named_property(env, target, methodName.c_str(), &original) == napi_ok
            && original != nullptr) {
            napi_typeof(env, original, &originalType);
        }
        if (originalType != napi_function) {
            original = nullptr;
            if (napi_get_named_property(env, classValue, methodName.c_str(), &original) != napi_ok
                || original == nullptr) {
                *error = "method not found: " + methodName;
                return false;
            }
            napi_typeof(env, original, &originalType);
            if (originalType != napi_function) {
                *error = "not a function: " + methodName;
                return false;
            }
            target = classValue;
        }
    }

    // Patching the same method again replaces the existing replacement instead
    // of wrapping another trampoline around it.
    if (PatchHook* existing = findPatchHook(env, target, methodName)) {
        if (existing->replacement != nullptr && jsEnv != nullptr) {
            OH_JSVM_DeleteReference(jsEnv, existing->replacement);
        }
        existing->replacement = replacement;
        return true;
    }

    napi_ref targetRef = nullptr;
    napi_ref originalRef = nullptr;
    if (napi_create_reference(env, target, 1, &targetRef) != napi_ok
        || targetRef == nullptr
        || napi_create_reference(env, original, 1, &originalRef) != napi_ok
        || originalRef == nullptr) {
        if (targetRef != nullptr) napi_delete_reference(env, targetRef);
        if (originalRef != nullptr) napi_delete_reference(env, originalRef);
        *error = "failed to keep patch target alive";
        return false;
    }

    auto* hook = new PatchHook();
    hook->replacement = replacement;
    hook->target = targetRef;
    hook->original = originalRef;
    hook->methodName = methodName;

    napi_value trampoline = nullptr;
    if (napi_create_function(env, methodName.c_str(), NAPI_AUTO_LENGTH,
                             HostPatchTrampoline, hook, &trampoline) != napi_ok
        || trampoline == nullptr
        || napi_set_named_property(env, target, methodName.c_str(), trampoline) != napi_ok) {
        napi_delete_reference(env, targetRef);
        napi_delete_reference(env, originalRef);
        delete hook;
        *error = "failed to install patch: " + methodName;
        return false;
    }
    g_patchHooks.push_back(hook);
    return true;
}

/** ArkTS.__patchMethod(path, className, methodName, replacement). */
JSVM_Value JSVM_CDECL PatchMethodCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    size_t argc = 4;
    JSVM_Value argv[4] = {nullptr};
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 4) {
        OH_JSVM_ThrowError(env, nullptr,
                           "patchMethod requires module, className, methodName and replacement");
        return nullptr;
    }
    std::string path;
    std::string className;
    std::string methodName;
    jsvmValueToText(env, argv[0], &path);
    jsvmValueToText(env, argv[1], &className);
    jsvmValueToText(env, argv[2], &methodName);
    JSVM_ValueType replacementType = JSVM_UNDEFINED;
    OH_JSVM_Typeof(env, argv[3], &replacementType);
    if (path.empty() || methodName.empty() || replacementType != JSVM_FUNCTION) {
        OH_JSVM_ThrowError(env, nullptr, "patchMethod: invalid arguments");
        return nullptr;
    }
    JSVM_Ref replacement = nullptr;
    if (OH_JSVM_CreateReference(env, argv[3], 1, &replacement) != JSVM_OK
        || replacement == nullptr) {
        OH_JSVM_ThrowError(env, nullptr, "patchMethod: cannot reference replacement");
        return nullptr;
    }
    std::string error;
    if (!installHostPatch(env, path, className, methodName, replacement, &error)) {
        OH_JSVM_DeleteReference(env, replacement);
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    JSVM_Value result = nullptr;
    OH_JSVM_GetBoolean(env, true, &result);
    return result;
}

JSVM_CallbackStruct g_patchMethodCallback{PatchMethodCallback, nullptr};

const char* kPatchBridgeSource = R"JS(
(function (arkts) {
    var bridge = arkts.__bridge;
    var patchMethodNative = arkts.__patchMethod;
    function patchThis(instanceId, originalId) {
        var proxy = bridge.objectProxy("@" + instanceId);
        var extras = Object.create(null);
        if (originalId) {
            extras.__original = bridge.functionProxy("@" + originalId, false);
        }
        bridge.setExtras(proxy, extras);
        return proxy;
    }
    function patchMethod(module, className, methodName, replacement) {
        if (typeof replacement !== "function") {
            throw new TypeError("patchMethod: replacement must be a function");
        }
        var path;
        if (typeof module === "string") {
            path = bridge.modulePath(module);
        } else if (module !== null && typeof module === "object") {
            path = bridge.pathOf(module);
        }
        if (!path) {
            throw new Error("patchMethod: load the module with loadModule/loadModuleWithInfo first");
        }
        if (className !== undefined && className !== null
            && (typeof className !== "string" || className.length === 0)) {
            throw new TypeError("patchMethod: className must be a non-empty string or null");
        }
        if (typeof methodName !== "string" || methodName.length === 0) {
            throw new TypeError("patchMethod: methodName must be a non-empty string");
        }
        var classKey = (className === undefined || className === null) ? "" : className;
        return patchMethodNative(path, classKey, methodName, replacement);
    }
    arkts.patch = {
        patchMethod: patchMethod
    };
    arkts.__patchThis = patchThis;
    delete arkts.__patchMethod;
    delete arkts.__bridge;
})(globalThis.ArkTS);
)JS";

} // namespace

bool installPatchMethod(JSVM_Env env, JSVM_Value arkts) {
    JSVM_Value bridge = nullptr;
    if (OH_JSVM_GetNamedProperty(env, arkts, "__bridge", &bridge) != JSVM_OK
        || bridge == nullptr) {
        GADGET_LOG_ERROR("patch bridge: ArkTS.__bridge is unavailable");
        return false;
    }
    JSVM_Value patchMethod = nullptr;
    if (OH_JSVM_CreateFunction(env, "__patchMethod", JSVM_AUTO_LENGTH,
                               &g_patchMethodCallback, &patchMethod) != JSVM_OK
        || patchMethod == nullptr) {
        return false;
    }
    if (!setNamed(env, arkts, "__patchMethod", patchMethod)) return false;

    JSVM_Value source = nullptr;
    if (OH_JSVM_CreateStringUtf8(env, kPatchBridgeSource, JSVM_AUTO_LENGTH, &source) != JSVM_OK
        || source == nullptr) {
        return false;
    }
    JSVM_Script script = nullptr;
    if (OH_JSVM_CompileScript(env, source, nullptr, 0, false, nullptr, &script) != JSVM_OK
        || script == nullptr) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("patch bridge: compile failed: %{public}s", error.c_str());
        return false;
    }
    JSVM_Value result = nullptr;
    if (OH_JSVM_RunScript(env, script, &result) != JSVM_OK) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("patch bridge: run failed: %{public}s", error.c_str());
        return false;
    }
    return true;
}

void releasePatchHooks(JSVM_Env env) {
    // Restore in reverse patch order so stacked patches unwind correctly.
    for (auto it = g_patchHooks.rbegin(); it != g_patchHooks.rend(); ++it) {
        PatchHook* hook = *it;
        if (hook == nullptr) continue;
        napi_env hostEnv = hostBridgeEnv();
        if (hostEnv != nullptr) {
            napi_value target = nullptr;
            napi_value original = nullptr;
            if (napi_get_reference_value(hostEnv, hook->target, &target) == napi_ok
                && target != nullptr
                && napi_get_reference_value(hostEnv, hook->original, &original) == napi_ok
                && original != nullptr) {
                napi_set_named_property(hostEnv, target, hook->methodName.c_str(), original);
            }
            if (hook->target != nullptr) napi_delete_reference(hostEnv, hook->target);
            if (hook->original != nullptr) napi_delete_reference(hostEnv, hook->original);
        }
        if (env != nullptr && hook->replacement != nullptr) {
            OH_JSVM_DeleteReference(env, hook->replacement);
        }
        delete hook;
    }
    g_patchHooks.clear();
}

} // namespace xpanda
