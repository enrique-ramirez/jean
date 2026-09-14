#pragma once

#include <chrono>
#include <cstddef>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

// A token bucket. The bearer token is the security control, and anyone holding one could
// already make the same calls one at a time. What this bounds is how fast a client bug
// turns into a burst of them.
class RateLimiter {
public:
    RateLimiter(int burst, std::chrono::milliseconds perToken);

    bool allow(std::chrono::steady_clock::time_point now);

private:
    std::mutex mutex_;
    const double burst_;
    const double perToken_;
    double tokens_;
    std::chrono::steady_clock::time_point last_;
};

// A cap on how many source addresses PerClientRateLimiter tracks at once, so a client that
// keeps changing address cannot grow the map without bound.
constexpr size_t kMaxTrackedClients = 256;

// One RateLimiter per source address, so one client spending its own burst never refuses
// another. Past kMaxTrackedClients the least-recently-seen address gives up its place to the
// one arriving; recency moves on every call, refused or not, so an address that keeps asking
// keeps its place and cannot be aged out by cycling in fresh ones.
class PerClientRateLimiter {
public:
    PerClientRateLimiter(int burst, std::chrono::milliseconds perToken);

    bool allow(const std::string& client, std::chrono::steady_clock::time_point now);

private:
    struct Entry {
        std::string client;
        std::chrono::steady_clock::time_point lastSeen;
        std::unique_ptr<RateLimiter> limiter;
    };

    mutable std::mutex mutex_;
    std::vector<Entry> entries_;
    const int burst_;
    const std::chrono::milliseconds perToken_;
};

}  // namespace jean
