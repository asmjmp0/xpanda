/**
 * JS thread bridge (see js/js_thread.h).
 *
 * The socket client threads must not touch the JSVM directly: V8 is only safe
 * on the host JS thread. Every request becomes a JsJob handed to a
 * napi_threadsafe_function; the waiting thread blocks until CallJs completes.
 * @Author: jmp0
 */
#include "js/js_thread.h"

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>

#include "common/log.h"
#include "js/jsvm.h"

namespace xpanda {

static constexpr int kJsTimeoutMs = 10000;
static napi_threadsafe_function g_jsThreadFunction = nullptr;

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
    (void)jsCallback;
    (void)context;
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
        ok = evaluateInJsvm(job->code, &valueJson, &error);
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

bool startJsBridge(napi_env env, std::string* error) {
    if (g_jsThreadFunction != nullptr) return true;
    napi_value resourceName = nullptr;
    napi_create_string_utf8(env, "xpanda-gadget", NAPI_AUTO_LENGTH, &resourceName);
    napi_status status = napi_create_threadsafe_function(
        env, nullptr, nullptr, resourceName, 0, 1, nullptr, nullptr, nullptr, CallJs, &g_jsThreadFunction);
    if (status != napi_ok) {
        g_jsThreadFunction = nullptr;
        if (error) {
            *error = "napi_create_threadsafe_function failed ("
                + std::to_string(static_cast<int>(status)) + ")";
        }
        GADGET_LOG_ERROR("thread-safe function creation failed (%{public}d)", static_cast<int>(status));
        return false;
    }
    return true;
}

void stopJsBridge() {
    if (g_jsThreadFunction == nullptr) return;
    napi_release_threadsafe_function(g_jsThreadFunction, napi_tsfn_release);
    g_jsThreadFunction = nullptr;
}

bool isJsBridgeReady() {
    return g_jsThreadFunction != nullptr;
}

bool executeOnJsThread(const std::string& code, std::string* valueJson, std::string* error,
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

bool probeOnJsThread(std::string* report, std::string* error) {
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

bool resetOnJsThread(std::string* error) {
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

} // namespace xpanda
