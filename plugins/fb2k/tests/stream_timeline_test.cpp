// GET /api/stream/timeline over a real socket. tests/timeline_test.cpp is the class; this is
// the route.

#include "third_party/doctest.h"

#include "core/api.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <atomic>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

StreamMark playing() {
    StreamMark mark;
    mark.at = 8.25;
    mark.path = R"(F:\Music\a.flac)";
    mark.subsong = 2;
    mark.position = 41.5;
    return mark;
}

// Counted, because a route that answered the right status having already asked the encoder
// would look identical from here.
Player publishing(std::atomic<int>* reads) {
    Player player;
    player.readTimeline = [reads] {
        ++*reads;
        return streamTimelineDocument(12.5, {playing()});
    };
    return player;
}

}  // namespace

TEST_CASE("the timeline a client reads is the one the encoder wrote") {
    std::atomic<int> reads{0};
    const TestServer server(servingSettings(), publishing(&reads));

    const auto response = server.client().Get("/api/stream/timeline");

    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK(reads == 1);

    const auto body = json::parse(response->body);
    CHECK(body["streamTime"] == doctest::Approx(12.5));
    REQUIRE(body["marks"].size() == 1);
    CHECK(body["marks"][0]["at"] == doctest::Approx(8.25));
    CHECK(body["marks"][0]["path"] == R"(F:\Music\a.flac)");
    CHECK(body["marks"][0]["subsong"] == 2);
    CHECK(body["marks"][0]["position"] == doctest::Approx(41.5));
}

TEST_CASE("the timeline is not cached, because it is a clock") {
    std::atomic<int> reads{0};
    const TestServer server(servingSettings(), publishing(&reads));

    const auto response = server.client().Get("/api/stream/timeline");

    REQUIRE(response);

    // A proxy or a service worker holding this for a second puts every client's cursor a
    // second behind the audio it is meant to describe.
    CHECK(response->get_header_value("Cache-Control") == "no-store");
    CHECK(response->get_header_value("Content-Type") == "application/json");
    CHECK(response->get_header_value("X-Content-Type-Options") == "nosniff");
}

TEST_CASE("an install with no stream source has no timeline to publish") {
    const TestServer server;

    const auto response = server.client().Get("/api/stream/timeline");

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK_FALSE(json::parse(response->body)["error"].get<std::string>().empty());
}
