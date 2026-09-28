// How many connections the component serves at once and how many it lets wait, over real sockets.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "support/test_server.h"

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <future>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

// A bound on each wait below, so a regression fails the case rather than hanging the suite.
constexpr auto kLongerThanAnyHealthyWait = std::chrono::seconds(20);

struct HeldWriter {
    std::mutex mutex;
    std::condition_variable changed;
    size_t holding = 0;
    size_t calls = 0;
    bool released = false;

    TagWriteOutcome write() {
        std::unique_lock<std::mutex> lock(mutex);
        ++holding;
        ++calls;
        changed.notify_all();
        changed.wait(lock, [this] { return released; });
        --holding;
        return TagWriteOutcome::written;
    }

    bool waitUntilHolding(size_t count) {
        std::unique_lock<std::mutex> lock(mutex);
        return changed.wait_for(lock, kLongerThanAnyHealthyWait,
                                [this, count] { return holding >= count; });
    }

    void release() {
        const std::lock_guard<std::mutex> lock(mutex);
        released = true;
        changed.notify_all();
    }

    size_t callsMade() {
        const std::lock_guard<std::mutex> lock(mutex);
        return calls;
    }
};

constexpr int kConnectionClosedUnanswered = 0;

struct Answers {
    std::mutex mutex;
    std::condition_variable arrived;
    std::vector<int> statuses;

    void record(int status) {
        const std::lock_guard<std::mutex> lock(mutex);
        statuses.push_back(status);
        arrived.notify_all();
    }

    bool waitForAnUnanswered() {
        std::unique_lock<std::mutex> lock(mutex);
        return arrived.wait_for(lock, kLongerThanAnyHealthyWait, [this] {
            return std::find(statuses.begin(), statuses.end(), kConnectionClosedUnanswered) !=
                   statuses.end();
        });
    }

    size_t count(int status) {
        const std::lock_guard<std::mutex> lock(mutex);
        return static_cast<size_t>(std::count(statuses.begin(), statuses.end(), status));
    }
};

std::future<void> writeInBackground(const TestServer& server, Answers& answers) {
    return std::async(std::launch::async, [&server, &answers] {
        auto client = server.client();
        client.set_read_timeout(30, 0);
        const auto response =
            client.Post("/api/tags", ratingWrite(kTrackAddress), "application/json");
        answers.record(response ? response->status : kConnectionClosedUnanswered);
    });
}

}  // namespace

TEST_CASE("the pool starts where cpp-httplib does, grows fourfold, and lets as many wait") {
    const auto onTwoCores = connectionPoolFor(2);
    CHECK(onTwoCores.threads == 8);
    CHECK(onTwoCores.maxThreads == 32);
    CHECK(onTwoCores.queued == 32);

    const auto onTwentyFour = connectionPoolFor(24);
    CHECK(onTwentyFour.threads == 23);
    CHECK(onTwentyFour.maxThreads == 92);
    CHECK(onTwentyFour.queued == 92);
}

// A client that finds every thread busy and the queue full is closed without an answer rather than
// left waiting, and nothing it asked for reaches the player. Which of the last connections finds
// the queue full is the scheduler's to decide, so the count is what is asserted.
TEST_CASE("a connection past the queue is closed unanswered, and every one before it is served") {
    HeldWriter writer;
    const TestServer server(servingSettings(), TestServer::writing([&writer](const TagWrite&) {
                                return writer.write();
                            }));
    REQUIRE(server.status().listening);

    const auto pool = connectionPoolFor(std::thread::hardware_concurrency());
    Answers answers;
    std::vector<std::future<void>> clients;

    // Released before the server stops, which waits for every thread the writer is holding.
    const std::unique_ptr<HeldWriter, void (*)(HeldWriter*)> releasing(
        &writer, [](HeldWriter* held) { held->release(); });

    // One at a time, so each finds the thread the last one left idle already taken and the pool
    // grows, rather than a burst queueing behind a thread that has not yet picked up its job.
    for (size_t at = 0; at < pool.maxThreads; ++at) {
        clients.push_back(writeInBackground(server, answers));
        REQUIRE(writer.waitUntilHolding(at + 1));
    }

    for (size_t at = 0; at < pool.queued + 1; ++at)
        clients.push_back(writeInBackground(server, answers));
    REQUIRE(answers.waitForAnUnanswered());

    writer.release();
    for (auto& client : clients)
        client.get();

    CHECK(answers.count(kConnectionClosedUnanswered) == 1);
    CHECK(answers.count(200) == pool.maxThreads + pool.queued);
    CHECK(writer.callsMade() == pool.maxThreads + pool.queued);
}
