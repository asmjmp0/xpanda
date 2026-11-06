/**
 * Module-load event history (see js/module/module_events.h).
 * @Author: jmp0
 */
#include "js/module/module_events.h"

#include <mutex>
#include <string>
#include <vector>

#include "common/log.h"
#include "common/mini_json.h"
#include "js/js_thread.h"
#include "js/jsvm_value.h"
#include "js/module/bridge_utils.h"

namespace xpanda {

namespace {

std::mutex g_moduleLoadMutex;
std::vector<std::string> g_moduleLoadRecords;

JSVM_Value ModuleLoadHistoryCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    return createString(env, moduleLoadHistoryJson());
}

JSVM_Value ModuleLoadSeqCallback(JSVM_Env env, JSVM_CallbackInfo info) {
    (void)info;
    JSVM_Value value = nullptr;
    const int32_t sequence = static_cast<int32_t>(moduleLoadSequence());
    if (OH_JSVM_CreateInt32(env, sequence, &value) != JSVM_OK) return nullptr;
    return value;
}

JSVM_CallbackStruct kModuleLoadHistoryCallback = {ModuleLoadHistoryCallback, nullptr};
JSVM_CallbackStruct kModuleLoadSeqCallback = {ModuleLoadSeqCallback, nullptr};

} // namespace

std::size_t moduleLoadSequence() {
    std::lock_guard<std::mutex> lock(g_moduleLoadMutex);
    return g_moduleLoadRecords.size();
}

void recordModuleLoad(const std::string& record) {
    if (record.empty()) return;
    std::size_t sequence = 0;
    {
        std::lock_guard<std::mutex> lock(g_moduleLoadMutex);
        g_moduleLoadRecords.push_back(record);
        sequence = g_moduleLoadRecords.size();
    }
    GADGET_LOG_INFO("module loaded: %{public}s", record.c_str());
    // Dispatch on the next host event-loop turn. The callback therefore runs
    // after func_main_0 returned and the runtime marked the module evaluated.
    postModuleLoadEvent(record, sequence);
}

std::string moduleLoadHistoryJson() {
    std::lock_guard<std::mutex> lock(g_moduleLoadMutex);
    std::string json = "[";
    for (size_t i = 0; i < g_moduleLoadRecords.size(); i++) {
        if (i > 0) json += ",";
        json += MiniJson::escape(g_moduleLoadRecords[i]);
    }
    json += "]";
    return json;
}

bool installModuleLoadHistory(JSVM_Env env, JSVM_Value arkts) {
    if (env == nullptr || arkts == nullptr) return false;
    JSVM_Value function = nullptr;
    if (OH_JSVM_CreateFunction(env, "__moduleLoadHistory",
                               static_cast<int>(sizeof("__moduleLoadHistory") - 1),
                               &kModuleLoadHistoryCallback, &function) != JSVM_OK
        || function == nullptr) {
        GADGET_LOG_ERROR("module events: failed to create __moduleLoadHistory");
        return false;
    }
    if (!setNamed(env, arkts, "__moduleLoadHistory", function)) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("module events: failed to install __moduleLoadHistory: %{public}s", error.c_str());
        return false;
    }
    JSVM_Value seqFunction = nullptr;
    if (OH_JSVM_CreateFunction(env, "__moduleLoadSeq",
                               static_cast<int>(sizeof("__moduleLoadSeq") - 1),
                               &kModuleLoadSeqCallback, &seqFunction) != JSVM_OK
        || seqFunction == nullptr) {
        GADGET_LOG_ERROR("module events: failed to create __moduleLoadSeq");
        return false;
    }
    if (!setNamed(env, arkts, "__moduleLoadSeq", seqFunction)) {
        std::string error;
        clearJsvmException(env, &error);
        GADGET_LOG_ERROR("module events: failed to install __moduleLoadSeq: %{public}s", error.c_str());
        return false;
    }
    return true;
}

} // namespace xpanda
