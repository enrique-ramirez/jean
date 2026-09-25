#pragma once

#include <functional>
#include <memory>

// fb2k::inMainThread does the marshalling; what this adds is coalescing. It schedules a
// callback only when the pending batch was empty, so a burst of requests costs one
// main-thread callback rather than one each. On a thread that is also decoding audio, that
// is the point.
namespace jean {

class MainThreadQueue {
public:
    MainThreadQueue();
    ~MainThreadQueue();

    // Safe from any thread, including the main one. Work queued after the queue is
    // destroyed is dropped rather than run against a half-torn-down component.
    //
    // `abandon` runs in place of `work` once the queue is closed, and must settle whatever
    // `work` would have answered: the caller is blocked on that answer, not on this queue.
    void enqueue(std::function<void()> work, std::function<void()> abandon);

    void close();

    MainThreadQueue(const MainThreadQueue&) = delete;
    MainThreadQueue& operator=(const MainThreadQueue&) = delete;

private:
    struct State;
    std::shared_ptr<State> state_;
};

}  // namespace jean
