/**
 * Gadget JSVM lifecycle and script evaluation.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_JSVM_H
#define XPANDA_GADGET_JSVM_H

#include <string>

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

} // namespace xpanda

#endif // XPANDA_GADGET_JSVM_H
