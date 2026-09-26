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

PerClientRateLimiter::PerClientRateLimiter(int burst, std::chrono::milliseconds perToken)
    : burst_(burst), perToken_(perToken) {}

bool PerClientRateLimiter::allow(const std::string& client,
                                 std::chrono::steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    auto& entry = entries_.entryFor(client, now, [this] {
        return std::make_unique<RateLimiter>(burst_, perToken_);
    });
    return entry.payload->allow(now);
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
