// GET /api/state reporting that foobar2000's main thread has stopped running what this component
// posts to it. The route answers from the component's own store either way, so without this a
// client polling it sees a healthy player while every command it sends waits out kPlayerTimeout.

#include "third_party/doctest.h"

#include "core/main_thread_queue.h"
#include "core/main_thread_watch.h"
#include "core/player.h"
#include "support/fixtures.h"
#include "support/main_thread_stand_in.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <chrono>
#include <string>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

Player watching(MainThreadWatch& watch) {
    Player player = servingPlayer();
    player.checkMainThread = [&watch](std::chrono::steady_clock::time_point now) {
        return watch.check(now);
    };
    return player;
}

struct Poll {
    int status = 0;
    std::string tag;
    json mainThread;
};

Poll poll(const TestServer& server, const std::string& heldTag = "") {
    const auto res =
        heldTag.empty()
            ? get(server, "/api/state")
            : server.client().Get("/api/state", httplib::Headers{{"If-None-Match", heldTag}});
    REQUIRE(res);

    Poll answer{res->status, res->get_header_value("ETag"), nullptr};
    if (res->status == 200)
        answer.mainThread = json::parse(res->body).at("mainThread");
    return answer;
}

}  // namespace

TEST_CASE("GET /api/state says the main thread is answering while it runs each check") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);
    const TestServer server(servingSettings(), watching(watch));

    const auto first = poll(server);
    REQUIRE(first.status == 200);
    CHECK(first.mainThread == json{{"answering", true}, {"unansweredSeconds", nullptr}});

    mainThread.pump();
    server.advanceRateLimits(kMainThreadStalledAfter * 2);

    CHECK(poll(server, first.tag).status == 304);
}

TEST_CASE("a stall moves GET /api/state's validator as it starts and again as it ends") {
    MainThreadStandIn mainThread;
    MainThreadQueue queue(mainThread.calls());
    MainThreadWatch watch(queue);
    const TestServer server(servingSettings(), watching(watch));

    const auto healthy = poll(server);
    REQUIRE(healthy.status == 200);

    server.advanceRateLimits(kMainThreadStalledAfter);
    const auto stalled = poll(server, healthy.tag);
    REQUIRE(stalled.status == 200);
    CHECK(stalled.tag != healthy.tag);
    CHECK(stalled.mainThread["answering"] == false);
    CHECK(stalled.mainThread["unansweredSeconds"].get<double>() ==
          doctest::Approx(std::chrono::duration<double>(kMainThreadStalledAfter).count()));

    // A stall going on is one change, not one per poll: a client holding it revalidates for free.
    server.advanceRateLimits(kMainThreadCheckInterval);
    CHECK(poll(server, stalled.tag).status == 304);

    mainThread.pump();
    const auto recovered = poll(server, stalled.tag);
    REQUIRE(recovered.status == 200);
    CHECK(recovered.tag != stalled.tag);
    CHECK(recovered.mainThread == json{{"answering", true}, {"unansweredSeconds", nullptr}});
}

TEST_CASE("a server with no main thread to check reports one answering") {
    const TestServer server;

    const auto answer = poll(server);
    REQUIRE(answer.status == 200);
    CHECK(answer.mainThread == json{{"answering", true}, {"unansweredSeconds", nullptr}});
}
