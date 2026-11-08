// How many connections the component serves at once and how many it lets wait, over real sockets.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "support/eventually.h"
#include "support/test_server.h"
#include "third_party/httplib.h"

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
        return eventually([this, count] {
            const std::lock_guard<std::mutex> lock(mutex);
            return holding >= count;
        });
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
    std::vector<int> statuses;

    void record(int status) {
        const std::lock_guard<std::mutex> lock(mutex);
        statuses.push_back(status);
    }

    bool waitForAnUnanswered() {
        return eventually([this] {
            const std::lock_guard<std::mutex> lock(mutex);
            return std::find(statuses.begin(), statuses.end(), kConnectionClosedUnanswered) !=
                   statuses.end();
        });
    }

    size_t count(int status) {
        const std::lock_guard<std::mutex> lock(mutex);
        return static_cast<size_t>(std::count(statuses.begin(), statuses.end(), status));
    }
};

// A connection that sends the start of a request and then nothing, so whichever thread reads it
// is held until the server's read timeout gives up on it or the connection closes.
class StalledRequest {
public:
    explicit StalledRequest(int port) : socket_(::socket(AF_INET, SOCK_STREAM, 0)) {
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_port = htons(static_cast<uint16_t>(port));
        ::inet_pton(AF_INET, TestServer::kClientHost, &address.sin_addr);

        constexpr char kHalfARequest[] = "GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\n";
        const auto* to = reinterpret_cast<const sockaddr*>(&address);
        sent_ = socket_ != INVALID_SOCKET && ::connect(socket_, to, sizeof address) == 0 &&
                ::send(socket_, kHalfARequest, sizeof kHalfARequest - 1, 0) > 0;
    }

    ~StalledRequest() {
        if (socket_ == INVALID_SOCKET)
            return;
#ifdef _WIN32
        ::closesocket(socket_);
#else
        ::close(socket_);
#endif
    }

    bool sent() const { return sent_; }

    StalledRequest(const StalledRequest&) = delete;
    StalledRequest& operator=(const StalledRequest&) = delete;

private:
    socket_t socket_;
    bool sent_ = false;
};

std::future<void> writeInBackground(const TestServer& server, Answers& answers) {
    return std::async(std::launch::async, [&server, &answers] {
        auto client = server.client();
        client.set_read_timeout(30, 0);
        const auto response =
            client.Post("/api/tags", ratingWrite(kTrackAddress), "application/json");
        if (response)
            answers.record(response.value().status);
        else
            answers.record(kConnectionClosedUnanswered);
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

// A client on a poor link stalls part-way through a request as a matter of course. Each holds a
// thread for as long as the server's read timeout, which is longer than the healthy client
// below waits for its answer, so that client is only answered if the pool grew for it rather
// than queueing it behind them, and if the stalled reads happen on the pool's threads rather
// than the one accepting connections.
TEST_CASE("requests stalled part-way through leave a thread for a request that is not") {
    const TestServer server;
    REQUIRE(server.status().listening);

    const auto pool = connectionPoolFor(std::thread::hardware_concurrency());
    REQUIRE(pool.maxThreads > pool.threads);

    // After the server, so every one is closed, and its thread let go, before the server stops.
    std::vector<std::unique_ptr<StalledRequest>> stalled;
    for (size_t at = 0; at + 1 < pool.maxThreads; ++at) {
        stalled.push_back(std::make_unique<StalledRequest>(server.port()));
        REQUIRE(stalled.back()->sent());
    }

    const auto response = get(server, "/api/status");

    REQUIRE(response);
    CHECK(response->status == 200);
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

namespace {

struct HeldJobs {
    std::mutex mutex;
    std::condition_variable changed;
    size_t running = 0;
    bool released = false;

    void run() {
        std::unique_lock<std::mutex> lock(mutex);
        ++running;
        changed.wait(lock, [this] { return released; });
    }

    bool waitUntilRunning(size_t count) {
        return eventually([this, count] {
            const std::lock_guard<std::mutex> lock(mutex);
            return running >= count;
        });
    }

    size_t runningNow() {
        const std::lock_guard<std::mutex> lock(mutex);
        return running;
    }

    void release() {
        const std::lock_guard<std::mutex> lock(mutex);
        released = true;
        changed.notify_all();
    }
};

}  // namespace

// Connections accepted faster than the pool's threads get scheduled are this burst. cpp-httplib's
// ThreadPool grows only when it counts no idle thread, so one that counts a thread woken for an
// earlier job as idle until it runs queues such a burst behind the threads the pool started with
// and never grows to its ceiling. Whether one burst outruns the threads it wakes is
// the scheduler's to decide, so each burst gets a fresh queue and every one must run in full.
TEST_CASE("a burst as deep as the pool's ceiling runs all at once") {
    constexpr int kBursts = 10;
    const auto pool = connectionPoolFor(std::thread::hardware_concurrency());

    for (int burst = 1; burst <= kBursts; ++burst) {
        HeldJobs jobs;
        const std::unique_ptr<httplib::TaskQueue> queue(connectionQueueFor(pool));

        for (size_t at = 0; at < pool.maxThreads; ++at)
            static_cast<void>(queue->enqueue([&jobs] { jobs.run(); }));

        const bool allRunning = jobs.waitUntilRunning(pool.maxThreads);
        const size_t running = jobs.runningNow();
        jobs.release();
        queue->shutdown();

        REQUIRE_MESSAGE(allRunning, running, " of ", pool.maxThreads, " jobs ran at once in burst ",
                        burst);
    }
}
