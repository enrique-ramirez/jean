#include "fb2k/PCH.h"

#include "fb2k/main_thread.h"

#include "core/log.h"

#include <future>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace jean {

namespace {

// An exception escaping into foobar2000's own main loop rather than being caught here
// would take the player down with it.
void runReportingFailures(const std::function<void()>& work) {
    try {
        work();
    } catch (const std::exception& e) {
        logError(std::string("main thread work failed: ") + e.what());
    } catch (...) {
        logError("main thread work failed with an unknown exception");
    }
}

}  // namespace

struct Pending {
    std::function<void()> work;
    std::function<void()> abandon;
};

struct MainThreadQueue::State {
    std::mutex mutex;
    std::vector<Pending> pending;
    bool closed = false;
    std::promise<void> destroyed;

    ~State() { destroyed.set_value(); }

    std::vector<Pending> take() {
        const std::lock_guard<std::mutex> lock(mutex);
        return std::exchange(pending, {});
    }
};

MainThreadQueue::MainThreadQueue() : state_(std::make_shared<State>()) {}

MainThreadQueue::~MainThreadQueue() {
    // Wait for the state to die rather than just dropping this reference: a callback in
    // flight holds a strong one. It cannot deadlock on the path that matters, because this
    // runs from on_quit on the main thread and so do the callbacks.
    auto gone = state_->destroyed.get_future();
    state_.reset();
    gone.wait();
}

void MainThreadQueue::enqueue(std::function<void()> work, std::function<void()> abandon) {
    bool refused = false;

    {
        const std::lock_guard<std::mutex> lock(state_->mutex);
        refused = state_->closed;
        if (!refused)
            state_->pending.push_back({std::move(work), std::move(abandon)});
    }

    if (refused) {
        runReportingFailures(abandon);
        return;
    }

    // A main-thread callback foobar2000 accepted can still never arrive, observed under
    // Wine; scheduling one on every enqueue rather than only when the queue was empty means
    // a later enqueue's callback picks up whatever an earlier, lost one left pending.
    fb2k::inMainThread([weak = std::weak_ptr<State>(state_)] {
        const auto state = weak.lock();
        if (!state)
            return;  // destroyed between scheduling and running

        for (const Pending& item : state->take())
            runReportingFailures(item.work);
    });
}

void MainThreadQueue::close() {
    std::vector<Pending> abandoned;

    {
        const std::lock_guard<std::mutex> lock(state_->mutex);
        state_->closed = true;
        abandoned = std::exchange(state_->pending, {});
    }

    for (const Pending& item : abandoned)
        runReportingFailures(item.abandon);

    if (!abandoned.empty())
        logInfo("gave up " + std::to_string(abandoned.size()) +
                " call(s) into the player; it is shutting down");
}

}  // namespace jean
