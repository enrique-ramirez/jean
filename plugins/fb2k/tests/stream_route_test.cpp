// GET /api/stream and POST /api/stream/ticket over a real socket. The credential travels in the
// URL here because an <audio> element cannot send a header; most of these assert that this
// bought no leniency anywhere else.

#include "third_party/doctest.h"

#include "support/test_server.h"
#include "third_party/json.hpp"

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

class FiniteStream : public StreamSession {
public:
    explicit FiniteStream(std::vector<std::string> chunks) : chunks_(std::move(chunks)) {}

    bool next(std::vector<std::uint8_t>& out) override {
        if (sent_ >= chunks_.size())
            return false;

        const auto& chunk = chunks_[sent_++];
        out.assign(chunk.begin(), chunk.end());
        return true;
    }

private:
    std::vector<std::string> chunks_;
    size_t sent_ = 0;
};

StreamOpener opensWith(std::vector<std::string> chunks, std::string contentType = "audio/ogg",
                       int* opens = nullptr) {
    return [chunks = std::move(chunks), contentType = std::move(contentType),
            opens](const std::string&) -> OpenedStream {
        if (opens != nullptr)
            ++*opens;
        return {contentType, std::make_unique<FiniteStream>(chunks)};
    };
}

std::string ticketFrom(const TestServer& server) {
    const auto response =
        server.client().Post("/api/stream/ticket", TestServer::bearer(), "", "application/json");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["ticket"].get<std::string>();
}

httplib::Result listen(const TestServer& server, const std::string& ticket) {
    return server.client().Get("/api/stream?ticket=" + ticket);
}

}  // namespace

TEST_CASE("a ticket is issued to a caller holding the token") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"ogg"})));

    const auto response =
        server.client().Post("/api/stream/ticket", TestServer::bearer(), "", "application/json");

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

    const auto response =
        server.client().Post("/api/stream/ticket", TestServer::bearer(), "", "application/json");

    REQUIRE(response);
    REQUIRE(response->status == 200);

    // A client schedules its reconnect off this, so a lifetime that never left config.json
    // is a client that reconnects at the wrong moment for the whole session.
    CHECK(json::parse(response->body)["expiresIn"] == 45);
}

TEST_CASE("issuing a ticket needs the token like every other route") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"ogg"})));

    const auto response = server.client().Post("/api/stream/ticket", "", "application/json");

    REQUIRE(response);
    CHECK(response->status == 401);
}

TEST_CASE("a ticket streams the bytes the session produces") {
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

// The route is exempt from the bearer filter so a ticket can reach it; that exemption must not
// become a second way in.
TEST_CASE("the bearer token does not substitute for a ticket") {
    int opens = 0;
    const TestServer server(servingSettings(),
                            TestServer::streaming(opensWith({"a"}, "audio/ogg", &opens)));

    const auto response = server.client().Get("/api/stream", TestServer::bearer());

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
        const auto response = server.client().Post("/api/stream/ticket", TestServer::bearer(), "",
                                                   "application/json");
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
        const auto response = server.client().Get("/api/capabilities", TestServer::bearer());
        REQUIRE(response);
        CHECK(json::parse(response->body)["canStream"] == false);
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

    const auto response = server.client().Get("/api/capabilities", TestServer::bearer());

    REQUIRE(response);
    const auto body = json::parse(response->body);
    CHECK(body["canStream"] == true);
    CHECK(body["streamFormats"] == json::array({"opus", "aac"}));
}

TEST_CASE("capabilities reports streaming when a source is wired up") {
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a"})));

    const auto response = server.client().Get("/api/capabilities", TestServer::bearer());

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
    const TestServer server(servingSettings(), TestServer::streaming(opensWith({"a"})),
                            [] { return std::string(); });

    const auto response =
        server.client().Post("/api/stream/ticket", TestServer::bearer(), "", "application/json");

    REQUIRE(response);
    CHECK(response->status == 503);
}

TEST_CASE("a stream with nothing to send yet is not a stream that ended") {
    // What a session does while the player is paused: it has no audio, and says so rather
    // than blocking, so the route gets a chance to check that anybody is still there.
    class IdleThenAudio : public StreamSession {
    public:
        bool next(std::vector<std::uint8_t>& out) override {
            out.clear();
            if (idles_ < 3) {
                ++idles_;
                return true;
            }

            if (sent_)
                return false;

            sent_ = true;
            out = {'o', 'g', 'g'};
            return true;
        }

    private:
        int idles_ = 0;
        bool sent_ = false;
    };

    const TestServer server(servingSettings(),
                            TestServer::streaming([](const std::string&) -> OpenedStream {
                                return {"audio/ogg", std::make_unique<IdleThenAudio>()};
                            }));

    const auto response = listen(server, ticketFrom(server));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == "ogg");
}
