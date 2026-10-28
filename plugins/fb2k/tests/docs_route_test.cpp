#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/player.h"
#include "support/fixtures.h"
#include "support/test_server.h"

#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

constexpr char kContract[] = "openapi: 3.1.0\ninfo:\n  title: foo_jean\n";
constexpr char kPage[] =
    "<!doctype html><title>foo_jean API</title><script src=\"/api/docs/init.js\">";
constexpr char kStyle[] = ".swagger-ui{margin:0}";
constexpr char kMissing[] = "no such file";

struct FakeBuild {
    std::map<std::string, std::string> files{
        {"index.html", "<!doctype html><title>Jean</title>"},
        {"api/openapi.yaml", kContract},
        {"api/docs/index.html", kPage},
        {"api/docs/swagger-ui.css", kStyle},
        {"api/docs/NOTICE", "Copyright"},
    };
    std::vector<std::string> askedOfDisk;
};

Player serving(FakeBuild* build) {
    Player player = servingPlayer();
    player.page.read = [build](const std::string& path) -> std::optional<std::string_view> {
        const auto found = build->files.find(path);
        if (found == build->files.end())
            return std::nullopt;

        return found->second;
    };
    player.page.names = {"index.html", "api"};
    player.page.readDisk = [build](const std::string& path) {
        build->askedOfDisk.push_back(path);
        return DiskPage{};
    };
    return player;
}

std::string mediaType(const httplib::Result& response) {
    const auto type = response->get_header_value("Content-Type");
    return type.substr(0, type.find(';'));
}

httplib::Result holding(const TestServer& server, const std::string& path, const std::string& tag) {
    return server.client().Get(path, httplib::Headers{{"If-None-Match", tag}});
}

}  // namespace

TEST_CASE(
    "GET /api/openapi.yaml answers the contract compiled in, as yaml, revalidated on every "
    "load") {
    FakeBuild build;
    const TestServer server(servingSettings(), serving(&build));

    const auto response = get(server, "/api/openapi.yaml");
    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == kContract);
    CHECK(mediaType(response) == "application/yaml");
    CHECK(response->get_header_value("Cache-Control") == "private, no-cache");

    const auto tag = response->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    const auto again = holding(server, "/api/openapi.yaml", tag);
    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
    CHECK(again->get_header_value("ETag") == tag);
}

TEST_CASE(
    "GET /api/docs, with or without the slash, answers the page under a policy that lets "
    "Swagger UI draw its icons") {
    FakeBuild build;
    const TestServer server(servingSettings(), serving(&build));

    for (const char* path : {"/api/docs", "/api/docs/"}) {
        INFO("path: ", path);
        const auto response = get(server, path);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->body == kPage);
        CHECK(mediaType(response) == "text/html");

        const auto policy = response->get_header_value("Content-Security-Policy");
        CHECK(policy.find("script-src 'self';") != std::string::npos);
        CHECK(policy.find("style-src 'self';") != std::string::npos);
        CHECK(policy.find("img-src 'self' data:;") != std::string::npos);
        CHECK(policy.find("frame-ancestors 'none'") != std::string::npos);
        CHECK(response->get_header_value("X-Frame-Options") == "DENY");
    }
}

TEST_CASE(
    "a file the page loads is answered with its extension's type, and any other name under "
    "/api/docs/ is a 404 naming it, with disk never asked") {
    FakeBuild build;
    const TestServer server(servingSettings(), serving(&build));

    const auto style = get(server, "/api/docs/swagger-ui.css");
    REQUIRE(style);
    CHECK(style->status == 200);
    CHECK(style->body == kStyle);
    CHECK(mediaType(style) == "text/css");

    for (const char* path : {"/api/docs/init.js", "/api/docs/NOTICE"}) {
        INFO("path: ", path);
        const auto response = get(server, path);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(errorOf(*response) == kMissing);
    }

    CHECK(build.askedOfDisk.empty());
}

TEST_CASE("a build with no page compiled in answers the three routes as missing") {
    const TestServer server;

    for (const char* path : {"/api/openapi.yaml", "/api/docs", "/api/docs/swagger-ui.css"}) {
        INFO("path: ", path);
        const auto response = get(server, path);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(errorOf(*response) == kMissing);
    }
}
