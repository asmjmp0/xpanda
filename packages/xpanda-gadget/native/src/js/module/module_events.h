/**
 * Module-load event history and gadget JSVM bridge.
 *
 * The injected bootstrap exports `xpandaModuleLoaded(record)` and every module
 * calls it right before its final `returnundefined` (xpanda-asm
 * patchModuleLoadCallbacks). This file keeps the ordered history so a callback
 * registered after startup (`ArkTS.onModuleLoaded`) can replay what already
 * loaded, and exposes it to the gadget JSVM as `ArkTS.__moduleLoadHistory()`.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_MODULE_EVENTS_H
#define XPANDA_GADGET_MODULE_EVENTS_H

#include <cstddef>
#include <string>

#include "ark_runtime/jsvm.h"

namespace xpanda {

/** Record one module-evaluation completion (host ArkTS JS thread). */
void recordModuleLoad(const std::string& record);

/** JSON array of every recorded module record, in load order. */
std::string moduleLoadHistoryJson();

/** Number of module-load events recorded so far (the next event has this + 1). */
std::size_t moduleLoadSequence();

/**
 * Install `ArkTS.__moduleLoadHistory()` into the gadget JSVM. Returns false when
 * the function could not be created (the rest of the bridge still works).
 */
bool installModuleLoadHistory(JSVM_Env env, JSVM_Value arkts);

} // namespace xpanda

#endif // XPANDA_GADGET_MODULE_EVENTS_H
