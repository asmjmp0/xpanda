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

/** A VM function installed as a host property (for example req.request = fn). */
struct VmHostFunction {
    JSVM_Ref fn = nullptr;
    napi_ref target = nullptr;
    napi_ref previous = nullptr;
    std::string prop;
    bool active = true;
};

/** A VM function used as a host Promise callback. */
struct VmCallback {
    JSVM_Ref fn = nullptr;
    bool active = true;
};

std::vector<VmHostFunction*> g_vmFunctions;
std::vector<VmCallback*> g_vmCallbacks;

napi_value HostVmFunctionTrampoline(napi_env env, napi_callback_info info) {
    size_t argc = 32;
    napi_value argv[32] = {nullptr};
    napi_value thisArg = nullptr;
    VmHostFunction* vm = nullptr;
    if (napi_get_cb_info(env, info, &argc, argv, &thisArg,
                         reinterpret_cast<void**>(&vm)) != napi_ok
        || vm == nullptr) {
        napi_throw_error(env, nullptr, "host VM function: missing context");
        return nullptr;
    }
    if (!vm->active) {
        napi_value previous = nullptr;
        if (vm->previous != nullptr
            && napi_get_reference_value(env, vm->previous, &previous) == napi_ok
            && previous != nullptr) {
            napi_value result = nullptr;
            napi_call_function(env, thisArg, previous, argc, argv, &result);
            return result;
        }
        napi_value undefined = nullptr;
        napi_get_undefined(env, &undefined);
        return undefined;
    }

    int instanceId = retainHostValue(thisArg);
    if (instanceId == 0) {
        napi_throw_error(env, nullptr, "host VM function: cannot reference this");
        return nullptr;
    }
    std::string error;
    std::string taggedArgs = "[";
    bool tagsOk = true;
    for (size_t i = 0; i < argc; i++) {
        std::string item;
        if (!tagHostValue(argv[i], &item, &error)) {
            tagsOk = false;
            break;
        }
        if (i > 0) taggedArgs += ",";
        taggedArgs += item;
    }
    taggedArgs += "]";
    if (!tagsOk) {
        releaseHostValue(instanceId);
        napi_throw_error(env, nullptr, error.c_str());
        return nullptr;
    }

    std::string taggedResult;
    bool ok = callJsvmPatch(vm->fn, instanceId, 0, taggedArgs, &taggedResult, &error);
    releaseHostValue(instanceId);
    if (!ok) {
        napi_throw_error(env, nullptr, error.c_str());
        return nullptr;
    }
    napi_value result = nullptr;
    if (!decodeTaggedValue(taggedResult, &result, &error) || result == nullptr) {
        napi_throw_error(env, nullptr, error.empty() ? "host VM function: invalid result" : error.c_str());
        return nullptr;
    }
    return result;
}

napi_value HostThenCallback(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_value thisArg = nullptr;
    VmCallback* callback = nullptr;
    if (napi_get_cb_info(env, info, &argc, argv, &thisArg,
                         reinterpret_cast<void**>(&callback)) != napi_ok
        || callback == nullptr) {
        return nullptr;
    }
    napi_value undefined = nullptr;
    napi_get_undefined(env, &undefined);
    if (!callback->active || callback->fn == nullptr) return undefined;

    std::string error;
    std::string taggedArgs = "[";
    if (argc > 0) {
        std::string item;
        if (!tagHostValue(argv[0], &item, &error)) return undefined;
        taggedArgs += item;
    }
    taggedArgs += "]";
    std::string taggedResult;
    callJsvmPatch(callback->fn, 0, 0, taggedArgs, &taggedResult, &error);
    return undefined;
}

/** req.request = function (...) { ... } — install a VM function as a host property. */
JSVM_Value JSVM_CDECL HostSetFunction(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value argv[3] = {nullptr, nullptr, nullptr};
    size_t argc = 3;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 3) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetFunction: missing arguments");
        return nullptr;
    }
    std::string path;
    std::string prop;
    jsvmValueToText(env, argv[0], &path);
    jsvmValueToText(env, argv[1], &prop);
    JSVM_ValueType type = JSVM_UNDEFINED;
    OH_JSVM_Typeof(env, argv[2], &type);
    if (type != JSVM_FUNCTION || path.empty() || prop.empty()) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetFunction: invalid arguments");
        return nullptr;
    }
    napi_env host = hostBridgeEnv();
    napi_value receiver = nullptr;
    napi_value target = nullptr;
    std::string error;
    if (host == nullptr || !resolveHostPathForBridge(path, &receiver, &target, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.empty() ? "host runtime not attached" : error.c_str());
        return nullptr;
    }

    auto* vm = new VmHostFunction();
    vm->prop = prop;
    if (napi_create_reference(host, target, 1, &vm->target) != napi_ok
        || vm->target == nullptr) {
        delete vm;
        OH_JSVM_ThrowError(env, nullptr, "hostSetFunction: cannot reference target");
        return nullptr;
    }
    napi_value previous = nullptr;
    if (napi_get_named_property(host, target, prop.c_str(), &previous) == napi_ok
        && previous != nullptr) {
        napi_valuetype previousType = napi_undefined;
        napi_typeof(host, previous, &previousType);
        if (previousType == napi_function) {
            napi_create_reference(host, previous, 1, &vm->previous);
        }
    }
    if (OH_JSVM_CreateReference(env, argv[2], 1, &vm->fn) != JSVM_OK || vm->fn == nullptr) {
        napi_delete_reference(host, vm->target);
        if (vm->previous != nullptr) napi_delete_reference(host, vm->previous);
        delete vm;
        OH_JSVM_ThrowError(env, nullptr, "hostSetFunction: cannot reference function");
        return nullptr;
    }

    napi_value hostFn = nullptr;
    if (napi_create_function(host, prop.c_str(), NAPI_AUTO_LENGTH,
                             HostVmFunctionTrampoline, vm, &hostFn) != napi_ok
        || hostFn == nullptr
        || napi_set_named_property(host, target, prop.c_str(), hostFn) != napi_ok) {
        OH_JSVM_DeleteReference(env, vm->fn);
        napi_delete_reference(host, vm->target);
        if (vm->previous != nullptr) napi_delete_reference(host, vm->previous);
        delete vm;
        OH_JSVM_ThrowError(env, nullptr, "hostSetFunction: install failed");
        return nullptr;
    }
    g_vmFunctions.push_back(vm);
    JSVM_Value result = nullptr;
    OH_JSVM_GetBoolean(env, true, &result);
    return result;
}

/** req.someProp = someHostProxy — assign a live host value. */
JSVM_Value JSVM_CDECL HostSetRef(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value argv[3] = {nullptr, nullptr, nullptr};
    size_t argc = 3;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 3) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetRef: missing arguments");
        return nullptr;
    }
    std::string path, prop, refPath;
    jsvmValueToText(env, argv[0], &path);
    jsvmValueToText(env, argv[1], &prop);
    jsvmValueToText(env, argv[2], &refPath);
    napi_env host = hostBridgeEnv();
    napi_value receiver = nullptr, target = nullptr, refReceiver = nullptr, refTarget = nullptr;
    std::string error;
    if (host == nullptr
        || !resolveHostPathForBridge(path, &receiver, &target, &error)
        || !resolveHostPathForBridge(refPath, &refReceiver, &refTarget, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.empty() ? "host runtime not attached" : error.c_str());
        return nullptr;
    }
    if (napi_set_named_property(host, target, prop.c_str(), refTarget) != napi_ok) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetRef: set failed");
        return nullptr;
    }
    JSVM_Value result = nullptr;
    OH_JSVM_GetBoolean(env, true, &result);
    return result;
}

/** req.somePromise = hostPromiseProxy */
JSVM_Value JSVM_CDECL HostSetPromise(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value argv[3] = {nullptr, nullptr, nullptr};
    size_t argc = 3;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 3) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetPromise: missing arguments");
        return nullptr;
    }
    std::string path, prop;
    jsvmValueToText(env, argv[0], &path);
    jsvmValueToText(env, argv[1], &prop);
    int32_t id = 0;
    if (OH_JSVM_GetValueInt32(env, argv[2], &id) != JSVM_OK) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetPromise: invalid id");
        return nullptr;
    }
    napi_env host = hostBridgeEnv();
    napi_value receiver = nullptr, target = nullptr, promise = nullptr;
    std::string error;
    if (host == nullptr || !resolveHostPathForBridge(path, &receiver, &target, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.empty() ? "host runtime not attached" : error.c_str());
        return nullptr;
    }
    if (!getHostReferenceValue(id, &promise)) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetPromise: dead reference");
        return nullptr;
    }
    if (napi_set_named_property(host, target, prop.c_str(), promise) != napi_ok) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetPromise: set failed");
        return nullptr;
    }
    JSVM_Value result = nullptr;
    OH_JSVM_GetBoolean(env, true, &result);
    return result;
}

/** req.someProp = "value" / 123 / null */
JSVM_Value JSVM_CDECL HostSetJson(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value argv[3] = {nullptr, nullptr, nullptr};
    size_t argc = 3;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 3) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetJson: missing arguments");
        return nullptr;
    }
    std::string path, prop, json;
    jsvmValueToText(env, argv[0], &path);
    jsvmValueToText(env, argv[1], &prop);
    jsvmValueToText(env, argv[2], &json);
    napi_env host = hostBridgeEnv();
    napi_value receiver = nullptr, target = nullptr, value = nullptr;
    std::string error;
    if (host == nullptr || !resolveHostPathForBridge(path, &receiver, &target, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.empty() ? "host runtime not attached" : error.c_str());
        return nullptr;
    }
    if (json == "undefined") {
        napi_get_undefined(host, &value);
    } else {
        value = napiValueFromJson(host, json);
        if (value == nullptr) {
            OH_JSVM_ThrowError(env, nullptr, "hostSetJson: invalid JSON");
            return nullptr;
        }
    }
    if (napi_set_named_property(host, target, prop.c_str(), value) != napi_ok) {
        OH_JSVM_ThrowError(env, nullptr, "hostSetJson: set failed");
        return nullptr;
    }
    JSVM_Value result = nullptr;
    OH_JSVM_GetBoolean(env, true, &result);
    return result;
}

/** Retain a resolved host path and return its temporary reference id. */
JSVM_Value JSVM_CDECL HostRetainPath(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value arg = nullptr;
    size_t argc = 1;
    if (OH_JSVM_GetCbInfo(env, info, &argc, &arg, nullptr, nullptr) != JSVM_OK || argc < 1) {
        OH_JSVM_ThrowError(env, nullptr, "hostRetainPath: missing path");
        return nullptr;
    }
    std::string path;
    jsvmValueToText(env, arg, &path);
    napi_value receiver = nullptr, target = nullptr;
    std::string error;
    if (!resolveHostPathForBridge(path, &receiver, &target, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    int id = retainHostValue(target);
    if (id == 0) {
        OH_JSVM_ThrowError(env, nullptr, "hostRetainPath: reference failed");
        return nullptr;
    }
    JSVM_Value result = nullptr;
    OH_JSVM_CreateInt32(env, id, &result);
    return result;
}

/** hostPromise.then(onFulfilled, onRejected) */
JSVM_Value JSVM_CDECL HostPatchThen(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value argv[3] = {nullptr, nullptr, nullptr};
    size_t argc = 3;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 1) {
        OH_JSVM_ThrowError(env, nullptr, "patchThen: missing promise id");
        return nullptr;
    }
    int32_t id = 0;
    if (OH_JSVM_GetValueInt32(env, argv[0], &id) != JSVM_OK) {
        OH_JSVM_ThrowError(env, nullptr, "patchThen: invalid promise id");
        return nullptr;
    }
    napi_env host = hostBridgeEnv();
    napi_value promise = nullptr;
    if (host == nullptr || !getHostReferenceValue(id, &promise)) {
        OH_JSVM_ThrowError(env, nullptr, "patchThen: dead promise reference");
        return nullptr;
    }

    auto makeCallback = [&](JSVM_Value fnValue) -> napi_value {
        JSVM_ValueType type = JSVM_UNDEFINED;
        if (fnValue != nullptr) OH_JSVM_Typeof(env, fnValue, &type);
        if (type != JSVM_FUNCTION) {
            napi_value undefined = nullptr;
            napi_get_undefined(host, &undefined);
            return undefined;
        }
        auto* callback = new VmCallback();
        if (OH_JSVM_CreateReference(env, fnValue, 1, &callback->fn) != JSVM_OK
            || callback->fn == nullptr) {
            delete callback;
            napi_value undefined = nullptr;
            napi_get_undefined(host, &undefined);
            return undefined;
        }
        g_vmCallbacks.push_back(callback);
        napi_value hostFn = nullptr;
        if (napi_create_function(host, "then", NAPI_AUTO_LENGTH,
                                 HostThenCallback, callback, &hostFn) != napi_ok
            || hostFn == nullptr) {
            callback->active = false;
            OH_JSVM_DeleteReference(env, callback->fn);
            callback->fn = nullptr;
            napi_value undefined = nullptr;
            napi_get_undefined(host, &undefined);
            return undefined;
        }
        return hostFn;
    };

    napi_value onFulfilled = makeCallback(argc >= 2 ? argv[1] : nullptr);
    napi_value onRejected = makeCallback(argc >= 3 ? argv[2] : nullptr);
    napi_value thenFn = nullptr;
    if (napi_get_named_property(host, promise, "then", &thenFn) != napi_ok
        || thenFn == nullptr) {
        OH_JSVM_ThrowError(env, nullptr, "patchThen: promise has no then");
        return nullptr;
    }
    napi_value args[2] = {onFulfilled, onRejected};
    napi_value ignored = nullptr;
    if (napi_call_function(host, promise, thenFn, 2, args, &ignored) != napi_ok) {
        std::string error = takeHostException("patchThen: then call failed");
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    JSVM_Value result = nullptr;
    OH_JSVM_GetBoolean(env, true, &result);
    return result;
}

JSVM_CallbackStruct g_hostSetFunctionCallback{HostSetFunction, nullptr};
JSVM_CallbackStruct g_hostSetRefCallback{HostSetRef, nullptr};
JSVM_CallbackStruct g_hostSetPromiseCallback{HostSetPromise, nullptr};
JSVM_CallbackStruct g_hostSetJsonCallback{HostSetJson, nullptr};
JSVM_CallbackStruct g_hostRetainPathCallback{HostRetainPath, nullptr};
JSVM_CallbackStruct g_hostPatchThenCallback{HostPatchThen, nullptr};

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

    std::string error;
    std::string taggedArgs = "[";
    bool tagsOk = true;
    for (size_t i = 0; i < argc; i++) {
        std::string item;
        if (!tagHostValue(argv[i], &item, &error)) {
            tagsOk = false;
            break;
        }
        if (i > 0) taggedArgs += ",";
        taggedArgs += item;
    }
    taggedArgs += "]";

    if (!tagsOk) {
        releaseHostValue(instanceId);
        if (originalId != 0) {
            releaseHostValue(originalId);
            napi_delete_reference(env, call->instance);
            napi_delete_reference(env, call->original);
            delete call;
        }
        napi_throw_error(env, nullptr, error.c_str());
        return nullptr;
    }

    std::string taggedResult;
    bool ok = callJsvmPatch(hook->replacement, instanceId, originalId, taggedArgs, &taggedResult, &error);

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
    napi_value result = nullptr;
    if (!decodeTaggedValue(taggedResult, &result, &error) || result == nullptr) {
        napi_throw_error(env, nullptr, error.empty() ? "patched method: invalid result" : error.c_str());
        return nullptr;
    }
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
    var hostSetFunction = arkts.__hostSetFunction;
    var hostSetRef = arkts.__hostSetRef;
    var hostSetPromise = arkts.__hostSetPromise;
    var hostSetJson = arkts.__hostSetJson;
    function setHostProperty(path, prop, value) {
        var proxyPath = bridge.pathOf(value);
        if (proxyPath) return hostSetRef(path, prop, proxyPath);
        if (typeof value === "function") return hostSetFunction(path, prop, value);
        var promiseId = bridge.promiseId(value);
        if (promiseId) return hostSetPromise(path, prop, promiseId);
        var json;
        try {
            json = value === undefined ? "undefined" : JSON.stringify(value);
        } catch (e) {
            return false;
        }
        return hostSetJson(path, prop, json);
    }
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
    arkts.__setHostProperty = setHostProperty;
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
    JSVM_Value hostSetFunction = nullptr;
    JSVM_Value hostSetRef = nullptr;
    JSVM_Value hostSetPromise = nullptr;
    JSVM_Value hostSetJson = nullptr;
    JSVM_Value retainPath = nullptr;
    JSVM_Value patchThen = nullptr;
    if (OH_JSVM_CreateFunction(env, "__hostSetFunction", JSVM_AUTO_LENGTH,
                               &g_hostSetFunctionCallback, &hostSetFunction) != JSVM_OK
        || hostSetFunction == nullptr
        || OH_JSVM_CreateFunction(env, "__hostSetRef", JSVM_AUTO_LENGTH,
                                  &g_hostSetRefCallback, &hostSetRef) != JSVM_OK
        || hostSetRef == nullptr
        || OH_JSVM_CreateFunction(env, "__hostSetPromise", JSVM_AUTO_LENGTH,
                                  &g_hostSetPromiseCallback, &hostSetPromise) != JSVM_OK
        || hostSetPromise == nullptr
        || OH_JSVM_CreateFunction(env, "__hostSetJson", JSVM_AUTO_LENGTH,
                                  &g_hostSetJsonCallback, &hostSetJson) != JSVM_OK
        || hostSetJson == nullptr
        || OH_JSVM_CreateFunction(env, "__retainHostPath", JSVM_AUTO_LENGTH,
                                  &g_hostRetainPathCallback, &retainPath) != JSVM_OK
        || retainPath == nullptr
        || OH_JSVM_CreateFunction(env, "__patchThen", JSVM_AUTO_LENGTH,
                                  &g_hostPatchThenCallback, &patchThen) != JSVM_OK
        || patchThen == nullptr) {
        return false;
    }
    if (!setNamed(env, arkts, "__patchMethod", patchMethod)
        || !setNamed(env, arkts, "__hostSetFunction", hostSetFunction)
        || !setNamed(env, arkts, "__hostSetRef", hostSetRef)
        || !setNamed(env, arkts, "__hostSetPromise", hostSetPromise)
        || !setNamed(env, arkts, "__hostSetJson", hostSetJson)
        || !setNamed(env, arkts, "__retainHostPath", retainPath)
        || !setNamed(env, arkts, "__patchThen", patchThen)) {
        return false;
    }

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
    napi_env hostEnv = hostBridgeEnv();
    // Restore in reverse patch order so stacked patches unwind correctly.
    for (auto it = g_patchHooks.rbegin(); it != g_patchHooks.rend(); ++it) {
        PatchHook* hook = *it;
        if (hook == nullptr) continue;
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

    // Assigned VM functions: restore the old host property and keep the data
    // struct alive so a captured host function can fall back safely.
    for (VmHostFunction* vm : g_vmFunctions) {
        if (vm == nullptr || !vm->active) continue;
        vm->active = false;
        if (hostEnv != nullptr && vm->target != nullptr) {
            napi_value target = nullptr;
            if (napi_get_reference_value(hostEnv, vm->target, &target) == napi_ok
                && target != nullptr && vm->previous != nullptr) {
                napi_value previous = nullptr;
                if (napi_get_reference_value(hostEnv, vm->previous, &previous) == napi_ok
                    && previous != nullptr) {
                    napi_set_named_property(hostEnv, target, vm->prop.c_str(), previous);
                }
            }
            napi_delete_reference(hostEnv, vm->target);
            vm->target = nullptr;
        }
        if (env != nullptr && vm->fn != nullptr) {
            OH_JSVM_DeleteReference(env, vm->fn);
            vm->fn = nullptr;
        }
    }
    // Promise callbacks: mark inactive; the host Promise may still fire later.
    for (VmCallback* callback : g_vmCallbacks) {
        if (callback == nullptr || !callback->active) continue;
        callback->active = false;
        if (env != nullptr && callback->fn != nullptr) {
            OH_JSVM_DeleteReference(env, callback->fn);
            callback->fn = nullptr;
        }
    }
}

} // namespace xpanda
