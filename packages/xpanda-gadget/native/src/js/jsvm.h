/**
 * Gadget JSVM lifecycle and script evaluation.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_JSVM_H
#define XPANDA_GADGET_JSVM_H

#include <cstddef>
#include <string>

#include "ark_runtime/jsvm.h"

namespace xpanda {

/**
 * Create the VM/Env on the calling (JS) thread. Idempotent; the console bridge
 * is installed as part of the first successful creation.
 */
bool ensureJsvm(std::string* error);

/** Destroy the VM/Env (a fresh VM is created on the next evaluation). JS thread only. */
void destroyJsvm();

/** Evaluate `code` in the gadget VM and stringify its result. JS thread only. */
bool evaluateInJsvm(const std::string& code, std::string* valueJson, std::string* error);

/** JSVM health probe (`probe` request): ensure the runtime and report VM information. */
bool runJsvmProbe(std::string* valueJson, std::string* error);

/**
 * Call a replacement function installed by ArkTS.patch.patchMethod(). The
 * host-side trampoline passes a temporary host instance id (for `this`) and an
 * optional bound-original id; argsJson is a JSON array of the original args.
 * JS thread only.
 */
bool callJsvmPatch(JSVM_Ref fnRef, int instanceId, int originalId,
                   const std::string& argsJson,
                   std::string* resultJson, std::string* error);

/**
 * Dispatch one module-load event to `ArkTS.__moduleLoadEvent(sequence, record)`
 * in the gadget VM. JS thread only; a no-op when the VM has not been created yet
 * (the event remains in the native history and is replayed by onModuleLoaded).
 * `sequence` is 1-based and lets callbacks skip events already replayed from the
 * history at registration time.
 */
bool dispatchModuleLoadInJsvm(std::size_t sequence, const std::string& record, std::string* error);

} // namespace xpanda

#endif // XPANDA_GADGET_JSVM_H
