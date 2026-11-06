/**
 * JS thread bridge (see js/js_thread.h).
 *
 * The socket client threads must not touch the JSVM directly: V8 is only safe
 * on the host JS thread. Every request becomes a JsJob queued for a uv_async
 * handle on the host event loop; the waiting thread blocks until the job
 * completes on the host JS thread.
 *
 * The host event loop is used instead of a napi_threadsafe_function because
 * OpenHarmony's module loader is not re-entrant from a TSFN callback:
 * napi_load_module_with_info() can SIGSEGV when it has to execute a local
 * module there. A uv_async callback is a normal host-event-loop callback, so
 * ArkTS module loading works from the gadget VM as well.
 * @Author: jmp0
 */
#include "js/js_thread.h"

#include <uv.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>

#include "common/log.h"
#include "js/jsvm.h"

namespace xpanda {

static constexpr int kJsTimeoutMs = 10000;

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
    /** Module-load dispatch: fire-and-forget job, deleted by the drain loop. */
    bool moduleLoad = false;
    bool detached = false;
    std::size_t sequence = 0;
    std::string record;
    std::mutex mutex;
    std::condition_variable cv;
};

namespace {

struct BridgeState {
    std::atomic<bool> ready{false};
    uv_loop_t* loop = nullptr;
    uv_async_t* async = nullptr;
    std::mutex mutex;
    std::deque<JsJob*> jobs;
};

BridgeState g_bridge;

/** Wake every waiter and let it (or the abandon path) release the job. */
void completeJob(JsJob* job, bool ok, std::string valueJson, std::string error) {
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

/** Run one job on the host JS thread. */
void runJob(JsJob* job) {
    std::string valueJson;
    std::string error;
    bool ok = false;
    if (job->probe) {
        ok = runJsvmProbe(&valueJson, &error);
    } else if (job->reset) {
        destroyJsvm();
        valueJson = "null";
        ok = true;
    } else if (job->moduleLoad) {
        ok = dispatchModuleLoadInJsvm(job->sequence, job->record, &error);
    } else {
        ok = evaluateInJsvm(job->code, &valueJson, &error);
    }
    if (job->detached) {
        if (!ok && !error.empty()) {
            GADGET_LOG_ERROR("module-load dispatch failed: %{public}s", error.c_str());
        }
        delete job;
        return;
    }
    completeJob(job, ok, std::move(valueJson), std::move(error));
}

/** uv_async callback: runs on the host event loop (the host JS thread). */
void DrainJobs(uv_async_t* handle) {
    (void)handle;
    std::deque<JsJob*> jobs;
    {
        std::lock_guard<std::mutex> lock(g_bridge.mutex);
        jobs.swap(g_bridge.jobs);
    }
    for (JsJob* job : jobs) runJob(job);
}

/**
 * Queue a job and wait for it. Returns 1 when the job completed (the caller
 * reads and deletes it), 0 when it could not be queued (already deleted), and
 * -1 on timeout (the event loop still owns it and deletes it later).
 */
int submitJob(JsJob* job, int timeoutMs, std::string* err) {
    {
        std::lock_guard<std::mutex> lock(g_bridge.mutex);
        if (!g_bridge.ready.load() || g_bridge.async == nullptr) {
            if (err) *err = "js runtime not attached";
            delete job;
            return 0;
        }
        g_bridge.jobs.push_back(job);
        if (uv_async_send(g_bridge.async) != 0) {
            // No other thread can enqueue while the mutex is held; the last
            // element is the job we just pushed.
            g_bridge.jobs.pop_back();
            if (err) *err = "failed to post work to the js event loop";
            delete job;
            return 0;
        }
    }

    std::unique_lock<std::mutex> lock(job->mutex);
    bool finished = job->cv.wait_for(lock, std::chrono::milliseconds(timeoutMs),
                                     [job]() { return job->done; });
    if (!finished) {
        // The predicate may have become true exactly at the deadline; the
        // completion thread only deletes abandoned jobs, so re-check here.
        if (job->done) {
            lock.unlock();
            return 1;
        }
        // The event loop may still complete this job; it deletes it then.
        job->abandoned = true;
        if (err) *err = "js execution timed out";
        return -1;
    }
    lock.unlock();
    return 1;
}

} // namespace

bool startJsBridge(napi_env env, std::string* error) {
    if (g_bridge.ready.load()) return true;

    // napi_get_uv_event_loop is deprecated since API 16 but is still the only
    // exposed way to reach the host loop (napi_send_event is not in the NDK).
    uv_loop_t* loop = nullptr;
    if (napi_get_uv_event_loop(env, &loop) != napi_ok || loop == nullptr) {
        if (error) *error = "napi_get_uv_event_loop failed";
        return false;
    }

    if (g_bridge.async == nullptr) {
        auto* async = new uv_async_t();
        if (uv_async_init(loop, async, DrainJobs) != 0) {
            delete async;
            if (error) *error = "uv_async_init failed";
            GADGET_LOG_ERROR("uv_async_init failed");
            return false;
        }
        // The gadget must not keep the application's event loop alive.
        uv_unref(reinterpret_cast<uv_handle_t*>(async));
        g_bridge.async = async;
        g_bridge.loop = loop;
    } else if (g_bridge.loop != loop) {
        if (error) *error = "js bridge is attached to a different event loop";
        return false;
    }

    g_bridge.ready.store(true);
    return true;
}

void stopJsBridge() {
    g_bridge.ready.store(false);

    std::deque<JsJob*> jobs;
    {
        std::lock_guard<std::mutex> lock(g_bridge.mutex);
        jobs.swap(g_bridge.jobs);
    }
    for (JsJob* job : jobs) {
        if (job->detached) {
            delete job;
            continue;
        }
        completeJob(job, false, "", "js bridge stopped");
    }
}

bool isJsBridgeReady() {
    return g_bridge.ready.load();
}

bool executeOnJsThread(const std::string& code, std::string* valueJson, std::string* error,
                       int timeoutMs, std::string* err) {
    auto* job = new JsJob();
    job->code = code;
    int state = submitJob(job, timeoutMs, err);
    if (state != 1) return false;

    bool ok = job->ok;
    if (ok) {
        if (valueJson) *valueJson = job->valueJson;
    } else {
        if (error) *error = job->error;
    }
    delete job;
    return ok;
}

bool probeOnJsThread(std::string* report, std::string* error) {
    auto* job = new JsJob();
    job->probe = true;
    int state = submitJob(job, 20000, error);
    if (state != 1) return false;

    bool ok = job->ok;
    if (report) *report = job->valueJson;
    if (!ok && error) *error = job->error;
    delete job;
    return ok;
}

bool resetOnJsThread(std::string* error) {
    auto* job = new JsJob();
    job->reset = true;
    int state = submitJob(job, kJsTimeoutMs, error);
    if (state != 1) return false;

    bool ok = job->ok;
    if (!ok && error) *error = job->error;
    delete job;
    return ok;
}

bool postModuleLoadEvent(const std::string& record, std::size_t sequence) {
    if (!g_bridge.ready.load() || g_bridge.async == nullptr) return false;
    auto* job = new JsJob();
    job->moduleLoad = true;
    job->detached = true;
    job->sequence = sequence;
    job->record = record;
    {
        std::lock_guard<std::mutex> lock(g_bridge.mutex);
        if (!g_bridge.ready.load() || g_bridge.async == nullptr) {
            delete job;
            return false;
        }
        g_bridge.jobs.push_back(job);
        if (uv_async_send(g_bridge.async) != 0) {
            g_bridge.jobs.pop_back();
            delete job;
            return false;
        }
    }
    return true;
}

} // namespace xpanda
