#pragma once

#include "core/main_thread_queue.h"

#include <chrono>
#include <memory>

namespace jean {

// Far above what foobar2000's main thread takes over its own ordinary work, and far enough below
// kPlayerTimeout that a client hears about a stall long before its command gives up.
constexpr std::chrono::milliseconds kMainThreadStalledAfter = std::chrono::seconds(5);
static_assert(kMainThreadStalledAfter < kPlayerTimeout);

constexpr std::chrono::milliseconds kMainThreadCheckInterval = std::chrono::seconds(2);

struct MainThreadHealth {
    bool answering = true;
    std::chrono::steady_clock::duration unanswered{};
};

// Asked on every state poll, so the main thread is checked only while somebody is watching and a
// stall is seen whether or not a command is waiting on it. Each ask posts a trivial check when
// none is waiting and the last went out at least kMainThreadCheckInterval ago; the thread counts
// as stalled once one has waited kMainThreadStalledAfter.
class MainThreadWatch {
public:
    explicit MainThreadWatch(MainThreadQueue& mainThread);

    // Called by the threads answering requests.
    MainThreadHealth check(std::chrono::steady_clock::time_point now);

    MainThreadWatch(const MainThreadWatch&) = delete;
    MainThreadWatch& operator=(const MainThreadWatch&) = delete;

private:
    struct State;

    MainThreadQueue& mainThread_;
    std::shared_ptr<State> state_;
};

}  // namespace jean
