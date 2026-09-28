#pragma once

#include <chrono>
#include <functional>
#include <memory>

namespace jean {

constexpr std::chrono::milliseconds kPlayerTimeout = std::chrono::seconds(30);

// What a MainThreadQueue needs from the thread it feeds. fb2k/main_thread.h supplies foobar2000's.
struct MainThreadCalls {
    // Runs `callback` on the main thread later, never inline. Safe from any thread.
    std::function<void(std::function<void()> callback)> post;

    std::function<bool()> isCurrent;
};

// `post` does the marshalling; what this adds is coalescing. It posts a callback only when the
// pending batch was empty, so a burst of requests costs one main-thread callback rather than one
// each. On a thread that is also decoding audio, that is the point.
class MainThreadQueue {
public:
    // `answerTimeout` is how long askPlayer waits for the main thread to answer.
    explicit MainThreadQueue(MainThreadCalls calls,
                             std::chrono::milliseconds answerTimeout = kPlayerTimeout);
    ~MainThreadQueue();

    // Safe from any thread, including the main one. Work queued after the queue is closed is
    // dropped rather than run against a half-torn-down component.
    //
    // `abandon` runs in place of `work` once the queue is closed, and must settle whatever
    // `work` would have answered: the caller is blocked on that answer, not on this queue.
    void enqueue(std::function<void()> work, std::function<void()> abandon);

    void close();

    bool onMainThread() const;

    std::chrono::milliseconds answerTimeout() const;

    MainThreadQueue(const MainThreadQueue&) = delete;
    MainThreadQueue& operator=(const MainThreadQueue&) = delete;

private:
    struct State;

    const MainThreadCalls calls_;
    const std::chrono::milliseconds answerTimeout_;
    std::shared_ptr<State> state_;
};

}  // namespace jean
