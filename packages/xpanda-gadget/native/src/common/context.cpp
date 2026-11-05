/**
 * Shared process state for the gadget native modules (see common/context.h).
 * @Author: jmp0
 */
#include "common/context.h"

namespace xpanda {

SocketServer& socketServer() {
    static SocketServer server;
    return server;
}

} // namespace xpanda
