// cpp-httplib's default socket options would let a second server bind a port this one already
// holds and split traffic with it, silently. These are the guard on that.

#include "third_party/doctest.h"

#include "core/audience.h"

#include "support/fixtures.h"
#include "support/log_capture.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <future>
#include <iterator>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

// The spec writes paths against a server whose base is /api, and a templated one has to be
// filled in with something the router will match before it can be dialled at all.
std::string dialable(std::string path) {
    const auto templated = path.find("{id}");
    if (templated != std::string::npos)
        path.replace(templated, 4, kPlaylistId);

    return "/api" + path;
}

httplib::Result anonymously(const TestServer& server, const std::string& method,
                            const std::string& path) {
    if (method == "GET")
        return server.client().Get(path);
    if (method == "DELETE")
        return server.client().Delete(path);

    return server.client().Post(path, "{}", "application/json");
}

// The one refusal the bearer filter makes, told apart from every other 401 by its wording:
// GET /api/stream answers 401 too, and means "no ticket" rather than "no token".
bool refusedForWantOfAToken(const httplib::Response& response) {
    return response.status == 401 &&
           json::parse(response.body)["error"] == "authentication required";
}

}  // namespace

TEST_CASE("a port already in use is refused, loudly, and named as such") {
    const TestServer first;
    REQUIRE(first.status().listening);

    Settings second = servingSettings();
    second.port = first.port();

    Audience audience(second.maxConcurrentStreams, std::chrono::seconds(kMuteLingerSeconds));
    HttpServer collider(second, audience);
    const auto status = collider.start();

    CHECK_FALSE(status.listening);
    CHECK(status.portInUse);
    CHECK(status.error.find(std::to_string(first.port())) != std::string::npos);
    CHECK(status.error.find("the port is in use") != std::string::npos);
}

// 192.0.2.1 is RFC 5737's TEST-NET-1, reserved for documentation and never a real interface, so
// binding it fails the same way on any machine this suite runs on.
TEST_CASE("a bind address this machine does not hold is refused as unavailable, not as taken") {
    Settings settings = servingSettings();
    settings.bindAddress = "192.0.2.1";

    const TestServer server(settings);

    CHECK_FALSE(server.status().listening);
    CHECK_FALSE(server.status().portInUse);
    CHECK(server.status().error.find(settings.bindAddress) != std::string::npos);
    CHECK(server.status().error.find("not one this machine holds") != std::string::npos);
}

TEST_CASE("a collision leaves the first server serving everything, not half of it") {
    const TestServer first;

    Settings second = servingSettings();
    second.port = first.port();

    Audience audience(second.maxConcurrentStreams, std::chrono::seconds(kMuteLingerSeconds));
    HttpServer collider(second, audience);
    collider.start();

    // Ten in a row: a split port shows up as an occasional failure, not a consistent one.
    std::vector<int> statuses;
    std::generate_n(std::back_inserter(statuses), 10, [&first] {
        const auto response = first.client().Get("/api/status");
        return response ? response->status : 0;
    });

    CHECK(std::count(statuses.begin(), statuses.end(), 200) == 10);
}

TEST_CASE("a dozen clients arriving together are all answered") {
    const TestServer server;

    std::vector<std::future<int>> pending;
    std::generate_n(std::back_inserter(pending), 12, [&server] {
        return std::async(std::launch::async, [&server] {
            const auto response = server.client().Get("/api/capabilities", TestServer::bearer());
            return response ? response->status : 0;
        });
    });

    const auto answered = std::count_if(pending.begin(), pending.end(),
                                        [](std::future<int>& reply) { return reply.get() == 200; });

    CHECK(answered == 12);
}

TEST_CASE("stopping is idempotent and releases the port") {
    Settings settings = servingSettings();
    Audience audience(settings.maxConcurrentStreams, std::chrono::seconds(kMuteLingerSeconds));

    // Binds the same port twice by hand, so it cannot go through TestServer -- but it needs
    // the same retry, because freePort() closes its probe before this binds and something
    // else occasionally takes the port in between.
    for (int attempt = 0; attempt < 5; ++attempt) {
        settings.port = freePort();

        HttpServer server(settings, audience);
        if (!server.start().listening)
            continue;

        server.stop();
        server.stop();  // must not hang or throw

        HttpServer reused(settings, audience);
        CHECK(reused.start().listening);
        return;
    }

    FAIL("no port stayed free long enough to bind it twice");
}

TEST_CASE("an unknown route is a 404 rather than anything more interesting") {
    const TestServer server;

    const auto response = server.client().Get("/api/no/such/thing", TestServer::bearer());

    REQUIRE(response);
    CHECK(response->status == 404);
}

// cpp-httplib routes before it reads a body, so an unrouted POST answers 404 and the payload
// limit is never consulted. tag_route_test.cpp covers the limit on a route that does read one.
TEST_CASE("a large request body to an unrouted path costs us nothing and leaves us serving") {
    const TestServer server;

    const auto oversized =
        server.client().Post("/api/no/such/thing", TestServer::bearer(),
                             std::string(kMaxBodyBytes + 1, 'x'), "application/json");
    REQUIRE(oversized);
    CHECK(oversized->status == 404);

    const auto afterwards = server.client().Get("/api/status");
    REQUIRE(afterwards);
    CHECK(afterwards->status == 200);
}

TEST_CASE("a POST to a route that does not exist is a 404, not a 405 or a crash") {
    const TestServer server;

    const auto response = server.client().Post("/api/capabilities", TestServer::bearer(),
                                               std::string("{}"), "application/json");

    REQUIRE(response);
    CHECK(response->status == 404);
}

TEST_CASE("JSON responses forbid content type sniffing") {
    const TestServer server;

    const auto response = server.client().Get("/api/status");

    REQUIRE(response);
    CHECK(response->get_header_value("X-Content-Type-Options") == "nosniff");
    CHECK(response->get_header_value("Content-Type") == "application/json");
}

TEST_CASE("an error response says nothing about the machine it came from") {
    const TestServer server;

    const auto response = server.client().Get("/api/capabilities");

    REQUIRE(response);
    REQUIRE(response->status == 401);

    const auto body = json::parse(response->body);
    CHECK(body["error"] == "authentication required");
    CHECK(body.size() == 1);
}

// cpp-httplib answers its own 404s and 413s with an empty body, so those are filled in for it.
TEST_CASE("every error answer is JSON, including the ones cpp-httplib makes itself") {
    const TestServer server(servingSettings(), TestServer::writing([](const TagWrite&) {
                                return TagWriteOutcome::written;
                            }));

    struct Case {
        const char* what;
        httplib::Result response;
    };

    // One byte past the limit: the refusal is decided from Content-Length, and a body still
    // in flight when the server closes on it makes whether the answer arrives a race.
    const auto oversize = std::string(kMaxBodyBytes + 1, 'x');
    std::vector<Case> cases;
    cases.push_back({"unknown route", server.client().Get("/api/nope", TestServer::bearer())});
    cases.push_back({"no credential", server.client().Get("/api/capabilities")});
    cases.push_back({"oversized body", server.client().Post("/api/tags", TestServer::bearer(),
                                                            oversize, "application/json")});

    for (const auto& one : cases) {
        INFO("case: ", one.what);
        REQUIRE(one.response);
        CHECK(one.response->status >= 400);
        CHECK(one.response->get_header_value("Content-Type") == "application/json");

        const auto body = json::parse(one.response->body);
        CHECK(body.contains("error"));
        CHECK_FALSE(body["error"].get<std::string>().empty());
    }
}

// The invariant an origin in allowedOrigins rests on: once granted, it reads our answers whole,
// so any route that answers without a credential must be safe for such an origin to read. The
// routes come from contract/openapi.yaml rather than from a list kept here, so a route this test
// has never heard of is covered the moment it is documented, and one that wants to be public has
// to write `security: []` into the contract where a reviewer will see it.
TEST_CASE("only status, stream and pair answer without a credential") {
    const TestServer server(servingSettings(), TestServer::writing([](const TagWrite&) {
                                return TagWriteOutcome::written;
                            }));

    SUBCASE("every documented route is refused unless the specification exempts it") {
        const auto routes = publishedRoutes();
        REQUIRE(routes.size() > 10);

        std::vector<std::string> exempt;

        for (const auto& route : routes) {
            const auto path = dialable(route.path);
            INFO("route: ", route.method, " ", path);

            const auto response = anonymously(server, route.method, path);
            REQUIRE(response);

            if (route.needsNoToken) {
                CHECK_FALSE(refusedForWantOfAToken(*response));
                exempt.push_back(path);
                continue;
            }

            CHECK(refusedForWantOfAToken(*response));
        }

        // Named as well as counted: the derived check above passes just as happily with a
        // fourth exemption in the specification, and this is where that has to be argued for.
        CHECK(exempt == std::vector<std::string>{"/api/status", "/api/pair", "/api/stream"});
    }

    SUBCASE("status is public, and says nothing sensitive") {
        const auto response = server.client().Get("/api/status");

        REQUIRE(response);
        CHECK(response->status == 200);

        const auto body = json::parse(response->body);
        CHECK(body["name"] == "foo_jean");
        CHECK(body.size() == 4);
        CHECK(body.find("allowedFields") == body.end());
        CHECK(body.find("authToken") == body.end());
    }

    // The only one that does anything, and it rests on a window opened at the player rather
    // than on the CORS default, which it does not take. tests/pairing_test.cpp covers it.
    SUBCASE("pair answers without a credential and refuses without a window") {
        const auto response = server.client().Post("/api/pair", "{}", "application/json");

        REQUIRE(response);
        CHECK(response->status == 403);
        CHECK(json::parse(response->body)["error"] == "pairing is not open");
    }

    SUBCASE("an unknown route reveals nothing either way") {
        const auto anonymous = server.client().Get("/api/secret");
        const auto credentialed = server.client().Get("/api/secret", TestServer::bearer());

        REQUIRE(anonymous);
        REQUIRE(credentialed);
        CHECK(anonymous->status == 401);  // refused before routing, so it says nothing
        CHECK(credentialed->status == 404);
    }
}
