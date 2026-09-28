#pragma once

#include "core/main_thread_queue.h"

#include <condition_variable>
#include <cstddef>
#include <functional>
#include <mutex>
#include <vector>

namespace jean::testing {

// A main thread that runs nothing until a test pumps it, so what a MainThreadQueue does before,
// during and after its callback runs is each a step the test takes rather than a race it loses.
class MainThreadStandIn {
public:
    // The calls a MainThreadQueue is built over. `callerIsMainThread` is what isCurrent answers.
    MainThreadCalls calls(bool callerIsMainThread = false);

    // Runs every callback posted so far, in the order posted, on the calling thread.
    void pump();

    size_t postedCount() const;

    // Blocks until at least one callback is waiting to be pumped.
    void awaitPosted();

private:
    mutable std::mutex mutex_;
    std::condition_variable posted_;
    std::vector<std::function<void()>> waiting_;
    size_t postedCount_ = 0;
};

}  // namespace jean::testing
