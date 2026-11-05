/**
 * Host ArkTS globalThis snapshot (see host_global.cpp).
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_HOST_GLOBAL_H
#define XPANDA_GADGET_HOST_GLOBAL_H

#include "ark_runtime/jsvm.h"
#include "napi/native_api.h"

namespace xpanda {

/** Capture the host globalThis on the host JS thread (start()). */
void captureHostGlobalSnapshot(napi_env env);

/** Attach the captured snapshot as `arkts.__snapshot` (JSVM). */
bool installHostGlobalSnapshot(JSVM_Env env, JSVM_Value arkts);

} // namespace xpanda

#endif // XPANDA_GADGET_HOST_GLOBAL_H
