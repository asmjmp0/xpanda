/**
 * Host bridge coordinator.
 *
 * - host_global.cpp captures the host globalThis and builds `ArkTS.hostGlobal`.
 * - napi_bridge.cpp owns the host `napi_env`, `ArkTS.napi` and the call proxy.
 * - This file installs both on `globalThis.ArkTS` in the gadget JSVM.
 * @Author: jmp0
 */
#include "js/module/host_bridge.h"

#include <string>

#include "common/log.h"
#include "js/jsvm_value.h"
#include "js/module/bridge_utils.h"
#include "js/module/host_global.h"
#include "js/module/napi_bridge.h"
#include "js/module/patch_bridge.h"

namespace xpanda {

namespace {

const char* kBridgeSource = R"JS(
(function (arkts) {
    var snapshot = arkts.__snapshot;
    var invoke = arkts.__invoke;
    var getHost = arkts.__hostGet;
    var hostKeys = arkts.__hostKeys;
    var proxyCache = Object.create(null);
    var proxyPaths = new WeakMap();
    var proxyExtras = new WeakMap();
    var promiseIds = new WeakMap();
    var promiseCache = Object.create(null);
    var loadedModules = Object.create(null);
    var loadModule = arkts.__loadModule;
    var loadModuleWithInfo = arkts.__loadModuleWithInfo;

    function hostPromise(id) {
        if (promiseCache[id]) return promiseCache[id];
        var thenable = {
            __xpandaPromiseId: id,
            then: function (onFulfilled, onRejected) {
                if (typeof arkts.__patchThen !== "function") {
                    throw new Error("Promise bridge is not installed");
                }
                arkts.__patchThen(id, onFulfilled, onRejected);
                return thenable;
            },
            catch: function (onRejected) {
                return thenable.then(undefined, onRejected);
            }
        };
        promiseIds.set(thenable, id);
        promiseCache[id] = thenable;
        return thenable;
    }
    function decodeTagged(tag) {
        if (tag.t === "r") return resolve(tag.path ? tag.path : "@" + tag.id);
        if (tag.t === "p") return hostPromise(tag.id);
        if (tag.t === "b") {
            var bytes = tag.bytes || [];
            var buffer = new ArrayBuffer(bytes.length);
            var view = new Uint8Array(buffer);
            for (var i = 0; i < bytes.length; i++) view[i] = bytes[i];
            return buffer;
        }
        return tag.v;
    }
    function encodeValue(value) {
        if (value === undefined) return { t: "v" };
        if (value === null || typeof value !== "object") return { t: "v", v: value };
        var path = proxyPaths.get(value);
        if (path) return { t: "r", path: path };
        var pid = promiseIds.get(value);
        if (pid) return { t: "p", id: pid };
        if (value instanceof ArrayBuffer) {
            var view = new Uint8Array(value);
            var bytes = [];
            for (var i = 0; i < view.length; i++) bytes.push(view[i]);
            return { t: "b", bytes: bytes };
        }
        return { t: "v", v: value };
    }
    function encodeArgs(args) {
        var out = [];
        for (var i = 0; i < args.length; i++) out.push(encodeValue(args[i]));
        return JSON.stringify(out);
    }
    function tagResult(value) {
        if (value === undefined) return JSON.stringify({ t: "v" });
        if (value === null || typeof value !== "object") return JSON.stringify({ t: "v", v: value });
        var path = proxyPaths.get(value);
        if (path) {
            if (typeof arkts.__retainHostPath === "function") {
                return JSON.stringify({ t: "r", id: arkts.__retainHostPath(path) });
            }
            return JSON.stringify({ t: "v", v: value });
        }
        var pid = promiseIds.get(value);
        if (pid) return JSON.stringify({ t: "p", id: pid });
        if (value instanceof ArrayBuffer) {
            var view = new Uint8Array(value);
            var bytes = [];
            for (var i = 0; i < view.length; i++) bytes.push(view[i]);
            return JSON.stringify({ t: "b", bytes: bytes });
        }
        return JSON.stringify({ t: "v", v: value });
    }
    function resolve(path) {
        var info;
        try {
            info = JSON.parse(getHost(path));
        } catch (e) {
            return undefined;
        }
        if (info.kind === "class") return functionProxy(path, true);
        if (info.kind === "function") return functionProxy(path, false);
        if (info.kind === "object") return objectProxy(path);
        if (info.kind === "value") return info.value;
        return undefined;
    }
    function functionProxy(path, isClass) {
        if (proxyCache[path]) return proxyCache[path];
        var bound = JSON.parse(arkts.__retainHostFunction(path));
        function invoke(args, isNew) {
            return decodeTagged(JSON.parse(arkts.__invokeHostRef(
                bound.fn, bound.recv, encodeArgs(args), isNew)));
        }
        var fn = isClass
            ? function (...args) { return invoke(args, new.target !== undefined); }
            : (...args) => invoke(args, false);
        Object.defineProperty(fn, "name", { value: path });
        var handler = {
            get: function (target, prop) {
                // Expose the real host prototype so class methods can be
                // enumerated from the VM. `target.prototype` is only the local
                // placeholder and has no host members.
                if (prop === "prototype") return objectProxy(path + ".prototype");
                if (prop === "name") return path;
                if (typeof prop === "symbol") return undefined;
                return resolve(path + "." + String(prop));
            },
            apply: function (target, thisArg, args) { return invoke(args, false); }
        };
        if (isClass) {
            handler.construct = function (target, args) { return invoke(args, true); };
        }
        var proxy = new Proxy(fn, handler);
        proxyCache[path] = proxy;
        proxyPaths.set(proxy, path);
        return proxy;
    }
    function objectProxy(path) {
        if (proxyCache[path]) return proxyCache[path];
        var proxy = new Proxy(Object.create(null), {
            get: function (target, prop) {
                if (typeof prop === "symbol") return undefined;
                var extras = proxyExtras.get(proxy);
                if (extras && Object.prototype.hasOwnProperty.call(extras, prop)) return extras[prop];
                return resolve(path + "." + String(prop));
            },
            set: function (target, prop, value) {
                if (typeof prop === "symbol") return false;
                if (typeof arkts.__setHostProperty !== "function") return false;
                try {
                    return Boolean(arkts.__setHostProperty(path, String(prop), value));
                } catch (e) {
                    return false;
                }
            },
            has: function (target, prop) {
                if (typeof prop === "symbol") return false;
                var extras = proxyExtras.get(proxy);
                if (extras && Object.prototype.hasOwnProperty.call(extras, prop)) return true;
                try {
                    return JSON.parse(getHost(path + "." + String(prop))).kind !== "undefined";
                } catch (e) {
                    return false;
                }
            },
            ownKeys: function () {
                try {
                    return JSON.parse(hostKeys(path)).all;
                } catch (e) {
                    return [];
                }
            },
            getOwnPropertyDescriptor: function (target, prop) {
                if (typeof prop === "symbol") return undefined;
                var extras = proxyExtras.get(proxy);
                if (extras && Object.prototype.hasOwnProperty.call(extras, prop)) {
                    return { value: extras[prop], enumerable: false, configurable: true, writable: false };
                }
                var info;
                try {
                    info = JSON.parse(hostKeys(path));
                } catch (e) {
                    return undefined;
                }
                var value;
                try {
                    value = resolve(path + "." + String(prop));
                } catch (e) {
                    value = undefined;
                }
                return {
                    value: value,
                    enumerable: info.enumerable.indexOf(String(prop)) >= 0,
                    configurable: true,
                    writable: false
                };
            }
        });
        proxyCache[path] = proxy;
        proxyPaths.set(proxy, path);
        return proxy;
    }
    function loadModuleProxy(path) {
        var id = loadModule(path);
        var proxy = objectProxy("@" + id);
        loadedModules[path] = "@" + id;
        return proxy;
    }
    function loadModuleWithInfoProxy(path, moduleInfo) {
        var id = loadModuleWithInfo(path, moduleInfo);
        var proxy = objectProxy("@" + id);
        loadedModules[path] = "@" + id;
        loadedModules[path + "\n" + moduleInfo] = "@" + id;
        return proxy;
    }
    var hostGlobal = Object.create(null);
    snapshot.__keys.forEach(function (name) {
        var kind = snapshot.__kinds[name];
        if (kind === "class") {
            hostGlobal[name] = functionProxy(name, true);
        } else if (kind === "function") {
            hostGlobal[name] = functionProxy(name, false);
        } else if (kind === "object") {
            hostGlobal[name] = objectProxy(name);
        } else {
            hostGlobal[name] = snapshot.__primitives[name];
        }
    });
    arkts.hostGlobal = hostGlobal;
    arkts.napi = {
        loadModule: function (path) {
            return loadModuleProxy(path);
        },
        loadModuleWithInfo: function (path, moduleInfo) {
            return loadModuleWithInfoProxy(path, moduleInfo);
        }
    };
    arkts.__bridge = {
        objectProxy: objectProxy,
        functionProxy: functionProxy,
        resolve: resolve,
        pathOf: function (value) { return proxyPaths.get(value) || null; },
        modulePath: function (path) { return loadedModules[path] || null; },
        promiseId: function (value) { return promiseIds.get(value) || 0; },
        hostPromise: hostPromise,
        setExtras: function (proxy, extras) { proxyExtras.set(proxy, extras); }
    };
    arkts.__decodeTags = function (json) { return JSON.parse(json).map(decodeTagged); };
    arkts.__tagResult = tagResult;
    delete arkts.__snapshot;
    delete arkts.__invoke;
    delete arkts.__hostGet;
    delete arkts.__hostKeys;
    delete arkts.__loadModule;
    delete arkts.__loadModuleWithInfo;
})(globalThis.ArkTS);
)JS";

bool runBridgeScript(JSVM_Env env) {
    JSVM_Value source = nullptr;
    if (OH_JSVM_CreateStringUtf8(env, kBridgeSource, JSVM_AUTO_LENGTH, &source) != JSVM_OK || source == nullptr) {
        return false;
    }
    JSVM_Script script = nullptr;
    if (OH_JSVM_CompileScript(env, source, nullptr, 0, false, nullptr, &script) != JSVM_OK || script == nullptr) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("host bridge: compile failed: %{public}s", error.c_str());
        return false;
    }
    JSVM_Value result = nullptr;
    if (OH_JSVM_RunScript(env, script, &result) != JSVM_OK) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("host bridge: run failed: %{public}s", error.c_str());
        return false;
    }
    return true;
}

} // namespace

void captureHostGlobal(napi_env env) {
    // Mount the host NAPI helpers first so they are part of the snapshot.
    captureHostNapi(env);
    captureHostGlobalSnapshot(env);
}

bool installHostBridge(JSVM_Env env) {
    JSVM_Value arkts = nullptr;
    if (OH_JSVM_CreateObject(env, &arkts) != JSVM_OK || arkts == nullptr) return false;
    if (!installNapiBridge(env, arkts)) {
        GADGET_LOG_ERROR("host bridge: failed to install napi helpers");
        return false;
    }
    if (!installHostGlobalSnapshot(env, arkts)) {
        GADGET_LOG_ERROR("host bridge: failed to install globalThis snapshot");
        return false;
    }
    JSVM_Value global = nullptr;
    if (OH_JSVM_GetGlobal(env, &global) != JSVM_OK || global == nullptr) return false;
    if (!setNamed(env, global, "ArkTS", arkts)) return false;
    if (!runBridgeScript(env)) return false;
    if (!installPatchMethod(env, arkts)) {
        GADGET_LOG_ERROR("host bridge: failed to install patch helpers");
        return false;
    }
    return true;
}

} // namespace xpanda
