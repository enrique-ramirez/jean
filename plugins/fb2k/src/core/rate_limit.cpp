#include "core/rate_limit.h"

#include <algorithm>

namespace jean {

RateLimiter::RateLimiter(int burst, std::chrono::milliseconds perToken)
    : burst_(std::max(1, burst)),
      perToken_(static_cast<double>(std::max<int64_t>(1, perToken.count()))),
      tokens_(burst_) {}

bool RateLimiter::allow(std::chrono::steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_);
        elapsed.count() > 0) {
        tokens_ = std::min(burst_, tokens_ + (static_cast<double>(elapsed.count()) / perToken_));
        last_ = now;
    }

    if (tokens_ < 1.0)
        return false;

    tokens_ -= 1.0;
    return true;
}

}  // namespace jean
