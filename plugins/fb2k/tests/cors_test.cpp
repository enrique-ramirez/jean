#include "third_party/doctest.h"

#include "support/test_server.h"

using namespace jean;
using namespace jean::testing;

namespace {

httplib::Headers from(const std::string& origin) {
    return httplib::Headers{{"Origin", origin}};
}

}  // namespace

// Safe only while every route that answers without a credential reveals nothing; the last
// test in listener_test.cpp pins that.
TEST_CASE("by default any origin is reflected") {
    const TestServer server;

    for (const char* origin : {"http://127.0.0.1:8880", "http://localhost:5173",
                               "http://player.local:8880", "https://jean.example"}) {
        const auto response = server.client().Get("/api/status", from(origin));

        INFO("origin: ", origin);
        REQUIRE(response);
        CHECK(response->get_header_value("Access-Control-Allow-Origin") == origin);
    }
}

// A literal `*` forbids credentialed mode outright; reflecting keeps that door open.
TEST_CASE("the origin is reflected rather than answered with a star") {
    const TestServer server;

    const auto response = server.client().Get("/api/status", from("https://jean.example"));

    REQUIRE(response);
    CHECK(response->get_header_value("Access-Control-Allow-Origin") == "https://jean.example");
    CHECK(response->get_header_value("Access-Control-Allow-Origin") != "*");
}

TEST_CASE("a request with no origin gets no allow header") {
    const TestServer server;

    const auto response = server.client().Get("/api/status");

    REQUIRE(response);
    CHECK(response->get_header_value("Access-Control-Allow-Origin").empty());
}

TEST_CASE("responses say they vary by origin, so a shared cache cannot cross-serve them") {
    const TestServer server;

    for (const char* origin : {"http://127.0.0.1:8880", "http://evil.example"}) {
        const auto response = server.client().Get("/api/status", from(origin));

        REQUIRE(response);
        CHECK(response->get_header_value("Vary") == "Origin");
    }
}

TEST_CASE("a configured origin list narrows the default to exactly that list") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"https://jean.example"};

    const TestServer server(settings);

    SUBCASE("a listed origin is reflected") {
        const auto response = server.client().Get("/api/status", from("https://jean.example"));

        REQUIRE(response);
        CHECK(response->get_header_value("Access-Control-Allow-Origin") == "https://jean.example");
    }

    SUBCASE("anything else is refused, including one that the default would have allowed") {
        for (const char* origin :
             {"http://evil.example", "http://127.0.0.1:8880", "https://jean.example.evil.com"}) {
            const auto response = server.client().Get("/api/status", from(origin));

            INFO("origin: ", origin);
            REQUIRE(response);
            CHECK(response->get_header_value("Access-Control-Allow-Origin").empty());
        }
    }
}

TEST_CASE("a configured origin matches case-insensitively, because config.json is typed by hand") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"HTTPS://Jean.Example"};

    const TestServer server(settings);
    const auto response = server.client().Get("/api/status", from("https://jean.example"));

    REQUIRE(response);
    CHECK(response->get_header_value("Access-Control-Allow-Origin") == "https://jean.example");
}

// A browser sends no credentials on a preflight, so it must be answered before the token check
// or the real request never follows.
TEST_CASE("preflight is answered without a credential") {
    const TestServer server;

    const auto response = server.client().Options("/api/tags", from("http://localhost:5173"));

    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(response->get_header_value("Access-Control-Allow-Origin") == "http://localhost:5173");
    CHECK(response->get_header_value("Access-Control-Allow-Headers").find("Authorization") !=
          std::string::npos);
    CHECK(response->get_header_value("Access-Control-Allow-Methods").find("POST") !=
          std::string::npos);
}

// /api/stream is exempt from the bearer filter, and the preflight handler runs before that
// exemption. A browser has to be able to preflight it like anything else, or a page cannot
// fetch the stream at all.
TEST_CASE("the stream's exemption from the token does not change its preflight") {
    const TestServer server;
    const auto origin = from("http://localhost:5173");

    const auto stream = server.client().Options("/api/stream", origin);
    const auto ordinary = server.client().Options("/api/tags", origin);

    REQUIRE(stream);
    REQUIRE(ordinary);
    CHECK(stream->status == ordinary->status);
    CHECK(stream->get_header_value("Access-Control-Allow-Origin") ==
          ordinary->get_header_value("Access-Control-Allow-Origin"));
    CHECK(stream->get_header_value("Access-Control-Allow-Methods") ==
          ordinary->get_header_value("Access-Control-Allow-Methods"));
}

TEST_CASE("preflight says nothing about which routes exist") {
    const TestServer server;
    const auto origin = from("http://localhost:5173");

    const auto known = server.client().Options("/api/tags", origin);
    const auto invented = server.client().Options("/api/no/such/thing", origin);

    REQUIRE(known);
    REQUIRE(invented);
    CHECK(known->status == invented->status);
    CHECK(known->get_header_value("Access-Control-Allow-Methods") ==
          invented->get_header_value("Access-Control-Allow-Methods"));
}
