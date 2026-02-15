// icmp-ping/addon.cpp — Native ICMP ping using platform unprivileged APIs
#include "napi.h"
#include <string>
#include <cstring>
#include <chrono>

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
  #include <sys/select.h>
  #include <errno.h>
#endif

// ---------------------------------------------------------------------------
// Shared: resolve hostname to IPv4 address
// ---------------------------------------------------------------------------
static bool resolve_host(const std::string& host, struct in_addr& out) {
    struct addrinfo hints{};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;

    struct addrinfo* res = nullptr;
    int rc = getaddrinfo(host.c_str(), nullptr, &hints, &res);
    if (rc != 0 || !res) {
        if (res) freeaddrinfo(res);
        return false;
    }
    auto* sa = reinterpret_cast<struct sockaddr_in*>(res->ai_addr);
    out = sa->sin_addr;
    freeaddrinfo(res);
    return true;
}

// ---------------------------------------------------------------------------
// PingWorker — Napi::AsyncWorker that runs ICMP on libuv thread pool
// ---------------------------------------------------------------------------
class PingWorker : public Napi::AsyncWorker {
public:
    PingWorker(Napi::Env env, const std::string& host, int timeout_ms)
        : Napi::AsyncWorker(env),
          deferred_(Napi::Promise::Deferred::New(env)),
          host_(host),
          timeout_ms_(timeout_ms) {}

    Napi::Promise::Deferred& Deferred() { return deferred_; }

    void Execute() override {
        struct in_addr addr{};
        if (!resolve_host(host_, addr)) {
            alive_ = false;
            error_ = "DNS resolution failed for " + host_;
            return;
        }

#if defined(_WIN32)
        ExecuteWindows(addr);
#else
        ExecutePosix(addr);
#endif
    }

    void OnOK() override {
        Napi::Env env = Env();
        auto obj = Napi::Object::New(env);
        obj.Set("alive", Napi::Boolean::New(env, alive_));
        obj.Set("elapsed", Napi::Number::New(env, elapsed_ms_));
        if (!error_.empty()) {
            obj.Set("error", Napi::String::New(env, error_));
        }
        deferred_.Resolve(obj);
    }

    void OnError(const Napi::Error& err) override {
        // Never reject — always resolve with alive=false
        Napi::Env env = Env();
        auto obj = Napi::Object::New(env);
        obj.Set("alive", Napi::Boolean::New(env, false));
        obj.Set("elapsed", Napi::Number::New(env, 0.0));
        obj.Set("error", Napi::String::New(env, err.Message()));
        deferred_.Resolve(obj);
    }

private:
    Napi::Promise::Deferred deferred_;
    std::string host_;
    int timeout_ms_;
    bool alive_ = false;
    double elapsed_ms_ = 0.0;
    std::string error_;

// ---------------------------------------------------------------------------
// Windows: IcmpSendEcho
// ---------------------------------------------------------------------------
#if defined(_WIN32)
    void ExecuteWindows(const struct in_addr& addr) {
        HANDLE hIcmp = IcmpCreateFile();
        if (hIcmp == INVALID_HANDLE_VALUE) {
            error_ = "IcmpCreateFile failed";
            return;
        }

        char send_data[] = "ezplayer-ping";
        DWORD reply_size = sizeof(ICMP_ECHO_REPLY) + sizeof(send_data) + 8;
        std::vector<char> reply_buf(reply_size);

        IPAddr dest = addr.s_addr;

        DWORD ret = IcmpSendEcho(
            hIcmp,
            dest,
            send_data,
            sizeof(send_data),
            nullptr,                     // IP options
            reply_buf.data(),
            reply_size,
            static_cast<DWORD>(timeout_ms_)
        );

        if (ret > 0) {
            auto* reply = reinterpret_cast<PICMP_ECHO_REPLY>(reply_buf.data());
            if (reply->Status == IP_SUCCESS) {
                alive_ = true;
                elapsed_ms_ = static_cast<double>(reply->RoundTripTime);
            } else {
                alive_ = false;
                error_ = "ICMP status " + std::to_string(reply->Status);
            }
        } else {
            alive_ = false;
            error_ = "IcmpSendEcho failed, error " + std::to_string(GetLastError());
        }

        IcmpCloseHandle(hIcmp);
    }

// ---------------------------------------------------------------------------
// POSIX: SOCK_DGRAM + IPPROTO_ICMP (unprivileged)
// ---------------------------------------------------------------------------
#else
    static uint16_t icmp_checksum(const void* data, size_t len) {
        const uint16_t* buf = reinterpret_cast<const uint16_t*>(data);
        uint32_t sum = 0;
        for (size_t i = 0; i < len / 2; ++i) {
            sum += buf[i];
        }
        if (len & 1) {
            sum += static_cast<const uint8_t*>(data)[len - 1];
        }
        while (sum >> 16) {
            sum = (sum & 0xFFFF) + (sum >> 16);
        }
        return static_cast<uint16_t>(~sum);
    }

    void ExecutePosix(const struct in_addr& addr) {
        int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP);
        if (sock < 0) {
            error_ = "socket() failed: ";
            error_ += strerror(errno);
            return;
        }

        struct sockaddr_in dest{};
        dest.sin_family = AF_INET;
        dest.sin_addr = addr;

        // Build ICMP echo request
        struct icmp_packet {
            uint8_t type;
            uint8_t code;
            uint16_t checksum;
            uint16_t id;
            uint16_t seq;
            char payload[16];
        } __attribute__((packed));

        icmp_packet pkt{};
        pkt.type = 8;  // ICMP_ECHO
        pkt.code = 0;
        pkt.id = htons(static_cast<uint16_t>(getpid() & 0xFFFF));
        pkt.seq = htons(1);
        std::memcpy(pkt.payload, "ezplayer-ping\0\0", 15);
        pkt.checksum = 0;
        pkt.checksum = icmp_checksum(&pkt, sizeof(pkt));

        auto t0 = std::chrono::steady_clock::now();

        ssize_t sent = sendto(sock, &pkt, sizeof(pkt), 0,
                              reinterpret_cast<struct sockaddr*>(&dest),
                              sizeof(dest));
        if (sent < 0) {
            error_ = "sendto() failed: ";
            error_ += strerror(errno);
            close(sock);
            return;
        }

        // Wait for reply with select
        fd_set fds;
        FD_ZERO(&fds);
        FD_SET(sock, &fds);

        struct timeval tv{};
        tv.tv_sec = timeout_ms_ / 1000;
        tv.tv_usec = (timeout_ms_ % 1000) * 1000;

        int sel = select(sock + 1, &fds, nullptr, nullptr, &tv);
        if (sel <= 0) {
            alive_ = false;
            if (sel == 0) {
                error_ = "timeout";
            } else {
                error_ = "select() failed: ";
                error_ += strerror(errno);
            }
            close(sock);
            return;
        }

        char recv_buf[256];
        struct sockaddr_in from{};
        socklen_t from_len = sizeof(from);
        ssize_t n = recvfrom(sock, recv_buf, sizeof(recv_buf), 0,
                             reinterpret_cast<struct sockaddr*>(&from),
                             &from_len);

        auto t1 = std::chrono::steady_clock::now();

        if (n < 0) {
            error_ = "recvfrom() failed: ";
            error_ += strerror(errno);
            close(sock);
            return;
        }

        // For SOCK_DGRAM ICMP, kernel strips IP header — first byte is ICMP type
        if (n >= 1) {
            uint8_t type = static_cast<uint8_t>(recv_buf[0]);
            if (type == 0) {  // ICMP Echo Reply
                alive_ = true;
                auto us = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
                elapsed_ms_ = static_cast<double>(us) / 1000.0;
            } else {
                alive_ = false;
                error_ = "ICMP type " + std::to_string(type) + " (not echo reply)";
            }
        } else {
            alive_ = false;
            error_ = "Empty ICMP response";
        }

        close(sock);
    }
#endif
};

// ---------------------------------------------------------------------------
// N-API entry: ping(host: string, timeoutMs: number) => Promise<PingResult>
// ---------------------------------------------------------------------------
static Napi::Value Ping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected (host: string, timeoutMs: number)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string host = info[0].As<Napi::String>().Utf8Value();
    int timeout_ms = info[1].As<Napi::Number>().Int32Value();
    if (timeout_ms <= 0) timeout_ms = 1000;

    auto* worker = new PingWorker(env, host, timeout_ms);
    auto promise = worker->Deferred().Promise();
    worker->Queue();
    return promise;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("ping", Napi::Function::New(env, Ping));
    return exports;
}

NODE_API_MODULE(icmp_ping, Init)
