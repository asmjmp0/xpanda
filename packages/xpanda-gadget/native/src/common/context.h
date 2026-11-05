/**
 * Shared process state for the gadget native modules.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_CONTEXT_H
#define XPANDA_GADGET_CONTEXT_H

#include "socket/socket_server.h"

namespace xpanda {

/**
 * Process-wide socket server. The NAPI exports own its lifecycle (start/stop);
 * the console bridge only broadcasts to the currently connected clients.
 */
SocketServer& socketServer();

} // namespace xpanda

#endif // XPANDA_GADGET_CONTEXT_H
