/**
 * Socket server implementation (see socket/socket_server.h).
 * @Author: jmp0
 */
#include "socket/socket_server.h"

#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <cstring>

#include "common/mini_json.h"

namespace xpanda {

bool SocketServer::start(const Config& config, std::string* err) {
    if (running_.load()) {
        if (err) *err = "already running";
        return false;
    }
    const std::string name = !config.name.empty()
        ? config.name
        : "xpanda_gadget_" + std::to_string(kDefaultPort);

    int listenFd = -1;
    if (!listenAbstract(name, &listenFd, err)) return false;
    endpoint_ = "localabstract:" + name;
    startTime_ = std::chrono::steady_clock::now();

    running_.store(true);
    try {
        acceptThread_ = std::thread([this, listenFd]() { acceptLoop(listenFd); });
    } catch (const std::exception& e) {
        running_.store(false);
        ::close(listenFd);
        endpoint_.clear();
        if (err) *err = std::string("failed to spawn accept thread: ") + e.what();
        return false;
    }
    return true;
}

bool SocketServer::listenAbstract(const std::string& name, int* outFd, std::string* err) {
    int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        if (err) *err = std::string("socket(AF_UNIX) failed: ") + std::strerror(errno);
        return false;
    }
    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    // abstract namespace: leading NUL, name follows (Linux/OHOS)
    if (name.size() + 1 >= sizeof(address.sun_path)) {
        if (err) *err = "abstract socket name too long";
        ::close(fd);
        return false;
    }
    std::memcpy(address.sun_path + 1, name.data(), name.size());
    socklen_t length = offsetof(sockaddr_un, sun_path) + 1 + name.size();
    if (::bind(fd, reinterpret_cast<sockaddr*>(&address), length) != 0) {
        if (err) *err = std::string("abstract bind() failed: ") + std::strerror(errno);
        ::close(fd);
        return false;
    }
    if (::listen(fd, 4) != 0) {
        if (err) *err = std::string("listen() failed: ") + std::strerror(errno);
        ::close(fd);
        return false;
    }
    *outFd = fd;
    return true;
}

void SocketServer::stop() {
    if (!running_.exchange(false)) return;
    clientCv_.notify_all();
    {
        std::lock_guard<std::mutex> lock(clientsMutex_);
        for (int fd : clientFds_) ::shutdown(fd, SHUT_RDWR);
    }
    endpoint_.clear();
    if (acceptThread_.joinable()) acceptThread_.join();
}

bool SocketServer::waitForClient(int timeoutMs) {
    std::unique_lock<std::mutex> lock(clientsMutex_);
    if (!clientFds_.empty()) return true;
    if (!running_.load()) return false;
    if (timeoutMs <= 0) return false;
    clientCv_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this]() {
        return !clientFds_.empty() || !running_.load();
    });
    return running_.load() && !clientFds_.empty();
}

SocketServer::HeldRequestPtr SocketServer::takeHeldRequest(int timeoutMs) {
    std::unique_lock<std::mutex> lock(heldMutex_);
    bool parked = heldCv_.wait_for(lock, std::chrono::milliseconds(timeoutMs),
                                   [this]() { return heldRequest_ != nullptr; });
    if (!parked) return nullptr;
    HeldRequestPtr request = heldRequest_;
    heldRequest_ = nullptr;
    return request;
}

void SocketServer::completeHeldRequest(const HeldRequestPtr& request, bool ok, const std::string& payload) {
    {
        std::lock_guard<std::mutex> lock(request->mutex);
        request->done = true;
        request->ok = ok;
        request->payload = payload;
    }
    request->cv.notify_all();
}

void SocketServer::failHeldRequest(const std::string& error) {
    HeldRequestPtr request;
    {
        std::lock_guard<std::mutex> lock(heldMutex_);
        request = heldRequest_;
        heldRequest_ = nullptr;
    }
    if (request) completeHeldRequest(request, false, error);
}

uint64_t SocketServer::uptimeMs() const {
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - startTime_).count());
}

void SocketServer::broadcast(const std::string& line) {
    std::lock_guard<std::mutex> lock(clientsMutex_);
    for (int fd : clientFds_) {
        std::string payload = line + "\n";
        ssize_t ignored = ::send(fd, payload.data(), payload.size(), MSG_NOSIGNAL);
        (void)ignored;
    }
}

bool SocketServer::pollInbox(std::string* out) {
    std::lock_guard<std::mutex> lock(inboxMutex_);
    if (inbox_.empty()) return false;
    *out = std::move(inbox_.front());
    inbox_.pop_front();
    return true;
}

void SocketServer::acceptLoop(int listenFd) {
    while (running_.load()) {
        sockaddr_un peer{};
        socklen_t peerLength = sizeof(peer);
        int fd = ::accept(listenFd, reinterpret_cast<sockaddr*>(&peer), &peerLength);
        if (fd < 0) {
            if (!running_.load()) break;
            continue;
        }
        addClient(fd);
        try {
            std::thread([this, fd]() { clientLoop(fd); }).detach();
        } catch (...) {
            removeClient(fd);
            ::close(fd);
        }
    }
    ::close(listenFd);
}

void SocketServer::addClient(int fd) {
    {
        std::lock_guard<std::mutex> lock(clientsMutex_);
        clientFds_.push_back(fd);
    }
    clientCv_.notify_all();
}

void SocketServer::removeClient(int fd) {
    std::lock_guard<std::mutex> lock(clientsMutex_);
    for (size_t i = 0; i < clientFds_.size(); i++) {
        if (clientFds_[i] == fd) {
            clientFds_.erase(clientFds_.begin() + static_cast<long>(i));
            break;
        }
    }
}

void SocketServer::clientLoop(int fd) {
    std::string pending;
    char buffer[16 * 1024];
    while (running_.load()) {
        ssize_t received = ::recv(fd, buffer, sizeof(buffer), 0);
        if (received <= 0) break;
        pending.append(buffer, static_cast<size_t>(received));
        size_t newline;
        while ((newline = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, newline);
            pending.erase(0, newline + 1);
            if (line.empty()) continue;
            if (line.size() > kMaxLineLength) continue;
            handleLine(fd, line);
        }
        if (pending.size() > kMaxLineLength) break;
    }
    removeClient(fd);
    ::close(fd);
}

void SocketServer::reply(int fd, const std::string& line) {
    std::string payload = line + "\n";
    std::lock_guard<std::mutex> lock(clientsMutex_);
    ssize_t ignored = ::send(fd, payload.data(), payload.size(), MSG_NOSIGNAL);
    (void)ignored;
}

void SocketServer::handleLine(int fd, const std::string& line) {
    using mini = MiniJson;
    std::string idRaw = mini::findRawValue(line, "id");
    if (idRaw.empty()) idRaw = "null";
    std::string typeRaw = mini::findRawValue(line, "type");
    std::string type;
    if (!mini::unescape(typeRaw, &type)) {
        reply(fd, "{\"id\":" + idRaw + ",\"type\":\"error\",\"error\":\"missing or malformed type\"}");
        return;
    }

    if (type == "ping") {
        reply(fd, "{\"type\":\"pong\"}");
        return;
    }
    if (type == "info") {
        std::string text = "{\"id\":" + idRaw + ",\"type\":\"info\",\"pid\":" + std::to_string(::getpid())
            + ",\"running\":" + (running_.load() ? "true" : "false")
            + ",\"js\":" + (hasJsExecutor() ? "true" : "false")
            + (hasJsExecutor() ? "" : ",\"jsError\":" + mini::escape(jsError_))
            + ",\"version\":" + mini::escape(kGadgetVersion)
            + ",\"endpoint\":" + mini::escape(endpoint_)
            + ",\"uptimeMs\":" + std::to_string(uptimeMs()) + "}";
        reply(fd, text);
        return;
    }
    if (type == "js") {
        std::string codeRaw = mini::findRawValue(line, "code");
        std::string code;
        if (!mini::unescape(codeRaw, &code)) {
            reply(fd, "{\"id\":" + idRaw + ",\"type\":\"result\",\"ok\":false,\"error\":\"missing or malformed code\"}");
            return;
        }
        std::string valueJson;
        std::string error;
        std::string transport;
        bool ok = false;
        if (holdRequests_.load()) {
            // Startup hold: park the request for the JS thread (which is busy
            // holding app startup). One at a time; a second request while one
            // is parked falls through to the normal executor path.
            HeldRequestPtr held;
            {
                std::lock_guard<std::mutex> lock(heldMutex_);
                if (!heldRequest_) {
                    held = std::make_shared<HeldRequest>();
                    held->code = code;
                    heldRequest_ = held;
                }
            }
            if (held) {
                heldCv_.notify_all();
                std::unique_lock<std::mutex> lock(held->mutex);
                bool done = held->cv.wait_for(lock, std::chrono::milliseconds(120000),
                                              [&held]() { return held->done; });
                if (done) {
                    std::string text = "{\"id\":" + idRaw + ",\"type\":\"result\",\"ok\":";
                    if (held->ok) {
                        text += "true,\"value\":" + held->payload + "}";
                    } else {
                        text += "false,\"error\":" + mini::escape(held->payload) + "}";
                    }
                    reply(fd, text);
                    return;
                }
                reply(fd, "{\"id\":" + idRaw
                    + ",\"type\":\"result\",\"ok\":false,\"error\":\"startup hold timed out\"}");
                return;
            }
        }
        if (hasJsExecutor()) {
            ok = jsExecutor_(code, &valueJson, &error, 10000, &transport);
        } else {
            transport = "js runtime not attached: " + jsError_;
        }
        std::string text = "{\"id\":" + idRaw + ",\"type\":\"result\",\"ok\":";
        if (ok) {
            text += "true,\"value\":" + valueJson + "}";
        } else {
            std::string message = !error.empty() ? error : (!transport.empty() ? transport : "unknown failure");
            text += "false,\"error\":" + mini::escape(message) + "}";
        }
        reply(fd, text);
        return;
    }
    if (type == "probe") {
        if (!probeExecutor_) {
            reply(fd, "{\"id\":" + idRaw + ",\"type\":\"probe\",\"ok\":false,\"error\":\"probe not available\"}");
            return;
        }
        std::string report;
        std::string error;
        bool ok = probeExecutor_(&report, &error);
        if (ok) {
            reply(fd, "{\"id\":" + idRaw + ",\"type\":\"probe\",\"ok\":true,\"report\":" + report + "}");
        } else {
            reply(fd, "{\"id\":" + idRaw + ",\"type\":\"probe\",\"ok\":false,\"error\":" + mini::escape(error) + "}");
        }
        return;
    }
    if (type == "reset") {
        if (!resetExecutor_) {
            reply(fd, "{\"id\":" + idRaw + ",\"type\":\"reset\",\"ok\":false,\"error\":\"reset not available\"}");
            return;
        }
        std::string error;
        bool ok = resetExecutor_(&error);
        reply(fd, ok
            ? "{\"id\":" + idRaw + ",\"type\":\"reset\",\"ok\":true}"
            : "{\"id\":" + idRaw + ",\"type\":\"reset\",\"ok\":false,\"error\":" + mini::escape(error) + "}");
        return;
    }
    if (type == "msg") {
        std::string payloadRaw = mini::findRawValue(line, "payload");
        if (payloadRaw.empty()) {
            reply(fd, "{\"id\":" + idRaw + ",\"type\":\"error\",\"error\":\"missing payload\"}");
            return;
        }
        {
            std::lock_guard<std::mutex> lock(inboxMutex_);
            inbox_.push_back("{\"type\":\"msg\",\"payload\":" + payloadRaw + "}");
        }
        reply(fd, "{\"id\":" + idRaw + ",\"type\":\"ok\"}");
        return;
    }
    reply(fd, "{\"id\":" + idRaw + ",\"type\":\"error\",\"error\":" + mini::escape("unknown type: " + type) + "}");
}

} // namespace xpanda
