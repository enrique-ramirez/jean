#pragma once

#include "core/log.h"
#include "fb2k/main_thread.h"

#include <atomic>
#include <chrono>
#include <functional>
#include <future>
#include <memory>
#include <string>

namespace jean {

constexpr auto kPlayerTimeout = std::chrono::seconds(30);

template <typename T>
class Answer {
public:
    void set(T value) {
        if (!answered_.exchange(true))
            promise_.set_value(std::move(value));
    }

    std::future<T> future() { return promise_.get_future(); }

private:
    std::promise<T> promise_;
    std::atomic<bool> answered_{false};
};

template <typename T>
using AnswerPtr = std::shared_ptr<Answer<T>>;

// `work` is handed the answer rather than returning one, because some of it finishes
// inside a foobar2000 completion callback long after it returns.
template <typename T>
T askPlayer(MainThreadQueue& mainThread, const std::string& what,
            std::function<void(const AnswerPtr<T>&)> work, T whenTimedOut, T whenFailed) {
    const auto answer = std::make_shared<Answer<T>>();
    auto finished = answer->future();

    const auto run = [work, answer, what, whenFailed] {
        try {
            work(answer);
        } catch (const std::exception& e) {
            logError(what + " failed: " + e.what());
            answer->set(whenFailed);
        } catch (...) {
            logError(what + " failed with an unknown exception");
            answer->set(whenFailed);
        }
    };

    if (core_api::is_main_thread())
        run();
    else
        mainThread.enqueue(run, [answer, whenTimedOut] { answer->set(whenTimedOut); });

    if (finished.wait_for(kPlayerTimeout) != std::future_status::ready) {
        logError("the player did not finish " + what + " in time");
        return whenTimedOut;
    }

    return finished.get();
}

inline void tellPlayer(MainThreadQueue& mainThread, const std::string& what,
                       const std::function<void()>& work) {
    askPlayer<bool>(
        mainThread, what,
        [work](const AnswerPtr<bool>& answer) {
            work();
            answer->set(true);
        },
        false, false);
}

}  // namespace jean
