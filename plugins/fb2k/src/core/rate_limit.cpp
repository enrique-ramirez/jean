#include "core/rate_limit.h"

#include "core/log.h"

#include <algorithm>
#include <utility>

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

PerClientRateLimiter::PerClientRateLimiter(int burst, std::chrono::milliseconds perToken)
    : burst_(burst), perToken_(perToken) {}

bool PerClientRateLimiter::allow(const std::string& client,
                                 std::chrono::steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    auto& entry = entries_.entryFor(
        client, now, [this] { return std::make_unique<RateLimiter>(burst_, perToken_); });
    return entry.payload->allow(now);
}

Throttle::Throttle(int burst, std::chrono::milliseconds refill, std::string complaint,
                   RateLimitClock clock)
    : limiter_(burst, refill),
      refill_(refill),
      complaint_(std::move(complaint)),
      clock_(std::move(clock)) {}

bool Throttle::refuses() {
    if (limiter_.allow(clock_())) {
        refusing_ = false;
        return false;
    }

    if (!refusing_.exchange(true))
        logError(complaint_);

    return true;
}

int Throttle::retryAfterSeconds() const {
    const auto rounded = std::chrono::ceil<std::chrono::seconds>(refill_);
    return static_cast<int>(std::max<std::chrono::seconds::rep>(1, rounded.count()));
}

bool OncePerBurst::refused(const std::string& key) {
    const std::lock_guard<std::mutex> held(mutex_);

    const auto now = std::chrono::steady_clock::now();
    auto& entry = entries_.entryFor(key, now, [] { return false; });
    if (entry.payload)
        return false;

    entry.payload = true;
    return true;
}

void OncePerBurst::allowed(const std::string& key) {
    const std::lock_guard<std::mutex> held(mutex_);

    const auto now = std::chrono::steady_clock::now();
    entries_.entryFor(key, now, [] { return false; }).payload = false;
}

}  // namespace jean
