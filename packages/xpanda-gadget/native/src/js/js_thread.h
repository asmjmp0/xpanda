/**
 * JS thread bridge: queue work from socket/client threads onto the host JS thread.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_JS_THREAD_H
#define XPANDA_GADGET_JS_THREAD_H

#include <string>

#include "napi/native_api.h"

namespace xpanda {

/** Create the thread-safe function used to hop onto the host JS thread. */
bool startJsBridge(napi_env env, std::string* error);
/** Release the thread-safe function. */
void stopJsBridge();
bool isJsBridgeReady();

/** Socket-thread entry: evaluate JS on the JS thread and wait for the result. */
bool executeOnJsThread(const std::string& code, std::string* valueJson, std::string* error,
                       int timeoutMs, std::string* err);

/** Socket-thread entry for the `probe` request: run the JSVM diagnosis on the JS thread. */
bool probeOnJsThread(std::string* report, std::string* error);

/** Socket-thread entry for the `reset` request: destroy the VM on the JS thread. */
bool resetOnJsThread(std::string* error);

} // namespace xpanda

#endif // XPANDA_GADGET_JS_THREAD_H
