#include "third_party/doctest.h"

#include "core/admission.h"
#include "core/settings.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <optional>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr const char* kLanClient = "192.168.1.40";

constexpr char kIndex[] = "<!doctype html><title>Jean</title>";

Admission fromLan(const std::string& host, const std::vector<std::string>& allowedHosts = {}) {
    return admit(kLanClient, host, allowedHosts);
}

// The pointer must outlive the server.
Player servingPage(int* pagesRead) {
    Player player = servingPlayer();
    player.readPage = [pagesRead](const std::string&) -> std::optional<std::string> {
        ++*pagesRead;
        return std::string(kIndex);
    };
    return player;
}

httplib::Headers naming(const std::string& host, const TestServer& server) {
    return httplib::Headers{{"Host", host + ":" + std::to_string(server.port())}};
}

Settings fromConfigFile(const json& extra) {
    json file = json::parse(serialiseSettings(servingSettings()));
    file.update(extra);
    return parseSettings(file.dump());
}

}  // namespace

TEST_CASE("a private address is the local network and nothing else") {
    SUBCASE("the RFC1918 ranges") {
        CHECK(isPrivateAddress("10.0.0.1"));
        CHECK(isPrivateAddress("10.255.255.255"));
        CHECK(isPrivateAddress("192.168.1.40"));
        CHECK(isPrivateAddress("172.16.0.1"));
        CHECK(isPrivateAddress("172.31.255.254"));
    }

    SUBCASE("loopback and link-local") {
        CHECK(isPrivateAddress("127.0.0.1"));
        CHECK(isPrivateAddress("169.254.1.1"));
    }

    SUBCASE("a routable address is refused") {
        CHECK_FALSE(isPrivateAddress("8.8.8.8"));
        CHECK_FALSE(isPrivateAddress("1.1.1.1"));
        CHECK_FALSE(isPrivateAddress("172.15.0.1"));
        CHECK_FALSE(isPrivateAddress("172.32.0.1"));
        CHECK_FALSE(isPrivateAddress("192.169.0.1"));
    }

    SUBCASE("shared address space, the range Tailscale hands out, is not private") {
        CHECK_FALSE(isPrivateAddress("100.64.0.1"));
        CHECK_FALSE(isPrivateAddress("100.127.255.254"));
    }

    SUBCASE("a prefix test such as \"172.16.\" would let these through") {
        CHECK_FALSE(isPrivateAddress("172.160.0.1"));
        CHECK_FALSE(isPrivateAddress("10.0.0.1.evil.com"));
        CHECK_FALSE(isPrivateAddress("192.1680.0.1"));
        CHECK_FALSE(isPrivateAddress("1.1.1.1000"));
    }

    SUBCASE("nonsense is refused rather than parsed") {
        CHECK_FALSE(isPrivateAddress(""));
        CHECK_FALSE(isPrivateAddress("10.0.0"));
        CHECK_FALSE(isPrivateAddress("10.0.0."));
        CHECK_FALSE(isPrivateAddress("...."));
        CHECK_FALSE(isPrivateAddress("localhost"));
    }

    SUBCASE("the IPv6 forms of the same idea") {
        CHECK(isPrivateAddress("::1"));
        CHECK(isPrivateAddress("fd00::1"));
        CHECK(isPrivateAddress("fc00::1"));
        CHECK(isPrivateAddress("fe80::1"));
        CHECK(isPrivateAddress("FE80::1"));
        CHECK_FALSE(isPrivateAddress("2001:4860:4860::8888"));
        CHECK_FALSE(isPrivateAddress("fec0::1"));
    }

    // `fc::1` is `00fc::1`, and shares a prefix with `fc00::/7` only as a string.
    SUBCASE("a short first group is not the range it looks like") {
        CHECK_FALSE(isPrivateAddress("fc::1"));
        CHECK_FALSE(isPrivateAddress("fd::1"));
        CHECK_FALSE(isPrivateAddress("fe8::1"));
        CHECK_FALSE(isPrivateAddress("feb::1"));
    }

    SUBCASE("every spelling of an address answers alike") {
        CHECK(isPrivateAddress("0:0:0:0:0:0:0:1"));
        CHECK(isPrivateAddress("fe80:0000:0000:0000:0000:0000:0000:0001"));
        CHECK(isPrivateAddress("febf::1"));
        CHECK(isPrivateAddress("::ffff:10.0.0.1"));
    }

    SUBCASE("malformed IPv6 is refused rather than guessed at") {
        CHECK_FALSE(isPrivateAddress("::"));
        CHECK_FALSE(isPrivateAddress(":1"));
        CHECK_FALSE(isPrivateAddress("fe80::1:"));
        CHECK_FALSE(isPrivateAddress("fe80:::1"));
        CHECK_FALSE(isPrivateAddress("fe80::1::2"));
        CHECK_FALSE(isPrivateAddress("12345::1"));
        CHECK_FALSE(isPrivateAddress("1:2:3:4:5:6:7:8:9"));
        CHECK_FALSE(isPrivateAddress("fe80::192.168.1.1.1"));
    }

    SUBCASE("a scope zone is not part of the address") {
        CHECK(isPrivateAddress("fe80::1%en0"));
    }

    SUBCASE("v4-mapped addresses answer as their v4 selves") {
        CHECK(isPrivateAddress("::ffff:192.168.1.5"));
        CHECK_FALSE(isPrivateAddress("::ffff:8.8.8.8"));
    }
}

TEST_CASE("a caller outside the private network is refused whatever host it names") {
    for (const char* source : {"8.8.8.8", "100.64.0.1", "2001:4860:4860::8888", "::ffff:8.8.8.8"}) {
        INFO("source: ", std::string(source));
        CHECK_FALSE(admit(source, "player.lan", {}).admitted);
        CHECK_FALSE(admit(source, "localhost", {}).admitted);
    }
}

TEST_CASE("a private caller naming a local host is admitted from every private spelling") {
    for (const char* source : {"10.0.0.1", "172.16.0.1", "192.168.1.40", "127.0.0.1",
                               "169.254.1.1", "::1", "fd00::1", "fe80::1%en0",
                               "::ffff:192.168.1.5"}) {
        INFO("source: ", std::string(source));
        CHECK(admit(source, "player.lan", {}).admitted);
    }
}

TEST_CASE("every host form the allowlist names is admitted, with or without a port") {
    for (const char* host : {"192.168.1.40", "192.168.1.40:8881", "127.0.0.1", "203.0.113.7:8881",
                             "[::1]", "[::1]:8881", "[fe80::1]:8881", "[2001:db8::1]",
                             "localhost", "localhost:8881", "player", "player:8881",
                             "player.lan", "player.lan:8881", "player.local",
                             "player.local:8881", "player.home.arpa", "player.home.arpa:8881",
                             "deep.sub.player.lan"}) {
        INFO("host: ", std::string(host));
        CHECK(fromLan(host).admitted);
    }
}

TEST_CASE("host matching ignores case") {
    for (const char* host : {"LOCALHOST", "Player.LAN", "player.Local:8881", "PLAYER.HOME.ARPA",
                             "[FE80::1]"}) {
        INFO("host: ", std::string(host));
        CHECK(fromLan(host).admitted);
    }
}

TEST_CASE("one trailing dot is stripped before the host is matched") {
    for (const char* host : {"player.lan.", "player.lan.:8881", "localhost.", "player.local.",
                             "player.home.arpa."}) {
        INFO("host: ", std::string(host));
        CHECK(fromLan(host).admitted);
    }

    CHECK_FALSE(fromLan("player.lan..").admitted);
    CHECK_FALSE(fromLan("evil.example.").admitted);
}

// DNS rebinding sends the attacker's own name in Host, and none of these is a name a
// public registry can hand out inside the allowlist.
TEST_CASE("a public name is refused, including one that merely contains a local suffix") {
    for (const char* host : {"evil.example", "evil.example:8881", "EVIL.EXAMPLE",
                             "player.lan.evil.example", "player.local.evil.example",
                             "localhost.evil.example", "evil.xlan", "evil.notlocal",
                             "evil.example.arpa", "192.168.1.40.evil.example",
                             "[evil.example]", "[evil.example]:8881"}) {
        INFO("host: ", std::string(host));
        CHECK_FALSE(fromLan(host).admitted);
    }
}

TEST_CASE("a request with no host is refused") {
    CHECK_FALSE(fromLan("").admitted);
    CHECK_FALSE(fromLan("", {"music.example"}).admitted);
}

TEST_CASE("a name listed in allowedHosts is admitted, matched whole and ignoring case and port") {
    const std::vector<std::string> allowedHosts{"music.example", "Jukebox.Example"};

    for (const char* host : {"music.example", "music.example:443", "MUSIC.example",
                             "music.example.", "jukebox.example", "JUKEBOX.EXAMPLE:8881"}) {
        INFO("host: ", std::string(host));
        CHECK(fromLan(host, allowedHosts).admitted);
    }

    for (const char* host : {"sub.music.example", "music.example.evil.example", "evil.example",
                             "xmusic.example"}) {
        INFO("host: ", std::string(host));
        CHECK_FALSE(fromLan(host, allowedHosts).admitted);
    }
}

TEST_CASE("a listed name is admitted only from a private caller") {
    CHECK_FALSE(admit("8.8.8.8", "music.example", {"music.example"}).admitted);
}

TEST_CASE("a host refusal names the host it refused and the allowedHosts key") {
    for (const char* host : {"evil.example", "player.lan.evil.example"}) {
        INFO("host: ", std::string(host));

        const Admission refused = fromLan(host);

        REQUIRE_FALSE(refused.admitted);
        CHECK(refused.refusal.find(host) != std::string::npos);
        CHECK(refused.refusal.find("allowedHosts") != std::string::npos);
    }

    const Admission withPort = fromLan("evil.example:8881");
    REQUIRE_FALSE(withPort.admitted);
    CHECK(withPort.refusal.find("evil.example") != std::string::npos);
    CHECK(withPort.refusal.find("allowedHosts") != std::string::npos);
}

TEST_CASE("a host outside the allowlist is refused with 403 on the page, OPTIONS and /api/status") {
    int pagesRead = 0;
    const TestServer server(servingSettings(), servingPage(&pagesRead));
    const auto evil = naming("evil.example", server);

    const auto page = server.client().Get("/", evil);
    REQUIRE(page);
    CHECK(page->status == 403);
    CHECK(page->body.find(kIndex) == std::string::npos);
    CHECK(pagesRead == 0);

    const auto preflight = server.client().Options("/api/tags", evil);
    REQUIRE(preflight);
    CHECK(preflight->status == 403);

    const auto status = server.client().Get("/api/status", evil);
    REQUIRE(status);
    CHECK(status->status == 403);
}

// A listed origin is the one case where CORS would otherwise answer, so it is the case that
// shows the Host check runs ahead of it.
TEST_CASE("a refused host gets no CORS grant, even from a listed origin") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"https://jean.example"};
    const TestServer server(settings);

    auto headers = naming("evil.example", server);
    headers.emplace("Origin", "https://jean.example");

    for (const auto& response : {server.client().Options("/api/tags", headers),
                                 server.client().Get("/api/status", headers)}) {
        REQUIRE(response);
        CHECK(response->status == 403);
        CHECK_FALSE(response->has_header("Access-Control-Allow-Origin"));
    }
}

TEST_CASE("a refused page is plain text naming the host and allowedHosts") {
    int pagesRead = 0;
    const TestServer server(servingSettings(), servingPage(&pagesRead));

    const auto page = server.client().Get("/", naming("evil.example", server));

    REQUIRE(page);
    REQUIRE(page->status == 403);
    CHECK(page->get_header_value("Content-Type").rfind("text/plain", 0) == 0);
    CHECK(page->body.find("evil.example") != std::string::npos);
    CHECK(page->body.find("allowedHosts") != std::string::npos);
}

TEST_CASE("a refused /api/ request is a JSON error naming the host and allowedHosts") {
    const TestServer server;

    const auto response = server.client().Get("/api/status", naming("evil.example", server));

    REQUIRE(response);
    REQUIRE(response->status == 403);
    CHECK(response->get_header_value("Content-Type").rfind("application/json", 0) == 0);

    const auto body = json::parse(response->body, nullptr, false);
    REQUIRE(body.is_object());
    REQUIRE(body["error"].is_string());
    const auto error = body["error"].get<std::string>();
    CHECK(error.find("evil.example") != std::string::npos);
    CHECK(error.find("allowedHosts") != std::string::npos);
}

// Every other test dials 127.0.0.1, so this is the one that proves a name the rule admits,
// sent the way a browser sends it, still reaches the page and the routes.
TEST_CASE("an admitted host reaches the page and the routes as before") {
    int pagesRead = 0;
    const TestServer server(servingSettings(), servingPage(&pagesRead));

    for (const char* host : {"player.lan", "localhost", "player", "[::1]"}) {
        INFO("host: ", std::string(host));
        const auto headers = naming(host, server);

        const auto page = server.client().Get("/", headers);
        REQUIRE(page);
        CHECK(page->status == 200);
        CHECK(page->body == kIndex);

        const auto preflight = server.client().Options("/api/tags", headers);
        REQUIRE(preflight);
        CHECK(preflight->status == 204);

        const auto status = server.client().Get("/api/status", headers);
        REQUIRE(status);
        CHECK(status->status == 200);
    }
}

TEST_CASE("a name listed in allowedHosts in config.json is admitted, and an unlisted one is not") {
    const TestServer server(fromConfigFile({{"allowedHosts", {"music.example"}}}));

    const auto listed = server.client().Get("/api/status", naming("music.example", server));
    REQUIRE(listed);
    CHECK(listed->status == 200);

    const auto unlisted = server.client().Get("/api/status", naming("other.example", server));
    REQUIRE(unlisted);
    CHECK(unlisted->status == 403);
}

// Sec-Fetch-Site is a browser's own account of who sent a request, which a page on another site
// cannot forge. A browser sends it only to a secure origin, so over plain HTTP it is absent.
TEST_CASE("a request another site sent is refused, and one this origin, a typed address or no browser sent is admitted") {
    for (const char* site : {"cross-site", "same-site", "Cross-Site"}) {
        INFO("Sec-Fetch-Site: ", std::string(site));
        const auto refused = admitFetchSite(site, false);
        CHECK_FALSE(refused.admitted);
        CHECK(refused.refusal.find("allowedOrigins") != std::string::npos);
    }

    for (const char* site : {"same-origin", "none", ""}) {
        INFO("Sec-Fetch-Site: ", std::string(site));
        CHECK(admitFetchSite(site, false).admitted);
    }
}

// allowedOrigins is the player owner naming another site's page as a client, and that page's
// requests arrive marked as another site's.
TEST_CASE("a request from another site is admitted when its origin is one allowedOrigins lists") {
    CHECK(admitFetchSite("cross-site", true).admitted);
    CHECK(admitFetchSite("same-site", true).admitted);
}

TEST_CASE("a cross-site request to /api/ is a 403 error document that never reaches the player") {
    TestServer::WriterLog log;
    const TestServer server(servingSettings(), TestServer::recordingWriter(&log));

    for (const char* site : {"cross-site", "same-site"}) {
        INFO("Sec-Fetch-Site: ", std::string(site));
        const httplib::Headers headers{{"Sec-Fetch-Site", site},
                                       {"Origin", "https://evil.example"}};

        const auto write = server.client().Post(
            "/api/tags", headers, R"({"path": "C:\\music\\a.flac", "fields": {"rating": "5"}})",
            "application/json");
        REQUIRE(write);
        CHECK(write->status == 403);
        CHECK(write->get_header_value("Content-Type").rfind("application/json", 0) == 0);
        const auto body = json::parse(write->body, nullptr, false);
        REQUIRE(body.is_object());
        CHECK(body["error"].is_string());

        const auto preflight = server.client().Options("/api/tags", headers);
        REQUIRE(preflight);
        CHECK(preflight->status == 403);
    }

    CHECK(log.calls.empty());
}

TEST_CASE("a request from this origin, a typed address or no browser reaches /api/") {
    const TestServer server;

    for (const char* site : {"same-origin", "none"}) {
        INFO("Sec-Fetch-Site: ", std::string(site));
        const auto response =
            server.client().Get("/api/status", httplib::Headers{{"Sec-Fetch-Site", site}});
        REQUIRE(response);
        CHECK(response->status == 200);
    }

    const auto unmarked = server.client().Get("/api/status");
    REQUIRE(unmarked);
    CHECK(unmarked->status == 200);
}

TEST_CASE("a listed origin reaches /api/ from another site") {
    Settings settings = servingSettings();
    settings.allowedOrigins = {"https://jean.example"};
    const TestServer server(settings);

    const httplib::Headers headers{{"Sec-Fetch-Site", "cross-site"},
                                   {"Origin", "https://jean.example"}};
    const auto response = server.client().Get("/api/status", headers);

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Access-Control-Allow-Origin") == "https://jean.example");
}

// A link to the player from anywhere is how somebody reaches it at all.
TEST_CASE("the page is served whichever site linked to it") {
    int pagesRead = 0;
    const TestServer server(servingSettings(), servingPage(&pagesRead));

    const auto page = server.client().Get("/", httplib::Headers{{"Sec-Fetch-Site", "cross-site"}});

    REQUIRE(page);
    CHECK(page->status == 200);
    CHECK(pagesRead == 1);
}
