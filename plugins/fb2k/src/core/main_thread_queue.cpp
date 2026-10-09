#include "core/main_thread_queue.h"

#include "core/log.h"

#include <exception>
#include <future>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace jean {

namespace {

// An exception escaping into foobar2000's own main loop rather than being caught here would take
// the player down with it.
void runReportingFailures(const std::function<void()>& work) {
    try {
        work();
    } catch (const std::exception& e) {
        logError(std::string("main thread work failed: ") + e.what());
    } catch (...) {
        logError("main thread work failed with an unknown exception");
    }
}

struct Pending {
    std::function<void()> work;
    std::function<void()> abandon;
};

}  // namespace

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

MainThreadQueue::MainThreadQueue(MainThreadCalls calls, std::chrono::milliseconds answerTimeout)
    : calls_(std::move(calls)), answerTimeout_(answerTimeout), state_(std::make_shared<State>()) {}

MainThreadQueue::~MainThreadQueue() {
    // Wait for the state to die rather than just dropping this reference: a callback in flight
    // holds a strong one. It cannot deadlock in foobar2000, because this runs from on_quit on the
    // main thread and so do the callbacks.
    const auto gone = state_->destroyed.get_future();
    state_.reset();
    gone.wait();
}

void MainThreadQueue::enqueue(std::function<void()> work, std::function<void()> abandon) {
    std::unique_lock<std::mutex> lock(state_->mutex);
    if (state_->closed) {
        lock.unlock();
        runReportingFailures(abandon);
        return;
    }

    const bool needsPosting = state_->pending.empty();
    state_->pending.push_back({std::move(work), std::move(abandon)});
    lock.unlock();

    if (!needsPosting)
        return;

    try {
        calls_.post([weak = std::weak_ptr<State>(state_)] {
            const auto state = weak.lock();
            if (!state)
                return;

            for (const Pending& item : state->take())
                runReportingFailures(item.work);
        });
        return;
    } catch (const std::exception& e) {
        logError(std::string("could not reach the main thread: ") + e.what());
    } catch (...) {
        logError("could not reach the main thread: unknown exception");
    }

    for (const Pending& item : state_->take())
        runReportingFailures(item.abandon);
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

bool MainThreadQueue::onMainThread() const {
    return calls_.isCurrent();
}

std::chrono::milliseconds MainThreadQueue::answerTimeout() const {
    return answerTimeout_;
}

}  // namespace jean
