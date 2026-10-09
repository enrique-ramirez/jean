// How a connection thread's question reaches the player's main thread, and what it is answered
// when the main thread is slow, busy with it, or shutting down. The stand-in main thread runs
// nothing until a test pumps it, so a wait that runs out is a wait of zero rather than a sleep.

#include "third_party/doctest.h"

#include "core/ask_player.h"
#include "core/main_thread_queue.h"

#include "support/log_capture.h"
#include "support/main_thread_stand_in.h"

#include <chrono>
#include <future>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

constexpr auto kAlreadyExpired = std::chrono::milliseconds(0);

constexpr int kAnswered = 1;
constexpr int kTimedOut = -1;
constexpr int kFailed = -2;

struct Read {
    PlayerOutcome outcome = PlayerOutcome::done;
    int value = 0;
};

int askFor(MainThreadQueue& queue, std::function<void(const AnswerPtr<int>&)> work) {
    return askPlayer<int>(queue, "a test question", std::move(work), kTimedOut, kFailed);
}

}  // namespace

TEST_CASE("a question the main thread answers is answered to the caller") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());

    std::thread player([&mainThread] {
        mainThread.awaitPosted();
        mainThread.pump();
    });

    const int answer = askFor(queue, [](const AnswerPtr<int>& reply) { reply->set(kAnswered); });
    player.join();

    CHECK(answer == kAnswered);
}

// foobar2000 finishes some work in a completion callback after the job itself has returned,
// which is why a job is handed the answer rather than returning one.
TEST_CASE("an answer a job hands on and settles later is kept if it lands in time") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());

    AnswerPtr<int> handedOn;
    std::thread player([&mainThread, &handedOn] {
        mainThread.awaitPosted();
        mainThread.pump();
        handedOn->set(kAnswered);
    });

    const int answer =
        askFor(queue, [&handedOn](const AnswerPtr<int>& reply) { handedOn = reply; });
    player.join();

    CHECK(answer == kAnswered);
}

TEST_CASE("a question the main thread never started is dropped once the wait runs out") {
    clearLog();
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls(), kAlreadyExpired);

    bool ran = false;
    const int answer = askFor(queue, [&ran](const AnswerPtr<int>& reply) {
        ran = true;
        reply->set(kAnswered);
    });

    CHECK(answer == kTimedOut);

    mainThread.pump();
    CHECK_FALSE(ran);
    CHECK(logged("did not start a test question in time, so it never will"));
}

TEST_CASE("a question started and not finished in time answers the timeout") {
    clearLog();
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls(true), kAlreadyExpired);

    AnswerPtr<int> handedOn;
    const int answer =
        askFor(queue, [&handedOn](const AnswerPtr<int>& reply) { handedOn = reply; });

    CHECK(answer == kTimedOut);
    CHECK(logged("started a test question and did not finish it in time"));

    handedOn->set(kAnswered);
}

// The shutdown path asks the player to unmute from the main thread itself, where a queued job
// could only run once the caller had already given up on it.
TEST_CASE("a question asked on the main thread runs in place, not behind itself") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls(true));

    const int answer = askFor(queue, [](const AnswerPtr<int>& reply) { reply->set(kAnswered); });

    CHECK(answer == kAnswered);
    CHECK(mainThread.postedCount() == 0);
}

TEST_CASE("a job that throws answers its caller the failure, not the timeout") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls(true));

    const int answer = askFor(
        queue, [](const AnswerPtr<int>&) { throw std::runtime_error("the player refused"); });

    CHECK(answer == kFailed);
}

TEST_CASE("closing the queue answers every waiting caller rather than timing out") {
    clearLog();
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());

    bool ran = false;
    auto waiting = std::async(std::launch::async, [&queue, &ran] {
        return askFor(queue, [&ran](const AnswerPtr<int>& reply) {
            ran = true;
            reply->set(kAnswered);
        });
    });

    mainThread.awaitPosted();
    queue.close();

    CHECK(waiting.get() == kTimedOut);
    CHECK(logged("gave up 1 call(s) into the player; it is shutting down"));

    mainThread.pump();
    CHECK_FALSE(ran);
}

TEST_CASE("a post the main thread refuses answers the caller rather than wedging the queue") {
    clearLog();
    MainThreadStandIn mainThread;
    MainThreadCalls calls = mainThread.calls();
    const auto post = calls.post;
    int refusals = 0;
    calls.post = [&post, &refusals](std::function<void()> callback) {
        if (refusals++ == 0)
            throw std::runtime_error("message loop gone");
        post(std::move(callback));
    };
    MainThreadQueue queue(calls);

    bool ran = false;
    CHECK(askFor(queue, [&ran](const AnswerPtr<int>& reply) {
              ran = true;
              reply->set(kAnswered);
          }) == kTimedOut);
    CHECK_FALSE(ran);
    CHECK(logged("could not reach the main thread: message loop gone"));

    std::thread player([&mainThread] {
        mainThread.awaitPosted();
        mainThread.pump();
    });
    CHECK(askFor(queue, [](const AnswerPtr<int>& reply) { reply->set(kAnswered); }) == kAnswered);
    player.join();
}

TEST_CASE("a question asked after closing is answered at once and never queued") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    queue.close();

    bool ran = false;
    const int answer = askFor(queue, [&ran](const AnswerPtr<int>& reply) {
        ran = true;
        reply->set(kAnswered);
    });

    CHECK(answer == kTimedOut);
    CHECK(mainThread.postedCount() == 0);
    CHECK_FALSE(ran);
}

TEST_CASE("a burst queued before the main thread runs costs one callback, and runs in order") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());

    std::vector<int> ran;
    for (int job = 0; job < 3; ++job)
        queue.enqueue([&ran, job] { ran.push_back(job); }, [] {});

    CHECK(mainThread.postedCount() == 1);

    mainThread.pump();
    CHECK(ran == std::vector<int>{0, 1, 2});
}

TEST_CASE("a callback that runs after its queue is gone does nothing") {
    MainThreadStandIn mainThread;

    bool ran = false;
    {
        MainThreadQueue queue(mainThread.calls());
        queue.enqueue([&ran] { ran = true; }, [] {});
    }

    mainThread.pump();
    CHECK_FALSE(ran);
}

TEST_CASE("an outcome question answers timedOut on a timeout and playerRefused on a throw") {
    MainThreadStandIn idle;
    MainThreadQueue slow(idle.calls(), kAlreadyExpired);
    CHECK(askForOutcome<Read>(slow, "a read", [] {
              return Read{PlayerOutcome::done, 7};
          }).outcome == PlayerOutcome::timedOut);
    CHECK(askForOutcome<PlayerOutcome>(slow, "a command", [] { return PlayerOutcome::done; }) ==
          PlayerOutcome::timedOut);

    MainThreadStandIn here;
    MainThreadQueue inPlace(here.calls(true));
    CHECK(askForOutcome<Read>(inPlace, "a read", []() -> Read {
              throw std::runtime_error("no");
          }).outcome == PlayerOutcome::playerRefused);

    const Read read =
        askForOutcome<Read>(inPlace, "a read", [] { return Read{PlayerOutcome::done, 7}; });
    CHECK(read.outcome == PlayerOutcome::done);
    CHECK(read.value == 7);
}
