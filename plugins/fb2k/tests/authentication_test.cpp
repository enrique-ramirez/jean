#include "third_party/doctest.h"

#include "support/test_server.h"
#include "third_party/json.hpp"

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

TEST_CASE("status answers without a credential and says nothing about the write allowlist") {
    const TestServer server;
    REQUIRE(server.status().listening);

    const auto response = server.client().Get("/api/status");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body["name"] == "foo_jean");
    CHECK(body["authRequired"] == true);
    CHECK(body.find("allowedFields") == body.end());
}

TEST_CASE("everything except status demands the token") {
    const TestServer server;
    auto client = server.client();

    SUBCASE("no Authorization header at all") {
        const auto response = client.Get("/api/capabilities");
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("a wrong token of exactly the right length") {
        const auto response =
            client.Get("/api/capabilities", TestServer::bearer(std::string(32, 'f')));
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("a token that is a correct prefix of the real one") {
        const auto response = client.Get("/api/capabilities", TestServer::bearer("0123456789"));
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("the right token with trailing rubbish") {
        const auto response =
            client.Get("/api/capabilities", TestServer::bearer(kToken + std::string("x")));
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("the scheme with no token after it") {
        const httplib::Headers bare{{"Authorization", "Bearer"}};
        const auto response = client.Get("/api/capabilities", bare);
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("an empty Authorization header") {
        const auto response =
            client.Get("/api/capabilities", httplib::Headers{{"Authorization", ""}});
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("the right token behind an extra space") {
        const httplib::Headers padded{{"Authorization", std::string("Bearer  ") + kToken}};
        const auto response = client.Get("/api/capabilities", padded);
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("the wrong scheme carrying the right token") {
        const httplib::Headers basic{{"Authorization", std::string("Basic ") + kToken}};
        const auto response = client.Get("/api/capabilities", basic);
        REQUIRE(response);
        CHECK(response->status == 401);
    }

    SUBCASE("the right token") {
        const auto response = client.Get("/api/capabilities", TestServer::bearer());
        REQUIRE(response);
        CHECK(response->status == 200);
    }
}

// RFC 9110 makes the scheme case-insensitive, so a client sending "bearer" is not wrong.
TEST_CASE("the bearer scheme is matched case-insensitively") {
    const TestServer server;

    for (const char* scheme : {"Bearer ", "bearer ", "BEARER ", "BeArEr "}) {
        const httplib::Headers header{{"Authorization", scheme + std::string(kToken)}};
        const auto response = server.client().Get("/api/capabilities", header);

        REQUIRE(response);
        CHECK(response->status == 200);
    }
}

TEST_CASE("a component with no token configured refuses to listen") {
    Settings settings = servingSettings();
    settings.authToken.clear();

    const TestServer server(settings);

    CHECK_FALSE(server.status().listening);
    CHECK(server.status().error.find("no authentication token") != std::string::npos);
    CHECK_FALSE(server.client().Get("/api/status"));
}

TEST_CASE("an authenticated client is told what it may write") {
    const TestServer server(servingSettingsAllowing({"rating", "comment"}));
    const auto response = server.client().Get("/api/capabilities", TestServer::bearer());

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body["canWrite"] == true);
    CHECK(body["allowedFields"] == json::array({"rating", "comment"}));
}

TEST_CASE("an empty allowlist reports that nothing may be written") {
    const TestServer server(servingSettingsAllowing({}));
    const auto response = server.client().Get("/api/capabilities", TestServer::bearer());

    REQUIRE(response);
    const auto body = json::parse(response->body);
    CHECK(body["canWrite"] == false);
    CHECK(body["allowedFields"].empty());
}
