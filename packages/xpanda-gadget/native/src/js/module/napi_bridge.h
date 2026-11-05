/**
 * Host NAPI bridge: ArkTS.napi helpers and the host call proxy (see napi_bridge.cpp).
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_NAPI_BRIDGE_H
#define XPANDA_GADGET_NAPI_BRIDGE_H

#include <string>

#include "ark_runtime/jsvm.h"
#include "napi/native_api.h"

namespace xpanda {

/** Install globalThis.ArkTS.napi on the host runtime and remember its env. */
void captureHostNapi(napi_env env);

/** Attach `__hostInvoke` / `__loadModule` / `__loadModuleWithInfo` to ArkTS. */
bool installNapiBridge(JSVM_Env env, JSVM_Value arkts);

/** Release host module references created by ArkTS.napi.loadModule(). */
void releaseHostModules();

/** Host NAPI env captured by captureHostNapi() (nullptr before start()). */
napi_env hostBridgeEnv();

/** Resolve a raw or `@id` host path for another bridge module. */
bool resolveHostPathForBridge(const std::string& path, napi_value* receiver,
                              napi_value* target, std::string* error);

/** Keep a host value alive and return a temporary host module id (0 on failure). */
int retainHostValue(napi_value value);

/** Release an id returned by retainHostValue(). */
void releaseHostValue(int id);

/** Read and clear the pending host NAPI exception. */
std::string takeHostException(const std::string& fallback);

} // namespace xpanda

#endif // XPANDA_GADGET_NAPI_BRIDGE_H
