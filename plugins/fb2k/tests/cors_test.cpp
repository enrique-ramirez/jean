#include "third_party/doctest.h"

#include "support/test_server.h"

#include <algorithm>
#include <cctype>
#include <string>

using namespace jean;
using namespace jean::testing;

namespace {

httplib::Headers from(const std::string& origin) {
    return httplib::Headers{{"Origin", origin}};
}

}  // namespace

TEST_CASE("with no origin list, no origin is reflected on a request or a preflight") {
    const TestServer server;

    for (const char* origin : {"http://127.0.0.1:8880", "http://localhost:5173",
                               "http://player.local:8880", "https://jean.example"}) {
        INFO("origin: ", std::string(origin));

        const auto request = server.client().Get("/api/status", from(origin));
        REQUIRE(request);
        CHECK_FALSE(request->has_header("Access-Control-Allow-Origin"));

        const auto preflight = server.client().Options("/api/tags", from(origin));
        REQUIRE(preflight);
        CHECK_FALSE(preflight->has_header("Access-Control-Allow-Origin"));
    }
}

// A literal `*` forbids credentialed mode outright; reflecting keeps that door open.
TEST_CASE("a listed origin is reflected rather than answered with a star") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"https://jean.example"};
    const TestServer server(settings);

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

TEST_CASE("a configured origin list reflects exactly the origins on it") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"https://jean.example"};

    const TestServer server(settings);

    SUBCASE("a listed origin is reflected, on a request and on its preflight") {
        const auto request = server.client().Get("/api/status", from("https://jean.example"));
        REQUIRE(request);
        CHECK(request->get_header_value("Access-Control-Allow-Origin") == "https://jean.example");

        const auto preflight = server.client().Options("/api/tags", from("https://jean.example"));
        REQUIRE(preflight);
        CHECK(preflight->get_header_value("Access-Control-Allow-Origin") ==
              "https://jean.example");
    }

    SUBCASE("an unlisted origin is not, however close it looks to a listed one") {
        for (const char* origin :
             {"http://evil.example", "http://127.0.0.1:8880", "https://jean.example.evil.com",
              "http://jean.example"}) {
            INFO("origin: ", std::string(origin));

            const auto request = server.client().Get("/api/status", from(origin));
            REQUIRE(request);
            CHECK_FALSE(request->has_header("Access-Control-Allow-Origin"));

            const auto preflight = server.client().Options("/api/tags", from(origin));
            REQUIRE(preflight);
            CHECK_FALSE(preflight->has_header("Access-Control-Allow-Origin"));
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

// Neither header is browser-safelisted (ARCHITECTURE.md, *Facts about the player*). Without ETag
// exposed, a cross-origin page never sees a validator to hold, so the `GET /library` revision
// poll stops working from a page while still working from a command line.
TEST_CASE("the headers a client is told to act on are readable from another origin") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"https://jean.example"};
    const TestServer server(settings);

    const auto response = server.client().Get("/api/status", from("https://jean.example"));

    REQUIRE(response);
    const auto exposed = response->get_header_value("Access-Control-Expose-Headers");

    INFO("exposed: ", exposed);
    CHECK(exposed.find("ETag") != std::string::npos);
    CHECK(exposed.find("Retry-After") != std::string::npos);
}

TEST_CASE("preflight is answered without a credential") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"http://localhost:5173"};
    const TestServer server(settings);

    const auto response = server.client().Options("/api/tags", from("http://localhost:5173"));

    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(response->get_header_value("Access-Control-Allow-Origin") == "http://localhost:5173");
    CHECK(response->get_header_value("Access-Control-Allow-Methods").find("POST") !=
          std::string::npos);
}

// The other half of a conditional request (ARCHITECTURE.md, *Facts about the player*): without
// this, a page could read a validator and never send one back, and every ETagged route
// would be a full download from a browser.
TEST_CASE("the preflight lets a page send back the validator it was allowed to read") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"http://localhost:5173"};
    const TestServer server(settings);

    const auto response = server.client().Options("/api/library", from("http://localhost:5173"));

    REQUIRE(response);
    CHECK(response->get_header_value("Access-Control-Allow-Headers").find("If-None-Match") !=
          std::string::npos);
}

// A browser has to be able to preflight /api/stream like anything else, or a page cannot
// fetch the stream at all.
TEST_CASE("the stream route preflights like any other") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"http://localhost:5173"};
    const TestServer server(settings);
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
    Settings settings = servingSettings();
    settings.allowedOrigins = {"http://localhost:5173"};
    const TestServer server(settings);
    const auto origin = from("http://localhost:5173");

    const auto known = server.client().Options("/api/tags", origin);
    const auto invented = server.client().Options("/api/no/such/thing", origin);

    REQUIRE(known);
    REQUIRE(invented);
    CHECK(known->status == invented->status);
    CHECK(known->get_header_value("Access-Control-Allow-Methods") ==
          invented->get_header_value("Access-Control-Allow-Methods"));
}

// The header list is checked for Content-Type as well, so an answer with no list at all
// cannot pass for one that leaves Authorization out.
TEST_CASE("a preflight never offers Authorization as a header a page may send") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"http://localhost:5173"};
    const TestServer server(settings);

    const auto response = server.client().Options("/api/tags", from("http://localhost:5173"));

    REQUIRE(response);
    REQUIRE(response->status == 204);

    std::string allowed = response->get_header_value("Access-Control-Allow-Headers");
    std::transform(allowed.begin(), allowed.end(), allowed.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    CHECK(allowed.find("content-type") != std::string::npos);
    CHECK(allowed.find("authorization") == std::string::npos);
}
