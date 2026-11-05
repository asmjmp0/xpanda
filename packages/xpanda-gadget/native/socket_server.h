/**
 * Gadget socket server: NDJSON protocol over an abstract unix socket.
 *
 * HarmonyOS app SELinux policies deny raw TCP listen() for untrusted-app domains,
 * so the gadget listens on an abstract unix socket (Linux namespace, no filesystem
 * node). The host reaches it through port forwarding:
 *   hdc fport tcp:27041 localabstract:xpanda_gadget_27041
 *
 * Client -> gadget:  {"id":1,"type":"js","code":"1+1"}
 *                    {"id":2,"type":"msg","payload":{"any":"json"}}
 *                    {"id":3,"type":"info"}
 *                    {"type":"ping"}
 * Gadget -> client:  {"id":1,"type":"result","ok":true,"value":2}
 *                    {"id":2,"type":"ok"}                              (msg accepted -> ArkTS inbox)
 *                    {"type":"msg","payload":<raw>}                    (pushed from ArkTS send())
 *                    {"id":3,"type":"info","pid":..,"endpoint":"localabstract:..","version":"1.0.0","uptimeMs":..}
 *                    {"type":"pong"}
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_SOCKET_SERVER_H
#define XPANDA_GADGET_SOCKET_SERVER_H

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace xpanda {

inline constexpr const char* kGadgetVersion = "1.0.0";
/** Upper bound for a single protocol line. */
inline constexpr size_t kMaxLineLength = 8 * 1024 * 1024;
/** Default port number, only used to derive the socket name and the fport convention. */
inline constexpr int kDefaultPort = 27041;

class SocketServer {
public:
    /** Executes JS on the host runtime's JS thread and fills valueJson / error. */
    using JsExecutor = std::function<bool(const std::string& code, std::string* valueJson,
                                          std::string* error, int timeoutMs, std::string* err)>;

    struct Config {
        /** Abstract unix socket name (leading NUL implied). Default "xpanda_gadget_<port>". */
        std::string name;
    };

    /** Bind + listen on the abstract unix socket + spawn the accept loop. */
    bool start(const Config& config, std::string* err);
    /** Close the listener and every client socket. */
    void stop();

    /** Attach the JS executor (host ArkTS runtime). nullptr disables the "js" request type. */
    void setJsExecutor(JsExecutor executor) { jsExecutor_ = std::move(executor); }
    bool hasJsExecutor() const { return static_cast<bool>(jsExecutor_); }
    std::string jsError() const { return jsError_; }
    void setJsError(std::string error) { jsError_ = std::move(error); }

    /** Diagnostic `probe` request: run the libjsvm step-by-step diagnosis. */
    using ProbeExecutor = std::function<bool(std::string* report, std::string* error)>;
    void setProbeExecutor(ProbeExecutor executor) { probeExecutor_ = std::move(executor); }

    /** `reset` request: destroy the JS runtime (the next evaluation recreates a fresh VM). */
    using ResetExecutor = std::function<bool(std::string* error)>;
    void setResetExecutor(ResetExecutor executor) { resetExecutor_ = std::move(executor); }

    bool isRunning() const { return running_.load(); }
    /** Host-facing endpoint hint, e.g. "localabstract:xpanda_gadget_27041". */
    std::string endpoint() const { return endpoint_; }
    uint64_t uptimeMs() const;

    /** Push a complete JSON line to every connected client (ArkTS thread). */
    void broadcast(const std::string& line);
    /** Pop one client message (a complete JSON line); false when the inbox is empty. */
    bool pollInbox(std::string* out);

private:
    void acceptLoop(int listenFd);
    void clientLoop(int fd);
    void handleLine(int fd, const std::string& line);
    void reply(int fd, const std::string& line);
    void addClient(int fd);
    void removeClient(int fd);
    bool listenAbstract(const std::string& name, int* outFd, std::string* err);

    std::atomic<bool> running_{false};
    std::string endpoint_;
    std::chrono::steady_clock::time_point startTime_{};
    std::thread acceptThread_;

    std::mutex clientsMutex_;
    std::vector<int> clientFds_;

    std::mutex inboxMutex_;
    std::deque<std::string> inbox_;

    JsExecutor jsExecutor_;
    ProbeExecutor probeExecutor_;
    ResetExecutor resetExecutor_;
    std::string jsError_;
};

} // namespace xpanda

#endif // XPANDA_GADGET_SOCKET_SERVER_H
