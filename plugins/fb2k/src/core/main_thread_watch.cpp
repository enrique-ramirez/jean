#include "core/main_thread_watch.h"

#include <mutex>
#include <optional>

namespace jean {

struct MainThreadWatch::State {
    std::mutex mutex;
    std::optional<std::chrono::steady_clock::time_point> waitingSince;
    std::optional<std::chrono::steady_clock::time_point> lastPosted;

    void answered() {
        const std::lock_guard<std::mutex> lock(mutex);
        waitingSince.reset();
    }
};

MainThreadWatch::MainThreadWatch(MainThreadQueue& mainThread)
    : mainThread_(mainThread), state_(std::make_shared<State>()) {}

MainThreadHealth MainThreadWatch::check(std::chrono::steady_clock::time_point now) {
    {
        const std::lock_guard<std::mutex> lock(state_->mutex);
        if (state_->waitingSince) {
            const auto waited = now - *state_->waitingSince;
            if (waited >= kMainThreadStalledAfter)
                return MainThreadHealth{false, waited};
            return {};
        }

        if (state_->lastPosted && now - *state_->lastPosted < kMainThreadCheckInterval)
            return {};

        state_->waitingSince = now;
        state_->lastPosted = now;
    }

    // Outside the lock: both callbacks below take state_->mutex, and enqueue may run one of
    // them in place rather than later.
    mainThread_.enqueue([state = state_] { state->answered(); },
                        [state = state_] { state->answered(); });
    return {};
}

}  // namespace jean
