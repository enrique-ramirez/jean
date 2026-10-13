// GET /api/stream and POST /api/stream/ticket over a real socket. The credential travels in the
// URL here because an <audio> element cannot send a header; most of these assert that this
// bought no leniency anywhere else.

#include "third_party/doctest.h"

#include "support/devices.h"
#include "support/http.h"
#include "support/streams.h"
#include "support/test_server.h"
#include "support/tickets.h"
#include "third_party/json.hpp"

#include <chrono>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

httplib::Result listen(const TestServer& server, const std::string& ticket) {
    return server.client().Get("/api/stream?ticket=" + ticket);
}

}  // namespace

TEST_CASE("a ticket is issued") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"ogg"})));

    const auto response = server.client().Post("/api/stream/ticket", "", "application/json");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body["ticket"] == "ticket-1");
    CHECK(body["expiresIn"] == 120);
}

TEST_CASE("the ticket lives as long as the file says, not as long as the default does") {
    auto settings = servingSettings();
    settings.streamTicketTtlSeconds = 45;

    const TestServer server(settings, TestServer::streaming(opensWith({"ogg"})));

    const auto response = server.client().Post("/api/stream/ticket", "", "application/json");

    REQUIRE(response);
    REQUIRE(response->status == 200);

    // A client schedules its reconnect off this, so a lifetime that never left config.json
    // is a client that reconnects at the wrong moment for the whole session.
    CHECK(json::parse(response->body)["expiresIn"] == 45);
}

TEST_CASE("a ticket opens the stream for the lifetime it was issued with, counted from its mint") {
    constexpr std::chrono::seconds kLifetime{45};
    constexpr std::chrono::steady_clock::duration kOneTick{1};

    auto settings = servingSettings();
    settings.streamTicketTtlSeconds = static_cast<int>(kLifetime.count());

    int opens = 0;
    const TestServer server(settings, TestServer::streaming(opensWith({"a"}, "audio/ogg", &opens)));
    const auto ticket = ticketFrom(server);

    const auto fresh = listen(server, ticket);
    REQUIRE(fresh);
    CHECK(fresh->status == 200);

    server.advanceClock(kLifetime - kOneTick);
    const auto onItsLastTick = listen(server, ticket);
    REQUIRE(onItsLastTick);
    CHECK(onItsLastTick->status == 200);
    CHECK(opens == 2);

    server.advanceClock(kOneTick);
    const auto ranOut = listen(server, ticket);
    REQUIRE(ranOut);
    CHECK(ranOut->status == 401);
    CHECK(errorOf(*ranOut) == "a valid stream ticket is required");
    CHECK(opens == 2);

    const auto mintedLater = ticketFrom(server);

    server.advanceClock(kLifetime - kOneTick);
    const auto laterOnItsLastTick = listen(server, mintedLater);
    REQUIRE(laterOnItsLastTick);
    CHECK(laterOnItsLastTick->status == 200);

    server.advanceClock(kOneTick);
    const auto laterRanOut = listen(server, mintedLater);
    REQUIRE(laterRanOut);
    CHECK(laterRanOut->status == 401);
    CHECK(opens == 3);
}

TEST_CASE("a ticket streams the bytes the listener produces") {
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"Ogg", "S", "audio"})));

    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == "OggSaudio");
    CHECK(response->get_header_value("Content-Type") == "audio/ogg");
    CHECK(response->get_header_value("Cache-Control") == "no-store");
    CHECK(response->get_header_value("X-Content-Type-Options") == "nosniff");
}

TEST_CASE("a live stream is sent without a length so it can go on for ever") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a", "b"})));

    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK_FALSE(response->has_header("Content-Length"));
}

TEST_CASE("a ticket serves Safari's Range probe and the real request that follows it") {
    auto settings = servingSettings();
    settings.maxConcurrentStreams = 2;

    const TestServer server(settings, TestServer::streaming(opensWith({"a"})));
    const auto ticket = ticketFrom(server);

    const httplib::Headers range{{"Range", "bytes=0-1"}};
    const auto probe = server.client().Get("/api/stream?ticket=" + ticket, range);
    REQUIRE(probe);
    CHECK(probe->status == 200);

    const auto real = listen(server, ticket);
    REQUIRE(real);
    CHECK(real->status == 200);
}

TEST_CASE("the stream says it has no ranges to take") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a"})));

    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->get_header_value("Accept-Ranges") == "none");
}

TEST_CASE("the stream is refused without a ticket") {
    int opens = 0;
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"a"}, "audio/ogg", &opens)));

    SUBCASE("no ticket at all") {
        const auto response = server.client().Get("/api/stream");
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("a ticket nobody issued") {
        const auto response = listen(server, "ticket-99");
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("an empty ticket") {
        const auto response = listen(server, "");
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    CHECK(opens == 0);
}

// No route reads Authorization, so a page could send whatever it likes there; that must not
// become a second way into the stream.
TEST_CASE("an Authorization header does not substitute for a ticket") {
    int opens = 0;
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"a"}, "audio/ogg", &opens)));

    const auto response =
        server.client().Get("/api/stream", httplib::Headers{{"Authorization", "Bearer x"}});

    REQUIRE(response);
    CHECK(response->status == 401);
    CHECK(opens == 0);
}

TEST_CASE("a refusal says nothing about which ticket was wrong") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a"})));

    const auto unknown = listen(server, "ticket-99");
    const auto empty = listen(server, "");

    REQUIRE(unknown);
    REQUIRE(empty);
    CHECK(unknown->status == empty->status);
    CHECK(unknown->body == empty->body);
}

TEST_CASE("a cap of zero refuses every stream, and says so rather than 401") {
    auto settings = servingSettings();
    settings.maxConcurrentStreams = 0;

    int opens = 0;
    const TestServer server(settings, TestServer::streaming(opensWith({"a"}, "audio/ogg", &opens)));
    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(json::parse(response->body)["error"].get<std::string>().find("configured") !=
          std::string::npos);

    CHECK(opens == 0);
}

TEST_CASE("a stream inside the cap is served") {
    auto settings = servingSettings();
    settings.maxConcurrentStreams = 1;

    const TestServer server(settings, TestServer::streaming(opensWith({"a", "b"})));
    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == "ab");
}

TEST_CASE("a finished stream frees its place, so the cap is not a one-shot") {
    auto settings = servingSettings();
    settings.maxConcurrentStreams = 1;

    const TestServer server(settings, TestServer::streaming(opensWith({"a"})));

    for (int i = 0; i < 3; ++i) {
        const auto response = listen(server, ticketFrom(server));
        REQUIRE(response);
        CHECK(response->status == 200);
    }
}

TEST_CASE("an install with no stream source says so rather than pretending") {
    const TestServer server;

    SUBCASE("no ticket is issued") {
        const auto response = server.client().Post("/api/stream/ticket", "", "application/json");
        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(json::parse(response->body)["error"].get<std::string>().size() > 0);
    }

    // 401 rather than 503: the ticket is checked first, so an unauthenticated caller cannot
    // learn whether this install streams at all.
    SUBCASE("the stream says nothing without a ticket") {
        const auto response = server.client().Get("/api/stream?ticket=ticket-1");
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("capabilities says the button should not be offered") {
        const auto response = server.client().Get("/api/capabilities");
        REQUIRE(response);
        CHECK(json::parse(response->body)["canStream"] == false);
    }
}

TEST_CASE("the refusal names streamingEnabled only when that switch is actually off") {
    SUBCASE("streamingEnabled is on and there is simply no source") {
        const TestServer server;

        const auto response = server.client().Post("/api/stream/ticket", "", "application/json");

        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(json::parse(response->body)["error"].get<std::string>().find("streamingEnabled") ==
              std::string::npos);
    }

    SUBCASE("streamingEnabled is off") {
        auto settings = servingSettings();
        settings.streamingEnabled = false;
        const TestServer server(settings, TestServer::streaming(opensWith({"a"})));

        const auto response = server.client().Post("/api/stream/ticket", "", "application/json");

        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(json::parse(response->body)["error"].get<std::string>().find("streamingEnabled") !=
              std::string::npos);
    }
}

TEST_CASE("an unknown format is refused rather than silently substituted") {
    int opens = 0;
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"a"}, "audio/ogg", &opens)));

    const auto response =
        server.client().Get("/api/stream?format=flac&ticket=" + ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 400);

    CHECK(opens == 0);
}

TEST_CASE("a request with no format gets the best one") {
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"a"}, "audio/ogg"), {"opus", "aac"}));

    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "audio/ogg");
}

TEST_CASE("capabilities lists the formats rather than only a boolean") {
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"a"}), {"opus", "aac"}));

    const auto response = server.client().Get("/api/capabilities");

    REQUIRE(response);
    const auto body = json::parse(response->body);
    CHECK(body["canStream"] == true);
    CHECK(body["streamFormats"] == json::array({"opus", "aac"}));
}

TEST_CASE("capabilities reports streaming when a source is wired up") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a"})));

    const auto response = server.client().Get("/api/capabilities");

    REQUIRE(response);
    CHECK(json::parse(response->body)["canStream"] == true);
}

TEST_CASE("a source that refuses to open answers 503 and spends the ticket") {
    const TestServer server(servingSettings(), TestServer::streaming([](const std::string&) {
                                return OpenedStream{"audio/ogg", nullptr};
                            }));

    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 503);
}

TEST_CASE("a mint that fails refuses to issue rather than serving an empty ticket") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a"})), nullptr,
                            [] { return std::string(); });

    const auto response = server.client().Post("/api/stream/ticket", "", "application/json");

    REQUIRE(response);
    CHECK(response->status == 503);
}

TEST_CASE("a stream with nothing to send yet is not a stream that ended") {
    // What a listener does while the player is paused: it has no audio, and says so rather
    // than blocking, so the route gets a chance to check that anybody is still there.
    const std::vector<std::string> threeIdlePollsThenAudio{"", "", "", "ogg"};
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith(threeIdlePollsThenAudio)));

    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == "ogg");
}

namespace {

bool canStream(const TestServer& server) {
    const auto response = server.client().Get("/api/capabilities");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["canStream"].get<bool>();
}

}  // namespace

// The component builds its stream source whether or not streaming is on, so that a reload can
// turn it on. The switch alone is what refuses.
TEST_CASE(
    "with streamingEnabled off and a source wired up, no ticket is issued and capabilities says "
    "so") {
    int opens = 0;
    const TestServer server(parseSettings(R"({"streamingEnabled": false})"),
                            TestServer::streaming(opensWith({"Ogg"}, "audio/ogg", &opens)));

    const auto ticket = server.client().Post("/api/stream/ticket", "", "application/json");

    REQUIRE(ticket);
    CHECK(ticket->status == 503);
    CHECK_FALSE(json::parse(ticket->body).value("error", std::string()).empty());
    CHECK_FALSE(canStream(server));
    CHECK(opens == 0);
}

TEST_CASE(
    "a reload turning streaming off refuses tickets and streams, and turning it back on serves "
    "them") {
    int opens = 0;
    TestServer server(servingSettings(),
                      TestServer::streaming(opensWith({"Ogg"}, "audio/ogg", &opens)));
    const auto issuedBefore = ticketFrom(server);

    server.reload(R"({"streamingEnabled": false})");

    const auto ticket = server.client().Post("/api/stream/ticket", "", "application/json");
    REQUIRE(ticket);
    CHECK(ticket->status == 503);

    const auto stream = listen(server, issuedBefore);
    REQUIRE(stream);
    CHECK(stream->status == 503);
    CHECK(opens == 0);

    server.reload("{}");

    const auto restored = listen(server, ticketFrom(server));
    REQUIRE(restored);
    CHECK(restored->status == 200);
    CHECK(restored->body == "Ogg");
}

TEST_CASE("canStream follows streamingEnabled through a reload") {
    TestServer server(servingSettings(), TestServer::streaming(opensWith({"Ogg"})));
    REQUIRE(canStream(server));

    server.reload(R"({"streamingEnabled": false})");
    CHECK_FALSE(canStream(server));

    server.reload("{}");
    CHECK(canStream(server));
}

TEST_CASE(
    "a device minting tickets in a loop shuts out its own oldest and never another device's") {
    int opens = 0;
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"a"}, "audio/ogg", &opens)));

    std::string looping;
    SUBCASE("a device that names itself") {
        looping = bodyNaming(phone());
    }
    SUBCASE("a page that names no device") {
        looping = "";
    }

    const auto bystander = ticketFrom(server, bodyNaming(laptop()));
    const auto first = ticketFrom(server, looping);

    std::string last;
    for (int mint = 0; mint < kMoreTicketsThanAnyoneHolds; ++mint)
        last = ticketFrom(server, looping);

    const auto spared = listen(server, bystander);
    REQUIRE(spared);
    CHECK(spared->status == 200);

    const auto shutOut = listen(server, first);
    REQUIRE(shutOut);
    CHECK(shutOut->status == 401);
    CHECK(errorOf(*shutOut) == "a valid stream ticket is required");

    const auto newest = listen(server, last);
    REQUIRE(newest);
    CHECK(newest->status == 200);

    CHECK(opens == 2);
}

TEST_CASE("a device arriving after another filled the store is handed a ticket that works") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a"})));

    std::string last;
    for (int mint = 0; mint < kMoreTicketsThanAnyoneHolds; ++mint)
        last = ticketFrom(server, bodyNaming(phone()));

    const auto arrived = listen(server, ticketFrom(server, bodyNaming(laptop())));
    REQUIRE(arrived);
    CHECK(arrived->status == 200);

    const auto stillGood = listen(server, last);
    REQUIRE(stillGood);
    CHECK(stillGood->status == 200);
}
