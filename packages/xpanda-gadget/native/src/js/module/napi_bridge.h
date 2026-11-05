/**
 * Host NAPI bridge: ArkTS.napi helpers and the host call proxy (see napi_bridge.cpp).
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_NAPI_BRIDGE_H
#define XPANDA_GADGET_NAPI_BRIDGE_H

#include "ark_runtime/jsvm.h"
#include "napi/native_api.h"

namespace xpanda {

/** Install globalThis.ArkTS.napi on the host runtime and remember its env. */
void captureHostNapi(napi_env env);

/** Attach `__hostInvoke` / `__loadModule` / `__loadModuleWithInfo` to ArkTS. */
bool installNapiBridge(JSVM_Env env, JSVM_Value arkts);

/** Release host module references created by ArkTS.napi.loadModule(). */
void releaseHostModules();

} // namespace xpanda

#endif // XPANDA_GADGET_NAPI_BRIDGE_H
