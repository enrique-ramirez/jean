#pragma once

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

using RateLimitClock = std::function<std::chrono::steady_clock::time_point()>;

inline std::chrono::steady_clock::time_point steadyNow() {
    return std::chrono::steady_clock::now();
}

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

constexpr size_t kMaxTrackedClients = 256;

template <typename Payload>
class BoundedByKey {
public:
    struct Entry {
        std::string key;
        std::chrono::steady_clock::time_point lastSeen;
        Payload payload;
    };

    template <typename MakePayload>
    Entry& entryFor(const std::string& key, std::chrono::steady_clock::time_point now,
                    MakePayload makePayload) {
        const auto found = std::find_if(entries_.begin(), entries_.end(),
                                        [&key](const Entry& entry) { return entry.key == key; });
        if (found != entries_.end()) {
            found->lastSeen = now;
            return *found;
        }

        if (entries_.size() >= kMaxTrackedClients) {
            const auto oldest = std::min_element(
                entries_.begin(), entries_.end(),
                [](const Entry& a, const Entry& b) { return a.lastSeen < b.lastSeen; });
            *oldest = Entry{key, now, makePayload()};
            return *oldest;
        }

        entries_.push_back(Entry{key, now, makePayload()});
        return entries_.back();
    }

private:
    std::vector<Entry> entries_;
};

class PerClientRateLimiter {
public:
    PerClientRateLimiter(int burst, std::chrono::milliseconds perToken);

    bool allow(const std::string& client, std::chrono::steady_clock::time_point now);

private:
    mutable std::mutex mutex_;
    BoundedByKey<std::unique_ptr<RateLimiter>> entries_;
    const int burst_;
    const std::chrono::milliseconds perToken_;
};

struct Throttled {
    std::string requests;
    std::string verb = "answer";
};

class Throttle {
public:
    Throttle(int burst, std::chrono::milliseconds refill, const Throttled& refused,
             RateLimitClock clock);

    bool refuses();

    int retryAfterSeconds() const;

private:
    RateLimiter limiter_;
    const std::chrono::milliseconds refill_;
    const std::string complaint_;
    const RateLimitClock clock_;
    std::atomic<bool> refusing_{false};
};

class OncePerBurst {
public:
    bool refused(const std::string& key);
    void allowed(const std::string& key);

private:
    mutable std::mutex mutex_;
    BoundedByKey<bool> entries_;
};

}  // namespace jean
