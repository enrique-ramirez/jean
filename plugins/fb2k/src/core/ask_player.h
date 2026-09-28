#pragma once

#include "core/log.h"
#include "core/main_thread_queue.h"
#include "core/player_outcome.h"

#include <atomic>
#include <functional>
#include <future>
#include <memory>
#include <string>
#include <type_traits>
#include <utility>

// How a connection thread asks the player's main thread for something and waits for the answer.
// See ARCHITECTURE.md, *The seams*, for what happens to work the main thread has not started, or
// has not finished, once the wait runs out.
namespace jean {

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

enum class Attempt { waiting, started, abandoned };

// `work` is handed the answer rather than returning one, because some of it finishes inside a
// foobar2000 completion callback long after it returns.
template <typename T>
T askPlayer(MainThreadQueue& mainThread, const std::string& what,
            std::function<void(const AnswerPtr<T>&)> work, T whenTimedOut, T whenFailed) {
    const auto answer = std::make_shared<Answer<T>>();
    const auto attempt = std::make_shared<std::atomic<Attempt>>(Attempt::waiting);
    auto finished = answer->future();

    auto run = [work = std::move(work), answer, attempt, what, whenFailed = std::move(whenFailed)] {
        auto expected = Attempt::waiting;
        if (!attempt->compare_exchange_strong(expected, Attempt::started))
            return;

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

    if (mainThread.onMainThread())
        run();
    else
        mainThread.enqueue(std::move(run), [answer, whenTimedOut] { answer->set(whenTimedOut); });

    if (finished.wait_for(mainThread.answerTimeout()) == std::future_status::ready)
        return finished.get();

    auto expected = Attempt::waiting;
    if (attempt->compare_exchange_strong(expected, Attempt::abandoned)) {
        logError("the player did not start " + what + " in time, so it never will");
        return whenTimedOut;
    }

    if (finished.wait_for(std::chrono::seconds(0)) == std::future_status::ready)
        return finished.get();

    logError("the player started " + what + " and did not finish it in time");
    return whenTimedOut;
}

inline void tellPlayer(MainThreadQueue& mainThread, const std::string& what,
                       std::function<void()> work) {
    askPlayer<bool>(
        mainThread, what,
        [work = std::move(work)](const AnswerPtr<bool>& answer) {
            work();
            answer->set(true);
        },
        false, false);
}

template <typename T>
T failureOf(PlayerOutcome outcome) {
    if constexpr (std::is_same_v<T, PlayerOutcome>) {
        return outcome;
    } else {
        T failed{};
        failed.outcome = outcome;
        return failed;
    }
}

// askPlayer for a job that answers before it returns, where T says how it went through a
// PlayerOutcome: a wait that runs out answers `timedOut`, and a job that throws `playerRefused`.
template <typename T>
T askForOutcome(MainThreadQueue& mainThread, const std::string& what, std::function<T()> job) {
    return askPlayer<T>(
        mainThread, what,
        [job = std::move(job)](const AnswerPtr<T>& answer) { answer->set(job()); },
        failureOf<T>(PlayerOutcome::timedOut), failureOf<T>(PlayerOutcome::playerRefused));
}

}  // namespace jean
