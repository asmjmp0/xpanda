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
 *                    {"type":"console","level":"log","text":"..."}     (console.* inside the JSVM)
 *                    {"id":3,"type":"info","pid":..,"endpoint":"localabstract:..","version":"1.0.0","uptimeMs":..}
 *                    {"type":"pong"}
 *
 * During the startup hold (gadget.start({ wait }), see setHoldRequests) "js"
 * requests are evaluated inline on the JS thread: the first scripts finish
 * before app startup continues.
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

inline constexpr const char* kGadgetVersion = "1.2.0";
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

    /**
     * Block until at least one client is connected or the timeout expires.
     * Used by gadget.start({ wait }) to hold app startup until a debugger/client
     * connects. Returns true when a client is connected.
     */
    bool waitForClient(int timeoutMs);

    /**
     * Startup hold: while armed, "js" requests are NOT dispatched to the JS
     * executor (the host JS thread is busy holding app startup inside
     * gadget.start({ wait })). They are parked instead; the JS thread pops them
     * with takeHeldRequest(), evaluates inline and completes them with
     * completeHeldRequest() — so the first scripts finish BEFORE app startup
     * continues, instead of racing with it.
     */
    void setHoldRequests(bool hold) { holdRequests_.store(hold); }

    /** A parked "js" request waiting for the startup-hold evaluation. */
    struct HeldRequest {
        std::string code;
        /** Set by completeHeldRequest; the parking client thread replies then. */
        bool done = false;
        bool ok = false;
        /** value JSON when ok, error text otherwise. */
        std::string payload;
        std::mutex mutex;
        std::condition_variable cv;
    };
    using HeldRequestPtr = std::shared_ptr<HeldRequest>;

    /** Wait up to timeoutMs for the next parked "js" request; pops it (null on timeout). */
    HeldRequestPtr takeHeldRequest(int timeoutMs);
    /** Mark a parked request done; the parking client thread replies from its payload. */
    static void completeHeldRequest(const HeldRequestPtr& request, bool ok, const std::string& payload);
    /** Fail a request still parked when the hold disarms. */
    void failHeldRequest(const std::string& error);

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
    std::condition_variable clientCv_;
    std::vector<int> clientFds_;

    std::mutex inboxMutex_;
    std::deque<std::string> inbox_;

    JsExecutor jsExecutor_;
    ProbeExecutor probeExecutor_;
    ResetExecutor resetExecutor_;
    std::string jsError_;

    std::atomic<bool> holdRequests_{false};
    std::mutex heldMutex_;
    std::condition_variable heldCv_;
    HeldRequestPtr heldRequest_;
};

} // namespace xpanda

#endif // XPANDA_GADGET_SOCKET_SERVER_H
