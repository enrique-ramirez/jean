#pragma once

#include <chrono>
#include <mutex>

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

}  // namespace jean
