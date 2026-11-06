/**
 * Module metadata bridge: storage + gadget JSVM install.
 *
 * The bootstrap module (compiled into the target abc at patch time) carries a
 * static getAllUserModule() built from the abc's module records and passes the
 * list to gadget.start({ userModules }); Start() stores the JSON and every
 * gadget JSVM (first creation and after .reset) exposes it as
 * ArkTS.metadata.getAllUserModule() for shell / file scripts.
 * @Author: jmp0
 */
#include "js/module/metadata_bridge.h"

#include <string>

#include "common/log.h"
#include "js/jsvm_value.h"
#include "js/module/bridge_utils.h"

namespace xpanda {

namespace {

/** Plain JSON array handed over by gadget.start({ userModules }); empty = unset. */
std::string g_userModulesJson;

/** "<bundleName>/<moduleName>" handed over by gadget.start({ moduleInfo }); empty = unset. */
std::string g_moduleInfo;

/** getAllUserModule() body: parse the stored JSON array fresh on every call. */
JSVM_Value GetAllUserModuleCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    JSVM_Value undefined = nullptr;
    OH_JSVM_GetUndefined(env, &undefined);
    if (g_userModulesJson.empty()) return undefined;
    JSVM_Value json = createString(env, g_userModulesJson);
    if (json == nullptr) return undefined;
    JSVM_Value parsed = nullptr;
    if (OH_JSVM_JsonParse(env, json, &parsed) != JSVM_OK || parsed == nullptr) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("getAllUserModule: json parse failed: %{public}s", error.c_str());
        return undefined;
    }
    return parsed;
}

JSVM_CallbackStruct kGetAllUserModuleCallback = {GetAllUserModuleCallback, nullptr};

} // namespace

void storeUserModuleMetadata(const std::string& json) {
    g_userModulesJson = json;
}

void storeModuleInfo(const std::string& moduleInfo) {
    g_moduleInfo = moduleInfo;
}

void installUserModuleMetadata(JSVM_Env env) {
    if (g_userModulesJson.empty()) return;
    // Attach to the ArkTS object installed by installHostBridge. The property
    // is set on that object handle directly - no globalThis assignment script.
    JSVM_Value global = nullptr;
    JSVM_Value arkts = nullptr;
    if (OH_JSVM_GetGlobal(env, &global) != JSVM_OK || global == nullptr
        || OH_JSVM_GetNamedProperty(env, global, "ArkTS", &arkts) != JSVM_OK || arkts == nullptr) {
        GADGET_LOG_ERROR("user module metadata: the gadget JSVM has no ArkTS object");
        return;
    }
    JSVM_Value function = nullptr;
    if (OH_JSVM_CreateFunction(env, "getAllUserModule",
                               static_cast<int>(sizeof("getAllUserModule") - 1),
                               &kGetAllUserModuleCallback, &function) != JSVM_OK || function == nullptr) {
        GADGET_LOG_ERROR("user module metadata: failed to create getAllUserModule");
        return;
    }
    JSVM_Value metadata = nullptr;
    if (OH_JSVM_CreateObject(env, &metadata) != JSVM_OK || metadata == nullptr) {
        GADGET_LOG_ERROR("user module metadata: failed to create the metadata object");
        return;
    }
    if (!setNamed(env, metadata, "getAllUserModule", function)) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("user module metadata: install failed: %{public}s", error.c_str());
        return;
    }
    if (!g_moduleInfo.empty()) {
        JSVM_Value info = createString(env, g_moduleInfo);
        if (info != nullptr && !setNamed(env, metadata, "moduleInfo", info)) {
            std::string error;
            clearJsvmException(env, &error);
            GADGET_LOG_ERROR("user module metadata: failed to set moduleInfo: %{public}s", error.c_str());
        }
    }
    if (!setNamed(env, arkts, "metadata", metadata)) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("user module metadata: install failed: %{public}s", error.c_str());
    }
}

} // namespace xpanda
