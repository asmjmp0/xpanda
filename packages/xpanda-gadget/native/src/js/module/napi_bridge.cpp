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

/** Call or construct a host path with JSON arguments. */
bool invokeHost(const std::string& path, const std::string& argsJson, bool isNew,
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
    napi_value argsValue = napiValueFromJson(env, argsJson);
    if (argsValue != nullptr) {
        uint32_t argc = 0;
        napi_get_array_length(env, argsValue, &argc);
        argv.resize(argc);
        for (uint32_t i = 0; i < argc; i++) {
            napi_get_element(env, argsValue, i, &argv[i]);
        }
    }

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
    napi_valuetype resultType = napi_undefined;
    napi_typeof(env, result, &resultType);
    if (resultType == napi_undefined || resultType == napi_null) {
        *resultJson = "null";
    } else {
        napiValueToJson(env, result, resultJson);
    }
    return true;
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
        uint32_t length = 0;
        napi_get_array_length(env, names, &length);
        out->assign("[");
        for (uint32_t i = 0; i < length; i++) {
            napi_value key = nullptr;
            if (napi_get_element(env, names, i, &key) != napi_ok) continue;
            if (out->size() > 1) *out += ",";
            *out += MiniJson::escape(napiValueToText(env, key));
        }
        *out += "]";
        return true;
    };

    std::string all;
    std::string enumerable;
    if (!keysOf(napi_key_all_properties, &all) || !keysOf(napi_key_enumerable, &enumerable)) {
        return false;
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
    std::string moduleInfo;
    if (withInfo) {
        if (argc < 2) {
            OH_JSVM_ThrowError(env, nullptr, "loadModuleWithInfo: missing module info");
            return nullptr;
        }
        jsvmValueToText(env, argv[1], &moduleInfo);
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

JSVM_CallbackStruct g_hostInvokeCallback{HostInvoke, nullptr};
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
        && setNamed(env, arkts, "__loadModule", loadModule)
        && setNamed(env, arkts, "__loadModuleWithInfo", loadModuleWithInfo);
}

} // namespace xpanda
