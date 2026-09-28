#include "support/main_thread_stand_in.h"

#include <utility>

namespace jean::testing {

MainThreadCalls MainThreadStandIn::calls(bool callerIsMainThread) {
    MainThreadCalls calls;
    calls.post = [this](std::function<void()> callback) {
        {
            const std::lock_guard<std::mutex> lock(mutex_);
            waiting_.push_back(std::move(callback));
            ++postedCount_;
        }
        posted_.notify_all();
    };
    calls.isCurrent = [callerIsMainThread] { return callerIsMainThread; };
    return calls;
}

void MainThreadStandIn::pump() {
    std::vector<std::function<void()>> due;
    {
        const std::lock_guard<std::mutex> lock(mutex_);
        due = std::exchange(waiting_, {});
    }

    for (const auto& callback : due)
        callback();
}

size_t MainThreadStandIn::postedCount() const {
    const std::lock_guard<std::mutex> lock(mutex_);
    return postedCount_;
}

void MainThreadStandIn::awaitPosted() {
    std::unique_lock<std::mutex> lock(mutex_);
    posted_.wait(lock, [this] { return !waiting_.empty(); });
}

}  // namespace jean::testing
