// icmp-ping/addon.cpp — Native ICMP ping, fully async on one thread.
//
// Windows : IcmpSendEcho2 (async with events) + WaitForMultipleObjects
// POSIX   : non-blocking SOCK_DGRAM/IPPROTO_ICMP + poll()
//
// A single long-lived "ping manager" thread is created in Init() and
// joined in Shutdown().  Incoming requests are queued via a mutex and a
// wake signal.  Results are posted back to JS via a TypedThreadSafeFunction.
//
// No libuv thread-pool threads are consumed.  No per-ping OS threads.
#include "napi.h"
#include <string>
#include <cstring>
#include <chrono>
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>

#if defined(_WIN32)
  #define NOMINMAX
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #include <iphlpapi.h>
  #include <icmpapi.h>
#else
  #include <sys/types.h>
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <netinet/ip_icmp.h>
  #include <arpa/inet.h>
  #include <netdb.h>
  #include <unistd.h>
  #include <poll.h>
  #include <fcntl.h>
  #include <errno.h>
#endif

// ---------------------------------------------------------------------------
// Forward declarations for TSFN template
// ---------------------------------------------------------------------------
struct PingRequest;
static void CallJs(Napi::Env env, Napi::Function jsCallback,
                   void* context, PingRequest* data);

using TSFN = Napi::TypedThreadSafeFunction<void, PingRequest, CallJs>;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------
static TSFN tsfn;
static std::atomic<bool> shutting_down{false};
static std::thread ping_thread;
static std::mutex queue_mutex;
static std::vector<PingRequest*> ping_queue;

#if defined(_WIN32)
static HANDLE wake_event = NULL;          // auto-reset
#else
static int wake_pipe[2] = {-1, -1};
#endif

// ---------------------------------------------------------------------------
// Per-ping request (allocated on JS thread, freed in CallJs or on abort)
// ---------------------------------------------------------------------------
struct PingRequest {
    Napi::Promise::Deferred deferred;
    std::string host;
    int timeout_ms;
    bool alive = false;
    double elapsed_ms = 0.0;
    std::string error;

    PingRequest(Napi::Env env, const std::string& h, int t)
        : deferred(Napi::Promise::Deferred::New(env)), host(h), timeout_ms(t) {}
};

// ---------------------------------------------------------------------------
// TSFN callback — runs on the JS event-loop thread
// ---------------------------------------------------------------------------
static void CallJs(Napi::Env env, Napi::Function /*jsCallback*/,
                   void* /*context*/, PingRequest* data) {
    if (data == nullptr) return;
    if (env != nullptr) {
        auto obj = Napi::Object::New(env);
        obj.Set("alive", Napi::Boolean::New(env, data->alive));
        obj.Set("elapsed", Napi::Number::New(env, data->elapsed_ms));
        if (!data->error.empty()) {
            obj.Set("error", Napi::String::New(env, data->error));
        }
        data->deferred.Resolve(obj);
    }
    delete data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
static bool resolve_host(const std::string& host, struct in_addr& out) {
    struct addrinfo hints{};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    struct addrinfo* res = nullptr;
    if (getaddrinfo(host.c_str(), nullptr, &hints, &res) != 0 || !res) {
        if (res) freeaddrinfo(res);
        return false;
    }
    out = reinterpret_cast<struct sockaddr_in*>(res->ai_addr)->sin_addr;
    freeaddrinfo(res);
    return true;
}

static void post_result(PingRequest* req) {
    if (tsfn.NonBlockingCall(req) != napi_ok) {
        delete req;   // TSFN closing — discard
    }
}

static void wake_thread() {
#if defined(_WIN32)
    if (wake_event) SetEvent(wake_event);
#else
    char c = 1;
    (void)write(wake_pipe[1], &c, 1);
#endif
}

// ===================================================================
//  WINDOWS — IcmpSendEcho2 (async) + WaitForMultipleObjects
// ===================================================================
#if defined(_WIN32)

struct PendingPing {
    PingRequest* req;
    HANDLE       hIcmp;
    HANDLE       event;            // manual-reset
    std::vector<char> replyBuf;    // heap pointer survives vector moves
    std::chrono::steady_clock::time_point deadline;
};

static void ping_thread_func() {
    std::vector<PendingPing> pending;

    while (!shutting_down.load()) {

        // --- drain incoming queue, start async pings ---
        {
            std::lock_guard<std::mutex> lk(queue_mutex);
            for (auto* req : ping_queue) {
                struct in_addr addr{};
                if (!resolve_host(req->host, addr)) {
                    req->error = "DNS resolution failed for " + req->host;
                    post_result(req);
                    continue;
                }

                PendingPing pp;
                pp.req   = req;
                pp.event = CreateEvent(NULL, TRUE, FALSE, NULL); // manual-reset
                pp.hIcmp = IcmpCreateFile();
                if (pp.hIcmp == INVALID_HANDLE_VALUE) {
                    req->error = "IcmpCreateFile failed";
                    post_result(req);
                    CloseHandle(pp.event);
                    continue;
                }

                char sendBuf[] = "ezplayer-ping";
                DWORD replySize = sizeof(ICMP_ECHO_REPLY) + sizeof(sendBuf) + 8;
                pp.replyBuf.resize(replySize);

                DWORD ret = IcmpSendEcho2(
                    pp.hIcmp,
                    pp.event,       // <-- async: signal this event
                    NULL, NULL,     // no APC
                    addr.s_addr,
                    sendBuf,
                    static_cast<WORD>(sizeof(sendBuf)),
                    NULL,
                    pp.replyBuf.data(),
                    replySize,
                    static_cast<DWORD>(req->timeout_ms));

                if (ret != 0) {
                    // Completed synchronously — reply already in buffer
                    auto* reply = reinterpret_cast<PICMP_ECHO_REPLY>(
                                      pp.replyBuf.data());
                    if (reply->Status == IP_SUCCESS) {
                        req->alive = true;
                        req->elapsed_ms =
                            static_cast<double>(reply->RoundTripTime);
                    } else {
                        req->error =
                            "ICMP status " + std::to_string(reply->Status);
                    }
                    post_result(req);
                    CloseHandle(pp.event);
                    IcmpCloseHandle(pp.hIcmp);
                } else if (GetLastError() == ERROR_IO_PENDING) {
                    pp.deadline = std::chrono::steady_clock::now()
                                + std::chrono::milliseconds(req->timeout_ms);
                    pending.push_back(std::move(pp));
                } else {
                    req->error = "IcmpSendEcho2 error "
                                 + std::to_string(GetLastError());
                    post_result(req);
                    CloseHandle(pp.event);
                    IcmpCloseHandle(pp.hIcmp);
                }
            }
            ping_queue.clear();
        }

        // --- wait for any event (wake, or a ping reply) ---
        // Build handle array:  [0]=wake  [1..N]=pending events
        std::vector<HANDLE> handles;
        handles.reserve(1 + pending.size());
        handles.push_back(wake_event);
        for (auto& pp : pending) handles.push_back(pp.event);

        // Wait timeout = time until nearest pending deadline
        DWORD waitMs = INFINITE;
        if (!pending.empty()) {
            auto now = std::chrono::steady_clock::now();
            for (auto& pp : pending) {
                auto remain = std::chrono::duration_cast<
                    std::chrono::milliseconds>(pp.deadline - now).count();
                DWORD ms = remain <= 0 ? 0
                         : static_cast<DWORD>(remain);
                if (ms < waitMs) waitMs = ms;
            }
        }

        WaitForMultipleObjects(
            static_cast<DWORD>(handles.size()),
            handles.data(),
            FALSE,       // any one
            waitMs);

        // --- harvest every completed ping (manual-reset events) ---
        for (int i = static_cast<int>(pending.size()) - 1; i >= 0; --i) {
            if (WaitForSingleObject(pending[i].event, 0) != WAIT_OBJECT_0)
                continue;

            auto& pp = pending[i];
            ResetEvent(pp.event);

            DWORD n = IcmpParseReplies(pp.replyBuf.data(),
                                       static_cast<DWORD>(pp.replyBuf.size()));
            if (n > 0) {
                auto* reply = reinterpret_cast<PICMP_ECHO_REPLY>(
                                  pp.replyBuf.data());
                if (reply->Status == IP_SUCCESS) {
                    pp.req->alive = true;
                    pp.req->elapsed_ms =
                        static_cast<double>(reply->RoundTripTime);
                } else {
                    pp.req->error =
                        "ICMP status " + std::to_string(reply->Status);
                }
            } else {
                pp.req->error = "No ICMP reply";
            }
            post_result(pp.req);
            CloseHandle(pp.event);
            IcmpCloseHandle(pp.hIcmp);
            pending.erase(pending.begin() + i);
        }

        // --- expire pings that exceeded their deadline ---
        {
            auto now = std::chrono::steady_clock::now();
            for (int i = static_cast<int>(pending.size()) - 1; i >= 0; --i) {
                if (now >= pending[i].deadline) {
                    pending[i].req->error = "timeout";
                    post_result(pending[i].req);
                    CloseHandle(pending[i].event);
                    IcmpCloseHandle(pending[i].hIcmp);
                    pending.erase(pending.begin() + i);
                }
            }
        }
    }

    // --- shutdown: fail anything still outstanding ---
    for (auto& pp : pending) {
        pp.req->error = "shutting down";
        post_result(pp.req);
        CloseHandle(pp.event);
        IcmpCloseHandle(pp.hIcmp);
    }
}

// ===================================================================
//  POSIX — non-blocking ICMP socket + poll()
// ===================================================================
#else

static uint16_t icmp_checksum(const void* data, size_t len) {
    const uint16_t* buf = reinterpret_cast<const uint16_t*>(data);
    uint32_t sum = 0;
    for (size_t i = 0; i < len / 2; ++i) sum += buf[i];
    if (len & 1) sum += static_cast<const uint8_t*>(data)[len - 1];
    while (sum >> 16) sum = (sum & 0xFFFF) + (sum >> 16);
    return static_cast<uint16_t>(~sum);
}

struct PendingPing {
    PingRequest* req;
    uint16_t     seq;
    struct in_addr dest;
    std::chrono::steady_clock::time_point start;
    std::chrono::steady_clock::time_point deadline;
};

static void ping_thread_func() {
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP);
    if (sock < 0) return;   // can't ping — give up silently

    int fl = fcntl(sock, F_GETFL, 0);
    fcntl(sock, F_SETFL, fl | O_NONBLOCK);

    uint16_t next_seq = 1;
    std::vector<PendingPing> pending;

    while (!shutting_down.load()) {

        // --- drain queue, send echo requests ---
        {
            std::lock_guard<std::mutex> lk(queue_mutex);
            for (auto* req : ping_queue) {
                struct in_addr addr{};
                if (!resolve_host(req->host, addr)) {
                    req->error = "DNS resolution failed for " + req->host;
                    post_result(req);
                    continue;
                }

                struct __attribute__((packed)) {
                    uint8_t  type;
                    uint8_t  code;
                    uint16_t checksum;
                    uint16_t id;
                    uint16_t seq;
                    char     payload[16];
                } pkt{};

                uint16_t sq = next_seq++;
                pkt.type = 8;
                pkt.id   = htons(static_cast<uint16_t>(getpid() & 0xFFFF));
                pkt.seq  = htons(sq);
                std::memcpy(pkt.payload, "ezplayer-ping\0\0", 15);
                pkt.checksum = icmp_checksum(&pkt, sizeof(pkt));

                struct sockaddr_in dst{};
                dst.sin_family  = AF_INET;
                dst.sin_addr    = addr;

                if (sendto(sock, &pkt, sizeof(pkt), 0,
                           reinterpret_cast<struct sockaddr*>(&dst),
                           sizeof(dst)) < 0) {
                    req->error = std::string("sendto: ") + strerror(errno);
                    post_result(req);
                    continue;
                }

                auto now = std::chrono::steady_clock::now();
                pending.push_back({req, sq, addr, now,
                    now + std::chrono::milliseconds(req->timeout_ms)});
            }
            ping_queue.clear();
        }

        // --- poll: socket + wake pipe ---
        struct pollfd fds[2];
        fds[0] = {sock,          POLLIN, 0};
        fds[1] = {wake_pipe[0],  POLLIN, 0};

        int poll_ms = 200;  // default wake-up interval
        if (!pending.empty()) {
            auto nearest = pending[0].deadline;
            for (auto& pp : pending)
                if (pp.deadline < nearest) nearest = pp.deadline;
            auto remain = std::chrono::duration_cast<std::chrono::milliseconds>(
                              nearest - std::chrono::steady_clock::now()).count();
            if (remain < poll_ms) poll_ms = remain < 0 ? 0 : static_cast<int>(remain);
        }

        poll(fds, 2, poll_ms);

        // drain wake pipe
        if (fds[1].revents & POLLIN) {
            char buf[64];
            while (read(wake_pipe[0], buf, sizeof(buf)) > 0) {}
        }

        // receive all available replies
        if (fds[0].revents & POLLIN) {
            for (;;) {
                char rbuf[256];
                struct sockaddr_in from{};
                socklen_t fl2 = sizeof(from);
                ssize_t n = recvfrom(sock, rbuf, sizeof(rbuf), 0,
                                     reinterpret_cast<struct sockaddr*>(&from),
                                     &fl2);
                if (n <= 0) break;
                if (n < 8 || static_cast<uint8_t>(rbuf[0]) != 0) continue;

                uint16_t rseq = ntohs(*reinterpret_cast<uint16_t*>(rbuf + 6));

                for (int i = static_cast<int>(pending.size()) - 1; i >= 0; --i) {
                    if (pending[i].seq == rseq &&
                        pending[i].dest.s_addr == from.sin_addr.s_addr) {
                        auto us = std::chrono::duration_cast<
                                      std::chrono::microseconds>(
                                      std::chrono::steady_clock::now()
                                      - pending[i].start).count();
                        pending[i].req->alive = true;
                        pending[i].req->elapsed_ms =
                            static_cast<double>(us) / 1000.0;
                        post_result(pending[i].req);
                        pending.erase(pending.begin() + i);
                        break;
                    }
                }
            }
        }

        // expire timed-out pings
        auto now = std::chrono::steady_clock::now();
        for (int i = static_cast<int>(pending.size()) - 1; i >= 0; --i) {
            if (now >= pending[i].deadline) {
                pending[i].req->error = "timeout";
                post_result(pending[i].req);
                pending.erase(pending.begin() + i);
            }
        }
    }

    for (auto& pp : pending) {
        pp.req->error = "shutting down";
        post_result(pp.req);
    }
    close(sock);
}

#endif // _WIN32 / POSIX

// ---------------------------------------------------------------------------
// N-API export: ping(host, timeoutMs) => Promise<PingResult>
// ---------------------------------------------------------------------------
static Napi::Value Ping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (shutting_down.load()) {
        auto d = Napi::Promise::Deferred::New(env);
        auto obj = Napi::Object::New(env);
        obj.Set("alive", Napi::Boolean::New(env, false));
        obj.Set("elapsed", Napi::Number::New(env, 0.0));
        obj.Set("error", Napi::String::New(env, "shutting down"));
        d.Resolve(obj);
        return d.Promise();
    }

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected (host: string, timeoutMs: number)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string host = info[0].As<Napi::String>().Utf8Value();
    int timeout_ms   = info[1].As<Napi::Number>().Int32Value();
    if (timeout_ms <= 0) timeout_ms = 1000;

    auto* req = new PingRequest(env, host, timeout_ms);
    auto promise = req->deferred.Promise();

    {
        std::lock_guard<std::mutex> lk(queue_mutex);
        ping_queue.push_back(req);
    }
    wake_thread();

    return promise;
}

// ---------------------------------------------------------------------------
// N-API export: shutdown() — join thread, abort TSFN
// ---------------------------------------------------------------------------
static Napi::Value Shutdown(const Napi::CallbackInfo& info) {
    if (!shutting_down.exchange(true)) {
        wake_thread();
        if (ping_thread.joinable()) ping_thread.join();
        tsfn.Release();   // release thread's reference
        tsfn.Abort();     // release owner reference, mark closing

#if defined(_WIN32)
        if (wake_event) { CloseHandle(wake_event); wake_event = NULL; }
#else
        if (wake_pipe[0] >= 0) { close(wake_pipe[0]); wake_pipe[0] = -1; }
        if (wake_pipe[1] >= 0) { close(wake_pipe[1]); wake_pipe[1] = -1; }
#endif
    }
    return info.Env().Undefined();
}

// ---------------------------------------------------------------------------
// Cleanup hook — safety net if shutdown() was never called
// ---------------------------------------------------------------------------
static void CleanupHook(void*) {
    if (!shutting_down.exchange(true)) {
        wake_thread();
        if (ping_thread.joinable()) ping_thread.join();
        tsfn.Release();
        tsfn.Abort();
    }
}

// ---------------------------------------------------------------------------
// Module init
// ---------------------------------------------------------------------------
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    shutting_down.store(false);

    // TSFN: unlimited queue, 2 references (owner + ping thread)
    tsfn = TSFN::New(env, "PingTSFN", 0, 2);

#if defined(_WIN32)
    wake_event = CreateEvent(NULL, FALSE, FALSE, NULL);  // auto-reset
#else
    pipe(wake_pipe);
    fcntl(wake_pipe[0], F_SETFL, O_NONBLOCK);
    fcntl(wake_pipe[1], F_SETFL, O_NONBLOCK);
#endif

    ping_thread = std::thread(ping_thread_func);

    napi_add_env_cleanup_hook(env, CleanupHook, nullptr);

    exports.Set("ping", Napi::Function::New(env, Ping));
    exports.Set("shutdown", Napi::Function::New(env, Shutdown));
    return exports;
}

NODE_API_MODULE(icmp_ping, Init)
