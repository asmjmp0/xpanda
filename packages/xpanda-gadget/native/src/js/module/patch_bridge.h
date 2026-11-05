/**
 * Runtime method patching (ArkTS.patch.patchMethod), see patch_bridge.cpp.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_PATCH_BRIDGE_H
#define XPANDA_GADGET_PATCH_BRIDGE_H

#include "ark_runtime/jsvm.h"
#include "napi/native_api.h"

namespace xpanda {

/** Create ArkTS.__patchMethod on the JSVM ArkTS object. */
bool installPatchMethod(JSVM_Env env, JSVM_Value arkts);

/** Restore patched host methods and release their JSVM references. */
void releasePatchHooks(JSVM_Env env);

} // namespace xpanda

#endif // XPANDA_GADGET_PATCH_BRIDGE_H
