/**
 * Host NAPI bridge.
 *
 * Owns the host `napi_env`, the host-side `globalThis.ArkTS.napi` mount, module
 * references created by `napi_load_module`, and the JSVM callbacks that forward
 * `ArkTS.hostGlobal` / `ArkTS.napi` calls back into the host runtime.
 * @Author: jmp0
 */
#include "js/module/napi_bridge.h"

#include <cstdlib>
#include <map>
#include <string>
#include <vector>

#include "common/log.h"
#include "common/mini_json.h"
#include "js/jsvm_value.h"
#include "js/module/bridge_utils.h"
#include "napi/napi_utils.h"

namespace xpanda {

namespace {

napi_env g_hostEnv = nullptr;
std::map<int, napi_ref> g_hostModules;
int g_nextModuleId = 1;

/** Render and clear a pending NAPI exception. */
std::string takeNapiException(napi_env env, const std::string& fallback) {
    bool pending = false;
    if (napi_is_exception_pending(env, &pending) == napi_ok && pending) {
        napi_value exception = nullptr;
        if (napi_get_and_clear_last_exception(env, &exception) == napi_ok && exception != nullptr) {
            napi_value text = nullptr;
            if (napi_coerce_to_string(env, exception, &text) == napi_ok && text != nullptr) {
                std::string message = napiValueToText(env, text);
                if (!message.empty()) return message;
            }
        }
    }
    return fallback;
}

/** Host-side napi.loadModule(path). */
napi_value HostNapiLoadModule(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 1 || argv[0] == nullptr) {
        napi_throw_error(env, nullptr, "ArkTS.napi.loadModule requires a module path");
        return nullptr;
    }
    std::string path = napiValueToText(env, argv[0]);
    napi_value module = nullptr;
    if (napi_load_module(env, path.c_str(), &module) != napi_ok || module == nullptr) {
        napi_throw_error(env, nullptr, ("ArkTS.napi.loadModule failed: " + path).c_str());
        return nullptr;
    }
    return module;
}

/** Host-side napi.loadModuleWithInfo(path, moduleInfo). */
napi_value HostNapiLoadModuleWithInfo(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 2 || argv[0] == nullptr || argv[1] == nullptr) {
        napi_throw_error(env, nullptr, "ArkTS.napi.loadModuleWithInfo requires path and module info");
        return nullptr;
    }
    std::string path = napiValueToText(env, argv[0]);
    std::string moduleInfo = napiValueToText(env, argv[1]);
    napi_value module = nullptr;
    if (napi_load_module_with_info(env, path.c_str(), moduleInfo.c_str(), &module) != napi_ok
        || module == nullptr) {
        napi_throw_error(env, nullptr, ("ArkTS.napi.loadModuleWithInfo failed: " + path).c_str());
        return nullptr;
    }
    return module;
}

/** Install globalThis.ArkTS.napi on the host runtime. */
void installHostNapi(napi_env env, napi_value global) {
    napi_value arkts = nullptr;
    napi_value napi = nullptr;
    if (napi_create_object(env, &arkts) != napi_ok || napi_create_object(env, &napi) != napi_ok) return;
    napi_value loadModule = nullptr;
    if (napi_create_function(env, "loadModule", NAPI_AUTO_LENGTH, HostNapiLoadModule, nullptr, &loadModule) == napi_ok
        && loadModule != nullptr) {
        napi_set_named_property(env, napi, "loadModule", loadModule);
    }
    napi_value loadModuleWithInfo = nullptr;
    if (napi_create_function(env, "loadModuleWithInfo", NAPI_AUTO_LENGTH,
                             HostNapiLoadModuleWithInfo, nullptr, &loadModuleWithInfo) == napi_ok
        && loadModuleWithInfo != nullptr) {
        napi_set_named_property(env, napi, "loadModuleWithInfo", loadModuleWithInfo);
    }
    napi_set_named_property(env, arkts, "napi", napi);
    napi_set_named_property(env, global, "ArkTS", arkts);
}

/** Resolve a dotted host path (optionally starting with @moduleId). */
bool resolveHostPath(napi_env env, const std::string& path, napi_value* receiverOut,
                     napi_value* targetOut, std::string* error) {
    napi_value global = nullptr;
    if (napi_get_global(env, &global) != napi_ok || global == nullptr) {
        *error = "host global unavailable";
        return false;
    }

    napi_value receiver = global;
    napi_value target = nullptr;
    size_t start = 0;
    if (!path.empty() && path[0] == '@') {
        size_t dot = path.find('.');
        std::string idText = path.substr(1, dot == std::string::npos ? std::string::npos : dot - 1);
        char* end = nullptr;
        long id = std::strtol(idText.c_str(), &end, 10);
        if (end == idText.c_str() || *end != '\0') {
            *error = "invalid host module id: " + idText;
            return false;
        }
        auto module = g_hostModules.find(static_cast<int>(id));
        if (module == g_hostModules.end()) {
            *error = "host module not loaded: " + idText;
            return false;
        }
        if (napi_get_reference_value(env, module->second, &receiver) != napi_ok || receiver == nullptr) {
            *error = "host module reference is dead: " + idText;
            return false;
        }
        if (dot == std::string::npos) {
            *receiverOut = global;
            *targetOut = receiver;
            return true;
        }
        start = dot + 1;
    }
    while (true) {
        size_t dot = path.find('.', start);
        std::string part = path.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
        if (part.empty()) {
            *error = "invalid host path: " + path;
            return false;
        }
        napi_value next = nullptr;
        if (napi_get_named_property(env, receiver, part.c_str(), &next) != napi_ok || next == nullptr) {
            takeNapiException(env, "property lookup failed");
            *error = "host global not found: " + path;
            return false;
        }
        if (dot == std::string::npos) {
            target = next;
            break;
        }
        receiver = next;
        start = dot + 1;
    }
    *receiverOut = receiver;
    *targetOut = target;
    return true;
}

/** Call or construct a host path with tagged arguments. */
bool invokeHost(const std::string& path, const std::string& taggedArgs, bool isNew,
                std::string* resultJson, std::string* error) {
    if (g_hostEnv == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_env env = g_hostEnv;
    napi_value receiver = nullptr;
    napi_value target = nullptr;
    if (!resolveHostPath(env, path, &receiver, &target, error)) return false;

    std::vector<napi_value> argv;
    if (!decodeTaggedArguments(taggedArgs, &argv, error)) return false;

    napi_value result = nullptr;
    napi_status status;
    if (isNew) {
        status = napi_new_instance(env, target, static_cast<size_t>(argv.size()),
                                   argv.empty() ? nullptr : argv.data(), &result);
    } else {
        status = napi_call_function(env, receiver, target, static_cast<size_t>(argv.size()),
                                    argv.empty() ? nullptr : argv.data(), &result);
    }
    if (status != napi_ok) {
        *error = takeNapiException(env, "host call failed");
        return false;
    }
    return tagHostValue(result, resultJson, error);
}

/** Read a host path and describe it as {"kind":"class|function|object|value|undefined"}. */
bool getHostValue(const std::string& path, std::string* resultJson, std::string* error) {
    if (g_hostEnv == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_env env = g_hostEnv;
    napi_value receiver = nullptr;
    napi_value target = nullptr;
    if (!resolveHostPath(env, path, &receiver, &target, error)) return false;

    napi_valuetype type = napi_undefined;
    napi_typeof(env, target, &type);
    if (type == napi_function) {
        napi_value prototype = nullptr;
        napi_valuetype prototypeType = napi_undefined;
        if (napi_get_named_property(env, target, "prototype", &prototype) == napi_ok) {
            napi_typeof(env, prototype, &prototypeType);
        }
        *resultJson = prototypeType == napi_object ? "{\"kind\":\"class\"}" : "{\"kind\":\"function\"}";
    } else if (type == napi_object) {
        *resultJson = "{\"kind\":\"object\"}";
    } else if (type == napi_undefined) {
        *resultJson = "{\"kind\":\"undefined\"}";
    } else if (type == napi_null) {
        *resultJson = "{\"kind\":\"value\",\"value\":null}";
    } else if (type == napi_symbol || type == napi_external) {
        *resultJson = "{\"kind\":\"undefined\"}";
    } else {
        std::string valueJson;
        napiValueToJson(env, target, &valueJson);
        *resultJson = "{\"kind\":\"value\",\"value\":" + valueJson + "}";
    }
    return true;
}

/** JSVM callback backing every hostGlobal / napi function proxy. */
JSVM_Value JSVM_CDECL HostInvoke(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value argv[3] = {nullptr, nullptr, nullptr};
    size_t argc = 3;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 1) {
        OH_JSVM_ThrowError(env, nullptr, "host invoke: missing path");
        return nullptr;
    }
    std::string path;
    jsvmValueToText(env, argv[0], &path);
    std::string argsJson = "[]";
    if (argc >= 2) jsvmValueToText(env, argv[1], &argsJson);
    bool isNew = false;
    if (argc >= 3) OH_JSVM_GetValueBool(env, argv[2], &isNew);

    std::string resultJson;
    std::string error;
    if (!invokeHost(path, argsJson, isNew, &resultJson, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    JSVM_Value text = createString(env, resultJson);
    if (text == nullptr) {
        OH_JSVM_ThrowError(env, nullptr, "host invoke: failed to create result");
        return nullptr;
    }
    return text;
}

/** Serialize a JS array of property names as a JSON array. */
bool serializeKeyArray(napi_env env, napi_value names, std::string* out) {
    uint32_t length = 0;
    if (napi_get_array_length(env, names, &length) != napi_ok) return false;
    out->assign("[");
    for (uint32_t i = 0; i < length; i++) {
        napi_value key = nullptr;
        if (napi_get_element(env, names, i, &key) != napi_ok) continue;
        if (out->size() > 1) *out += ",";
        *out += MiniJson::escape(napiValueToText(env, key));
    }
    *out += "]";
    return true;
}

/**
 * Object.getOwnPropertyNames / Object.keys fallback.
 *
 * napi_get_all_property_names returns an empty list for ArkTS module namespace
 * objects, even though their exports are readable by name. Calling the host
 * Object helpers sees the same keys a normal JS caller would.
 */
bool jsKeysOf(napi_env env, napi_value target, bool enumerableOnly, std::string* out) {
    napi_value global = nullptr;
    napi_value objectCtor = nullptr;
    napi_value fn = nullptr;
    if (napi_get_global(env, &global) != napi_ok || global == nullptr
        || napi_get_named_property(env, global, "Object", &objectCtor) != napi_ok || objectCtor == nullptr
        || napi_get_named_property(env, objectCtor,
                                   enumerableOnly ? "keys" : "getOwnPropertyNames", &fn) != napi_ok
        || fn == nullptr) {
        takeNapiException(env, "");
        return false;
    }
    napi_value names = nullptr;
    if (napi_call_function(env, objectCtor, fn, 1, &target, &names) != napi_ok || names == nullptr) {
        takeNapiException(env, "");
        return false;
    }
    return serializeKeyArray(env, names, out);
}

/** Read a host object's own keys as {"all":[...],"enumerable":[...]}. */
bool getHostKeys(const std::string& path, std::string* resultJson, std::string* error) {
    if (g_hostEnv == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_env env = g_hostEnv;
    napi_value receiver = nullptr;
    napi_value target = nullptr;
    if (!resolveHostPath(env, path, &receiver, &target, error)) return false;

    auto keysOf = [&](napi_key_filter filter, std::string* out) -> bool {
        napi_value names = nullptr;
        napi_status status = napi_get_all_property_names(
            env, target, napi_key_own_only,
            static_cast<napi_key_filter>(filter | napi_key_skip_symbols),
            napi_key_numbers_to_strings, &names);
        if (status != napi_ok || names == nullptr) {
            *error = takeNapiException(env, "host keys failed: " + path);
            return false;
        }
        return serializeKeyArray(env, names, out);
    };

    std::string all;
    std::string enumerable;
    bool napiOk = keysOf(napi_key_all_properties, &all)
        && keysOf(napi_key_enumerable, &enumerable);
    if (!napiOk || all == "[]") {
        std::string jsAll;
        std::string jsEnumerable;
        if (jsKeysOf(env, target, false, &jsAll)
            && jsKeysOf(env, target, true, &jsEnumerable)) {
            all = std::move(jsAll);
            enumerable = std::move(jsEnumerable);
        } else if (!napiOk) {
            return false;
        }
    }
    *resultJson = "{\"all\":" + all + ",\"enumerable\":" + enumerable + "}";
    return true;
}

/** JSVM callback used by property proxies to read a host value/kind. */
JSVM_Value JSVM_CDECL HostGet(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value arg = nullptr;
    size_t argc = 1;
    if (OH_JSVM_GetCbInfo(env, info, &argc, &arg, nullptr, nullptr) != JSVM_OK || argc < 1) {
        OH_JSVM_ThrowError(env, nullptr, "host get: missing path");
        return nullptr;
    }
    std::string path;
    jsvmValueToText(env, arg, &path);
    std::string resultJson;
    std::string error;
    if (!getHostValue(path, &resultJson, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    JSVM_Value text = createString(env, resultJson);
    if (text == nullptr) {
        OH_JSVM_ThrowError(env, nullptr, "host get: failed to create result");
        return nullptr;
    }
    return text;
}

/** JSVM callback used by object proxies to enumerate host keys. */
JSVM_Value JSVM_CDECL HostKeys(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value arg = nullptr;
    size_t argc = 1;
    if (OH_JSVM_GetCbInfo(env, info, &argc, &arg, nullptr, nullptr) != JSVM_OK || argc < 1) {
        OH_JSVM_ThrowError(env, nullptr, "host keys: missing path");
        return nullptr;
    }
    std::string path;
    jsvmValueToText(env, arg, &path);
    std::string resultJson;
    std::string error;
    if (!getHostKeys(path, &resultJson, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    JSVM_Value text = createString(env, resultJson);
    if (text == nullptr) {
        OH_JSVM_ThrowError(env, nullptr, "host keys: failed to create result");
        return nullptr;
    }
    return text;
}

/** Load a host module through NAPI and keep it alive for later proxy calls. */
JSVM_Value loadHostModule(JSVM_Env env, JSVM_CallbackInfo info, bool withInfo) {
    JSVM_Value argv[2] = {nullptr, nullptr};
    size_t argc = 2;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 1) {
        OH_JSVM_ThrowError(env, nullptr, "loadModule: missing path");
        return nullptr;
    }
    if (g_hostEnv == nullptr) {
        OH_JSVM_ThrowError(env, nullptr, "loadModule: host runtime not attached");
        return nullptr;
    }
    std::string path;
    jsvmValueToText(env, argv[0], &path);
    // Metadata records use the merged-abc record form (&entry/src/main/...&);
    // the host loader expects the plain project path, so strip the wrappers.
    if (path.size() >= 2 && path.front() == '&' && path.back() == '&') {
        path = path.substr(1, path.size() - 2);
    }
    std::string moduleInfo;
    if (withInfo) {
        // Never reach the host loader with an empty moduleInfo: the module
        // manager is native code and fails hard on that input.
        if (argc < 2 || argv[1] == nullptr || !jsvmValueToText(env, argv[1], &moduleInfo)
            || moduleInfo.empty() || moduleInfo == "undefined") {
            OH_JSVM_ThrowError(env, nullptr,
                "loadModuleWithInfo requires (path, \"bundleName/moduleName\") "
                "(ArkTS.metadata.moduleInfo carries the baked value)");
            return nullptr;
        }
    }
    if (path.empty()) {
        OH_JSVM_ThrowError(env, nullptr, "loadModule: empty path");
        return nullptr;
    }

    napi_value module = nullptr;
    napi_status status = withInfo
        ? napi_load_module_with_info(g_hostEnv, path.c_str(), moduleInfo.c_str(), &module)
        : napi_load_module(g_hostEnv, path.c_str(), &module);
    if (status != napi_ok || module == nullptr) {
        std::string error = takeNapiException(g_hostEnv, "loadModule failed: " + path);
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    napi_ref ref = nullptr;
    if (napi_create_reference(g_hostEnv, module, 1, &ref) != napi_ok || ref == nullptr) {
        OH_JSVM_ThrowError(env, nullptr, "loadModule: create reference failed");
        return nullptr;
    }
    int id = g_nextModuleId++;
    g_hostModules[id] = ref;
    return createString(env, std::to_string(id));
}

JSVM_Value JSVM_CDECL HostLoadModule(JSVM_Env env, JSVM_CallbackInfo info) {
    return loadHostModule(env, info, false);
}

JSVM_Value JSVM_CDECL HostLoadModuleWithInfo(JSVM_Env env, JSVM_CallbackInfo info) {
    return loadHostModule(env, info, true);
}

/** Retain a function proxy target + receiver for stable method calls. */
JSVM_Value JSVM_CDECL HostRetainFunction(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value arg = nullptr;
    size_t argc = 1;
    if (OH_JSVM_GetCbInfo(env, info, &argc, &arg, nullptr, nullptr) != JSVM_OK || argc < 1) {
        OH_JSVM_ThrowError(env, nullptr, "retainHostFunction: missing path");
        return nullptr;
    }
    std::string path;
    jsvmValueToText(env, arg, &path);
    int fnId = 0;
    int recvId = 0;
    std::string error;
    if (!retainHostFunction(path, &fnId, &recvId, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    return createString(env, "{\"fn\":" + std::to_string(fnId) + ",\"recv\":" + std::to_string(recvId) + "}");
}

/** Invoke a retained host function with tagged arguments. */
JSVM_Value JSVM_CDECL HostInvokeRef(JSVM_Env env, JSVM_CallbackInfo info) {
    JSVM_Value argv[4] = {nullptr, nullptr, nullptr, nullptr};
    size_t argc = 4;
    if (OH_JSVM_GetCbInfo(env, info, &argc, argv, nullptr, nullptr) != JSVM_OK || argc < 3) {
        OH_JSVM_ThrowError(env, nullptr, "invokeHostRef: missing arguments");
        return nullptr;
    }
    int32_t fnId = 0;
    int32_t recvId = 0;
    if (OH_JSVM_GetValueInt32(env, argv[0], &fnId) != JSVM_OK
        || OH_JSVM_GetValueInt32(env, argv[1], &recvId) != JSVM_OK) {
        OH_JSVM_ThrowError(env, nullptr, "invokeHostRef: invalid ids");
        return nullptr;
    }
    std::string taggedArgs = "[]";
    if (argv[2] != nullptr) jsvmValueToText(env, argv[2], &taggedArgs);
    bool isNew = false;
    if (argc >= 4 && argv[3] != nullptr) OH_JSVM_GetValueBool(env, argv[3], &isNew);
    std::string result;
    std::string error;
    if (!invokeHostRef(fnId, recvId, taggedArgs, isNew, &result, &error)) {
        OH_JSVM_ThrowError(env, nullptr, error.c_str());
        return nullptr;
    }
    return createString(env, result);
}

JSVM_CallbackStruct g_hostInvokeCallback{HostInvoke, nullptr};
JSVM_CallbackStruct g_hostRetainFunctionCallback{HostRetainFunction, nullptr};
JSVM_CallbackStruct g_hostInvokeRefCallback{HostInvokeRef, nullptr};
JSVM_CallbackStruct g_hostGetCallback{HostGet, nullptr};
JSVM_CallbackStruct g_hostKeysCallback{HostKeys, nullptr};
JSVM_CallbackStruct g_hostLoadModuleCallback{HostLoadModule, nullptr};
JSVM_CallbackStruct g_hostLoadModuleWithInfoCallback{HostLoadModuleWithInfo, nullptr};

} // namespace

void releaseHostModules() {
    if (g_hostEnv != nullptr) {
        for (auto& entry : g_hostModules) {
            napi_delete_reference(g_hostEnv, entry.second);
        }
    }
    g_hostModules.clear();
    g_nextModuleId = 1;
}

napi_env hostBridgeEnv() {
    return g_hostEnv;
}

bool resolveHostPathForBridge(const std::string& path, napi_value* receiver,
                              napi_value* target, std::string* error) {
    if (g_hostEnv == nullptr) {
        if (error) *error = "host runtime not attached";
        return false;
    }
    return resolveHostPath(g_hostEnv, path, receiver, target, error);
}

int retainHostValue(napi_value value) {
    if (g_hostEnv == nullptr || value == nullptr) return 0;
    napi_ref ref = nullptr;
    if (napi_create_reference(g_hostEnv, value, 1, &ref) != napi_ok || ref == nullptr) return 0;
    int id = g_nextModuleId++;
    g_hostModules[id] = ref;
    return id;
}

void releaseHostValue(int id) {
    if (g_hostEnv == nullptr || id <= 0) return;
    auto entry = g_hostModules.find(id);
    if (entry == g_hostModules.end()) return;
    napi_delete_reference(g_hostEnv, entry->second);
    g_hostModules.erase(entry);
}

bool getHostReferenceValue(int id, napi_value* out) {
    if (g_hostEnv == nullptr || out == nullptr) return false;
    auto entry = g_hostModules.find(id);
    if (entry == g_hostModules.end()) return false;
    return napi_get_reference_value(g_hostEnv, entry->second, out) == napi_ok && *out != nullptr;
}

bool retainHostFunction(const std::string& path, int* fnId, int* recvId, std::string* error) {
    if (g_hostEnv == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_value receiver = nullptr;
    napi_value target = nullptr;
    if (!resolveHostPath(g_hostEnv, path, &receiver, &target, error)) return false;
    int fn = retainHostValue(target);
    int recv = retainHostValue(receiver);
    if (fn == 0 || recv == 0) {
        releaseHostValue(fn);
        releaseHostValue(recv);
        *error = "retainHostFunction: reference failed";
        return false;
    }
    *fnId = fn;
    *recvId = recv;
    return true;
}

bool invokeHostRef(int fnId, int recvId, const std::string& taggedArgs, bool isNew,
                   std::string* resultJson, std::string* error) {
    napi_env env = g_hostEnv;
    napi_value fn = nullptr;
    napi_value receiver = nullptr;
    if (env == nullptr
        || !getHostReferenceValue(fnId, &fn)
        || !getHostReferenceValue(recvId, &receiver)) {
        *error = "invokeHostRef: dead reference";
        return false;
    }
    std::vector<napi_value> argv;
    if (!decodeTaggedArguments(taggedArgs, &argv, error)) return false;
    napi_value result = nullptr;
    napi_status status = isNew
        ? napi_new_instance(env, fn, static_cast<size_t>(argv.size()),
                            argv.empty() ? nullptr : argv.data(), &result)
        : napi_call_function(env, receiver, fn, static_cast<size_t>(argv.size()),
                             argv.empty() ? nullptr : argv.data(), &result);
    if (status != napi_ok) {
        *error = takeNapiException(env, "host call failed");
        return false;
    }
    return tagHostValue(result, resultJson, error);
}

std::string takeHostException(const std::string& fallback) {
    if (g_hostEnv == nullptr) return fallback;
    return takeNapiException(g_hostEnv, fallback);
}

static bool decodeTagObject(napi_env env, napi_value tag, napi_value* out, std::string* error) {
    napi_value typeValue = nullptr;
    std::string type;
    if (napi_get_named_property(env, tag, "t", &typeValue) == napi_ok && typeValue != nullptr) {
        type = napiValueToText(env, typeValue);
    }
    if (type == "r") {
        napi_value pathValue = nullptr;
        std::string path;
        if (napi_get_named_property(env, tag, "path", &pathValue) == napi_ok && pathValue != nullptr) {
            path = napiValueToText(env, pathValue);
        }
        if (!path.empty()) {
            napi_value receiver = nullptr;
            napi_value target = nullptr;
            return resolveHostPath(env, path, &receiver, &target, error) ? (*out = target, true) : false;
        }
        napi_value idValue = nullptr;
        int32_t id = 0;
        if (napi_get_named_property(env, tag, "id", &idValue) != napi_ok
            || napi_get_value_int32(env, idValue, &id) != napi_ok) {
            *error = "tagged ref: missing id";
            return false;
        }
        auto entry = g_hostModules.find(id);
        if (entry == g_hostModules.end()) {
            *error = "tagged ref: unknown id";
            return false;
        }
        return napi_get_reference_value(env, entry->second, out) == napi_ok && *out != nullptr;
    }
    if (type == "p") {
        napi_value idValue = nullptr;
        int32_t id = 0;
        if (napi_get_named_property(env, tag, "id", &idValue) != napi_ok
            || napi_get_value_int32(env, idValue, &id) != napi_ok) {
            *error = "tagged promise: missing id";
            return false;
        }
        auto entry = g_hostModules.find(id);
        if (entry == g_hostModules.end()) {
            *error = "tagged promise: unknown id";
            return false;
        }
        return napi_get_reference_value(env, entry->second, out) == napi_ok && *out != nullptr;
    }
    if (type == "b") {
        napi_value bytesValue = nullptr;
        if (napi_get_named_property(env, tag, "bytes", &bytesValue) != napi_ok
            || bytesValue == nullptr) {
            *error = "tagged buffer: missing bytes";
            return false;
        }
        uint32_t length = 0;
        napi_get_array_length(env, bytesValue, &length);
        void* data = nullptr;
        napi_value buffer = nullptr;
        if (napi_create_arraybuffer(env, length, &data, &buffer) != napi_ok || buffer == nullptr) {
            *error = "tagged buffer: create failed";
            return false;
        }
        unsigned char* bytes = static_cast<unsigned char*>(data);
        for (uint32_t i = 0; i < length; i++) {
            napi_value element = nullptr;
            uint32_t value = 0;
            if (napi_get_element(env, bytesValue, i, &element) == napi_ok
                && napi_get_value_uint32(env, element, &value) == napi_ok) {
                bytes[i] = static_cast<unsigned char>(value);
            }
        }
        *out = buffer;
        return true;
    }
    // "v" and unknown tags fall back to their JSON value (undefined when absent).
    if (napi_get_named_property(env, tag, "v", out) != napi_ok || *out == nullptr) {
        napi_get_undefined(env, out);
    }
    return true;
}

bool tagHostValue(napi_value value, std::string* out, std::string* error) {
    napi_env env = g_hostEnv;
    if (env == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_valuetype type = napi_undefined;
    if (napi_typeof(env, value, &type) != napi_ok) {
        *error = "tagged value: typeof failed";
        return false;
    }
    if (type == napi_undefined) {
        *out = "{\"t\":\"v\"}";
        return true;
    }
    if (type == napi_null || type == napi_boolean || type == napi_number || type == napi_string) {
        std::string json;
        napiValueToJson(env, value, &json);
        *out = "{\"t\":\"v\",\"v\":" + json + "}";
        return true;
    }
    if (type == napi_bigint) {
        napi_value text = nullptr;
        std::string textValue;
        if (napi_coerce_to_string(env, value, &text) == napi_ok && text != nullptr) {
            textValue = napiValueToText(env, text);
        }
        *out = "{\"t\":\"v\",\"v\":" + MiniJson::escape(textValue) + "}";
        return true;
    }
    if (type == napi_object) {
        bool isPromise = false;
        if (napi_is_promise(env, value, &isPromise) == napi_ok && isPromise) {
            int id = retainHostValue(value);
            if (id == 0) {
                *error = "tagged promise: reference failed";
                return false;
            }
            *out = "{\"t\":\"p\",\"id\":" + std::to_string(id) + "}";
            return true;
        }
        bool isBuffer = false;
        if (napi_is_arraybuffer(env, value, &isBuffer) == napi_ok && isBuffer) {
            void* data = nullptr;
            size_t length = 0;
            if (napi_get_arraybuffer_info(env, value, &data, &length) == napi_ok) {
                const unsigned char* bytes = static_cast<const unsigned char*>(data);
                *out = "{\"t\":\"b\",\"bytes\":[";
                for (size_t i = 0; i < length; i++) {
                    if (i > 0) *out += ",";
                    *out += std::to_string(bytes[i]);
                }
                *out += "]}";
                return true;
            }
        }
    }
    int id = retainHostValue(value);
    if (id == 0) {
        *error = "tagged value: reference failed";
        return false;
    }
    *out = "{\"t\":\"r\",\"id\":" + std::to_string(id) + "}";
    return true;
}

bool decodeTaggedArguments(const std::string& taggedJson, std::vector<napi_value>* args,
                           std::string* error) {
    napi_env env = g_hostEnv;
    if (env == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_value array = napiValueFromJson(env, taggedJson);
    if (array == nullptr) {
        *error = "tagged arguments: invalid JSON";
        return false;
    }
    uint32_t length = 0;
    napi_get_array_length(env, array, &length);
    args->clear();
    args->reserve(length);
    for (uint32_t i = 0; i < length; i++) {
        napi_value tag = nullptr;
        napi_value value = nullptr;
        if (napi_get_element(env, array, i, &tag) != napi_ok || tag == nullptr
            || !decodeTagObject(env, tag, &value, error)) {
            return false;
        }
        args->push_back(value);
    }
    return true;
}

bool decodeTaggedValue(const std::string& taggedJson, napi_value* out, std::string* error) {
    napi_env env = g_hostEnv;
    if (env == nullptr) {
        *error = "host runtime not attached";
        return false;
    }
    napi_value tag = napiValueFromJson(env, taggedJson);
    if (tag == nullptr) {
        *error = "tagged value: invalid JSON";
        return false;
    }
    return decodeTagObject(env, tag, out, error);
}

void captureHostNapi(napi_env env) {
    releaseHostModules();
    g_hostEnv = env;
    if (env == nullptr) return;
    napi_value global = nullptr;
    if (napi_get_global(env, &global) != napi_ok || global == nullptr) return;
    installHostNapi(env, global);
}

bool installNapiBridge(JSVM_Env env, JSVM_Value arkts) {
    JSVM_Value invoke = nullptr;
    if (OH_JSVM_CreateFunction(env, "__hostInvoke", JSVM_AUTO_LENGTH, &g_hostInvokeCallback, &invoke) != JSVM_OK
        || invoke == nullptr) {
        return false;
    }
    JSVM_Value get = nullptr;
    if (OH_JSVM_CreateFunction(env, "__hostGet", JSVM_AUTO_LENGTH, &g_hostGetCallback, &get) != JSVM_OK
        || get == nullptr) {
        return false;
    }
    JSVM_Value keys = nullptr;
    if (OH_JSVM_CreateFunction(env, "__hostKeys", JSVM_AUTO_LENGTH, &g_hostKeysCallback, &keys) != JSVM_OK
        || keys == nullptr) {
        return false;
    }
    JSVM_Value retainFunction = nullptr;
    if (OH_JSVM_CreateFunction(env, "__retainHostFunction", JSVM_AUTO_LENGTH,
                               &g_hostRetainFunctionCallback, &retainFunction) != JSVM_OK
        || retainFunction == nullptr) {
        return false;
    }
    JSVM_Value invokeRef = nullptr;
    if (OH_JSVM_CreateFunction(env, "__invokeHostRef", JSVM_AUTO_LENGTH,
                               &g_hostInvokeRefCallback, &invokeRef) != JSVM_OK
        || invokeRef == nullptr) {
        return false;
    }
    JSVM_Value loadModule = nullptr;
    if (OH_JSVM_CreateFunction(env, "__loadModule", JSVM_AUTO_LENGTH,
                               &g_hostLoadModuleCallback, &loadModule) != JSVM_OK
        || loadModule == nullptr) {
        return false;
    }
    JSVM_Value loadModuleWithInfo = nullptr;
    if (OH_JSVM_CreateFunction(env, "__loadModuleWithInfo", JSVM_AUTO_LENGTH,
                               &g_hostLoadModuleWithInfoCallback, &loadModuleWithInfo) != JSVM_OK
        || loadModuleWithInfo == nullptr) {
        return false;
    }
    return setNamed(env, arkts, "__invoke", invoke)
        && setNamed(env, arkts, "__hostGet", get)
        && setNamed(env, arkts, "__hostKeys", keys)
        && setNamed(env, arkts, "__retainHostFunction", retainFunction)
        && setNamed(env, arkts, "__invokeHostRef", invokeRef)
        && setNamed(env, arkts, "__loadModule", loadModule)
        && setNamed(env, arkts, "__loadModuleWithInfo", loadModuleWithInfo);
}

} // namespace xpanda
