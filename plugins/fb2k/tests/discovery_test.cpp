#include "third_party/doctest.h"

#include "core/api.h"
#include "support/fixtures.h"
#include "third_party/json.hpp"

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

Settings settingsWithAllowlist() {
    return servingSettingsAllowing({"rating", "comment"});
}

}  // namespace

TEST_CASE("the discovery record never carries the token, and anyone reaching beefweb can read it") {
    const auto settings = settingsWithAllowlist();
    const auto document = discoveryDocument(settings, listeningStatus());
    const auto body = json::parse(document);

    CHECK(document.find(settings.authToken) == std::string::npos);
    CHECK(body.find("authToken") == body.end());
}

// The allowlist says what may be done to somebody's files. Only /api/capabilities answers it,
// and only to a caller that has proved who it is.
TEST_CASE("the discovery record never carries the write allowlist") {
    const auto document = discoveryDocument(settingsWithAllowlist(), listeningStatus());

    CHECK(document.find("allowedFields") == std::string::npos);
    CHECK(document.find("comment") == std::string::npos);
}

TEST_CASE("the discovery record tells a client where and whether to call") {
    Settings settings = settingsWithAllowlist();
    settings.port = 8881;

    const auto body = json::parse(discoveryDocument(settings, listeningStatus()));

    CHECK(body["name"] == "foo_jean");
    CHECK(body["port"] == 8881);
    CHECK(body["listening"] == true);
    CHECK(body["authRequired"] == true);
}

TEST_CASE("a failed start is published, so a client can say installed rather than absent") {
    ListenerStatus taken;
    taken.error = "could not bind 127.0.0.1:8881; the port is in use";
    taken.portInUse = true;

    const auto body = json::parse(discoveryDocument(settingsWithAllowlist(), taken));

    CHECK(body["listening"] == false);
    CHECK(body["portInUse"] == true);
    CHECK(body["error"] == taken.error);
}

TEST_CASE("a healthy record carries no error keys to misread") {
    const auto body = json::parse(discoveryDocument(settingsWithAllowlist(), listeningStatus()));

    CHECK(body.find("error") == body.end());
    CHECK(body.find("portInUse") == body.end());
}

TEST_CASE("the discovery record and /api/status agree about who we are") {
    const auto record = json::parse(discoveryDocument(settingsWithAllowlist(), listeningStatus()));
    const auto status = json::parse(statusDocument());

    CHECK(record["name"] == status["name"]);
    CHECK(record["version"] == status["version"]);
    CHECK(record["apiVersion"] == status["apiVersion"]);
    CHECK(record["authRequired"] == status["authRequired"]);
}
