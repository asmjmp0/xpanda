/**
 * Module metadata bridge for the gadget JSVM.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_METADATA_BRIDGE_H
#define XPANDA_GADGET_METADATA_BRIDGE_H

#include <string>

#include "ark_runtime/jsvm.h"

namespace xpanda {

/**
 * Store the user module metadata (a JSON array of {record, exports}) handed
 * over by gadget.start({ userModules }). installModuleMetadata() also
 * runs on every VM creation (from installHostBridge) so the metadata survives
 * a .reset.
 */
void storeUserModuleMetadata(const std::string& json);

/**
 * Store the bundle/module context ("<bundleName>/<moduleName>") baked by the
 * injector; exposed as ArkTS.metadata.moduleInfo and used by the bridge's
 * loadUserModule helper. Empty string clears it.
 */
void storeModuleInfo(const std::string& moduleInfo);

/**
 * Build `ArkTS.metadata.getAllUserModule()` in the gadget JSVM through the
 * JSVM C API — no script evaluation and nothing assigned through globalThis:
 * the metadata object is attached directly to the existing ArkTS object.
 * JS thread only, with the VM/env scopes already open. Leaves ArkTS.metadata
 * undefined when nothing was stored or the install fails.
 */
void installUserModuleMetadata(JSVM_Env env);

} // namespace xpanda

#endif // XPANDA_GADGET_METADATA_BRIDGE_H
