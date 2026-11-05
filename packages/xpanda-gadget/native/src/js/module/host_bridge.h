/**
 * Host ArkTS globalThis bridge for the gadget JSVM.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_HOST_BRIDGE_H
#define XPANDA_GADGET_HOST_BRIDGE_H

#include "ark_runtime/jsvm.h"
#include "napi/native_api.h"

namespace xpanda {

/**
 * Snapshot the host ArkTS globalThis on the host JS thread. Must be called from
 * a NAPI callback (e.g. start()); the snapshot is later installed into the
 * gadget JSVM, which cannot share live objects with the host runtime.
 * Function/constructor calls from the snapshot are forwarded back through NAPI.
 */
void captureHostGlobal(napi_env env);

/**
 * Install the captured snapshot as globalThis.ArkTS.hostGlobal in the gadget
 * JSVM. JS thread only.
 */
bool installHostBridge(JSVM_Env env);

/** Release host module references created by ArkTS.napi.loadModule(). */
void releaseHostModules();

} // namespace xpanda

#endif // XPANDA_GADGET_HOST_BRIDGE_H
