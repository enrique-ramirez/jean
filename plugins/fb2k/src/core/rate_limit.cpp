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

    const auto found = std::find_if(entries_.begin(), entries_.end(),
                                     [&client](const Entry& entry) { return entry.client == client; });

    if (found != entries_.end()) {
        found->lastSeen = now;
        return found->limiter->allow(now);
    }

    if (entries_.size() >= kMaxTrackedClients) {
        const auto oldest = std::min_element(
            entries_.begin(), entries_.end(),
            [](const Entry& a, const Entry& b) { return a.lastSeen < b.lastSeen; });
        *oldest = Entry{client, now, std::make_unique<RateLimiter>(burst_, perToken_)};
        return oldest->limiter->allow(now);
    }

    entries_.push_back(Entry{client, now, std::make_unique<RateLimiter>(burst_, perToken_)});
    return entries_.back().limiter->allow(now);
}

}  // namespace jean
