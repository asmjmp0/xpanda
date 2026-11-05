/**
 * console.* bridge for the gadget JSVM.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_CONSOLE_H
#define XPANDA_GADGET_CONSOLE_H

#include "ark_runtime/jsvm.h"

namespace xpanda {

/**
 * Install the console object on the JSVM global (after CreateEnv). The methods
 * broadcast `{"type":"console","level":...,"text":...}` to connected clients and
 * mirror the same line to hilog.
 */
bool installConsole(JSVM_Env env);

} // namespace xpanda

#endif // XPANDA_GADGET_CONSOLE_H
