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
 *   - loadModule(path)                      host napi_load_module wrapper
 *   - loadModuleWithInfo(path, info)        host napi_load_module_with_info wrapper
 *   (start({userModules}) installs the bootstrap-baked module list as
 *    ArkTS.metadata in the gadget JSVM)
 *
 * JS execution runs in a dedicated JSVM created on the host JS thread (the host
 * ArkTS runtime forbids dynamic evaluation). The socket thread hops onto the JS
 * thread through the bridge in js/js_thread.cpp. The JSVM lifecycle lives in
 * js/jsvm.cpp and the console.* bridge in js/console.cpp.
 * @Author: jmp0
 */
#include <unistd.h>

#include <string>

#include "common/context.h"
#include "common/log.h"
#include "js/js_thread.h"
#include "js/jsvm.h"
#include "js/module/host_bridge.h"
#include "js/module/metadata_bridge.h"
#include "napi/native_api.h"
#include "napi/napi_utils.h"
#include "socket/socket_server.h"

namespace xpanda {

// ------------------------------------------------------------------ exported functions

/**
 * gadget.start({port?, wait?, userModules?, moduleInfo?}): start the socket
 * server; the optional bootstrap-baked userModules list + bundle/module context
 * are installed as ArkTS.metadata in the gadget JSVM (see metadata_bridge.h).
 */
static napi_value Start(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

    int port = kDefaultPort;
    int waitMs = 0;
    if (argc >= 1 && argv[0] != nullptr) {
        napi_value portValue = nullptr;
        if (napi_get_named_property(env, argv[0], "port", &portValue) == napi_ok && portValue != nullptr) {
            int32_t requested = 0;
            if (napi_get_value_int32(env, portValue, &requested) == napi_ok && requested > 0) {
                port = requested;
            }
        }
        napi_value waitValue = nullptr;
        if (napi_get_named_property(env, argv[0], "wait", &waitValue) == napi_ok && waitValue != nullptr) {
            int32_t requested = 0;
            if (napi_get_value_int32(env, waitValue, &requested) == napi_ok && requested > 0) {
                waitMs = requested;
            }
        }
        // Bootstrap-baked user module list: stored here and installed as
        // ArkTS.metadata.getAllUserModule() on every gadget JSVM creation.
        napi_value userModules = nullptr;
        if (napi_get_named_property(env, argv[0], "userModules", &userModules) == napi_ok
            && userModules != nullptr) {
            std::string json = "[]";
            if (napiValueToJson(env, userModules, &json)) {
                storeUserModuleMetadata(json);
            }
        }
        // Bundle/module context ("<bundleName>/<moduleName>") used by the
        // metadata loadUserModule helper / loadModuleWithInfo calls.
        napi_value moduleInfoValue = nullptr;
        if (napi_get_named_property(env, argv[0], "moduleInfo", &moduleInfoValue) == napi_ok
            && moduleInfoValue != nullptr) {
            std::string moduleInfo = napiValueToText(env, moduleInfoValue);
            if (!moduleInfo.empty()) {
                storeModuleInfo(moduleInfo);
            }
        }
    }

    captureHostGlobal(env);

    std::string bridgeError;
    if (!startJsBridge(env, &bridgeError)) {
        socketServer().setJsError(bridgeError);
    }
    socketServer().setJsExecutor(executeOnJsThread);
    socketServer().setProbeExecutor(probeOnJsThread);
    socketServer().setResetExecutor(resetOnJsThread);

    SocketServer::Config config;
    config.name = "xpanda_gadget_" + std::to_string(port);
    std::string error;
    if (!socketServer().start(config, &error)) {
        GADGET_LOG_ERROR("start failed: %{public}s", error.c_str());
        napi_throw_error(env, nullptr, ("xpanda-gadget start failed: " + error).c_str());
        return nullptr;
    }
    if (waitMs > 0) {
        GADGET_LOG_INFO("start: waiting up to %{public}d ms for a client", waitMs);
        // Startup hold: park incoming "js" requests so the first scripts run
        // inline on this (JS) thread — app startup continues only after they
        // finished, not right after the client connects. The hold loop ends
        // once no new script arrives within the idle grace.
        socketServer().setHoldRequests(true);
        bool connected = socketServer().waitForClient(waitMs);
        GADGET_LOG_INFO("start: %{public}s", connected ? "client connected" : "no client before timeout");
        if (connected) {
            constexpr int kHoldIdleGraceMs = 500;
            while (true) {
                SocketServer::HeldRequestPtr held = socketServer().takeHeldRequest(kHoldIdleGraceMs);
                if (!held) break;
                std::string valueJson;
                std::string error;
                bool ok = evaluateInJsvm(held->code, &valueJson, &error);
                std::string status = ok ? "ok" : "failed: " + error;
                GADGET_LOG_INFO("start: held script %{public}s", status.c_str());
                socketServer().completeHeldRequest(held, ok, ok ? valueJson : error);
            }
        }
        socketServer().setHoldRequests(false);
        socketServer().failHeldRequest("startup hold ended before this request was executed");
    }
    GADGET_LOG_INFO("started %{public}s js=%{public}d (pid %{public}d)", socketServer().endpoint().c_str(),
        isJsBridgeReady() ? 1 : 0, static_cast<int>(getpid()));

    napi_value result = nullptr;
    napi_get_boolean(env, true, &result);
    return result;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
    socketServer().stop();
    destroyJsvm();
    stopJsBridge();
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
    std::string endpointText = socketServer().endpoint();
    napi_create_string_utf8(env, endpointText.data(), endpointText.size(), &endpoint);
    napi_set_named_property(env, object, "endpoint", endpoint);
    napi_value running = nullptr;
    napi_get_boolean(env, socketServer().isRunning(), &running);
    napi_set_named_property(env, object, "running", running);
    napi_value jsReady = nullptr;
    napi_get_boolean(env, isJsBridgeReady() && socketServer().hasJsExecutor(), &jsReady);
    napi_set_named_property(env, object, "js", jsReady);
    if (!isJsBridgeReady()) {
        std::string jsError = socketServer().jsError();
        napi_value jsErrorValue = nullptr;
        napi_create_string_utf8(env, jsError.data(), jsError.size(), &jsErrorValue);
        napi_set_named_property(env, object, "jsError", jsErrorValue);
    }
    napi_value version = nullptr;
    napi_create_string_utf8(env, kGadgetVersion, NAPI_AUTO_LENGTH, &version);
    napi_set_named_property(env, object, "version", version);
    napi_value uptime = nullptr;
    napi_create_int64(env, static_cast<int64_t>(socketServer().uptimeMs()), &uptime);
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
        socketServer().broadcast("{\"type\":\"msg\",\"payload\":" + payload + "}");
    }
    napi_value undefined = nullptr;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value Poll(napi_env env, napi_callback_info info) {
    std::string message;
    if (!socketServer().pollInbox(&message)) {
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
    if (!evaluateInJsvm(code, &valueJson, &error)) {
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

/** Host-side napi_load_module wrapper: gadget.loadModule("@ohos.promptAction"). */
static napi_value LoadModule(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 1 || argv[0] == nullptr) {
        napi_throw_error(env, nullptr, "loadModule requires a module path");
        return nullptr;
    }
    std::string path = napiValueToText(env, argv[0]);
    napi_value module = nullptr;
    if (napi_load_module(env, path.c_str(), &module) != napi_ok || module == nullptr) {
        napi_throw_error(env, nullptr, ("loadModule failed: " + path).c_str());
        return nullptr;
    }
    return module;
}

/** Host-side napi_load_module_with_info wrapper. */
static napi_value LoadModuleWithInfo(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2] = {nullptr, nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 2 || argv[0] == nullptr || argv[1] == nullptr) {
        napi_throw_error(env, nullptr, "loadModuleWithInfo requires path and module info");
        return nullptr;
    }
    std::string path = napiValueToText(env, argv[0]);
    std::string moduleInfo = napiValueToText(env, argv[1]);
    napi_value module = nullptr;
    if (napi_load_module_with_info(env, path.c_str(), moduleInfo.c_str(), &module) != napi_ok
        || module == nullptr) {
        napi_throw_error(env, nullptr, ("loadModuleWithInfo failed: " + path).c_str());
        return nullptr;
    }
    return module;
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
        {"loadModule", nullptr, LoadModule, nullptr, nullptr, nullptr, attrs, nullptr},
        {"loadModuleWithInfo", nullptr, LoadModuleWithInfo, nullptr, nullptr, nullptr, attrs, nullptr},
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
