// Whether foobar2000's main thread is running what this component posts to it. The stand-in main
// thread runs nothing until a test pumps it, and the time is handed in, so a stall is a step the
// test takes rather than a wait.

#include "third_party/doctest.h"

#include "core/main_thread_queue.h"
#include "core/main_thread_watch.h"

#include "support/main_thread_stand_in.h"

#include <chrono>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

using std::chrono::milliseconds;
using std::chrono::steady_clock;

const steady_clock::time_point kStart{steady_clock::duration(0)};

constexpr auto kJustShort = kMainThreadStalledAfter - milliseconds(1);

}  // namespace

TEST_CASE("a main thread that runs each check is answering however long the watch runs") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);

    auto now = kStart;
    for (int poll = 0; poll < 20; ++poll) {
        CHECK(watch.check(now).answering);
        mainThread.pump();
        now += kMainThreadCheckInterval;
    }
}

TEST_CASE("a check left waiting past the threshold is a stall, however long it has waited") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);

    CHECK(watch.check(kStart).answering);
    CHECK(watch.check(kStart + kJustShort).answering);

    const auto stalled = watch.check(kStart + kMainThreadStalledAfter);
    CHECK_FALSE(stalled.answering);
    CHECK(stalled.unanswered == kMainThreadStalledAfter);

    const auto later = watch.check(kStart + kMainThreadStalledAfter * 3);
    CHECK_FALSE(later.answering);
    CHECK(later.unanswered == kMainThreadStalledAfter * 3);
}

TEST_CASE("a stalled main thread is answering again once it runs the check") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);

    watch.check(kStart);
    REQUIRE_FALSE(watch.check(kStart + kMainThreadStalledAfter).answering);

    mainThread.pump();

    const auto recovered = watch.check(kStart + kMainThreadStalledAfter);
    CHECK(recovered.answering);
    CHECK(recovered.unanswered == steady_clock::duration::zero());
}

// A command queued ahead of the check holds it up just the same, since the queue runs its batch
// in order: the thread is as unavailable to the check as it is to the command.
TEST_CASE("a check queued behind a command the main thread has not run waits with it") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);

    queue.enqueue([] {}, [] {});
    watch.check(kStart);
    CHECK(mainThread.postedCount() == 1);

    CHECK_FALSE(watch.check(kStart + kMainThreadStalledAfter).answering);
}

// Every poll asks, several clients may poll, and the main thread is also decoding audio.
TEST_CASE(
    "the main thread is woken at most once per interval, and not at all while a check waits") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);

    watch.check(kStart);
    watch.check(kStart + milliseconds(1));
    CHECK(mainThread.postedCount() == 1);

    mainThread.pump();
    watch.check(kStart + kMainThreadCheckInterval - milliseconds(1));
    CHECK(mainThread.postedCount() == 1);

    watch.check(kStart + kMainThreadCheckInterval);
    CHECK(mainThread.postedCount() == 2);

    for (int poll = 1; poll <= 10; ++poll)
        watch.check(kStart + kMainThreadCheckInterval * poll);
    CHECK(mainThread.postedCount() == 2);
}

// The component closes the queue first on shutdown, while the server is still answering polls.
// A check the queue gave up on says nothing about the thread, so a closed queue is no stall.
TEST_CASE("a closed queue abandons the waiting check, and the watch posts nothing more") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);

    watch.check(kStart);
    queue.close();

    const auto later = kStart + kMainThreadStalledAfter * 2;
    CHECK(watch.check(later).answering);
    CHECK(watch.check(later + kMainThreadCheckInterval).answering);
    CHECK(mainThread.postedCount() == 1);

    mainThread.pump();
}

TEST_CASE("a check the main thread runs after the watch is gone does nothing") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());

    {
        MainThreadWatch watch(queue);
        watch.check(kStart);
    }

    mainThread.pump();
    CHECK(mainThread.postedCount() == 1);
}

// Run under --sanitize=thread: polls land on connection threads while the main thread runs checks.
TEST_CASE("checks asked from several threads while the main thread runs them agree afterwards") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);

    constexpr int kPolls = 200;
    std::vector<std::thread> pollers;
    for (int poller = 0; poller < 3; ++poller) {
        pollers.emplace_back([&watch] {
            for (int poll = 0; poll < kPolls; ++poll)
                watch.check(kStart + kMainThreadCheckInterval * poll);
        });
    }

    std::thread player([&mainThread] {
        for (int pump = 0; pump < kPolls; ++pump)
            mainThread.pump();
    });

    for (auto& poller : pollers)
        poller.join();
    player.join();
    mainThread.pump();

    CHECK(watch.check(kStart + kMainThreadCheckInterval * kPolls).answering);
}
