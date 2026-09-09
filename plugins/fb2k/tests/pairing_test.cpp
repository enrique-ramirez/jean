// The only route that hands out the token. Its three bounds are independent and each is pinned
// on its own: an open window, a caller on the local network, and one grant per press.

#include "third_party/doctest.h"

#include "core/pairing.h"
#include "support/log_capture.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <chrono>
#include <string>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

using Clock = PairingWindow::Clock;

constexpr auto kNow = Clock::time_point{} + std::chrono::hours(1000);

// Only stored and shown, never compared, so any instant will do.
std::chrono::system_clock::time_point wall() {
    return std::chrono::system_clock::now();
}

httplib::Result pair(const TestServer& server, const std::string& body = "{}") {
    return server.client().Post("/api/pair", body, "application/json");
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

    // A range is a property of the sixteen bytes, not of the text. `fc::1` is `00fc::1` and
    // shares a prefix with `fc00::/7` only as a string; reading it as one admits an address
    // from outside the network to the pairing window.
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

TEST_CASE("an origin is reduced to its host") {
    CHECK(hostOfOrigin("http://player.local:8880") == "player.local");
    CHECK(hostOfOrigin("https://Player.Local") == "player.local");
    CHECK(hostOfOrigin("http://10.0.0.4:8123") == "10.0.0.4");
    CHECK(hostOfOrigin("http://[fe80::1]:8880") == "fe80::1");
    CHECK(hostOfOrigin("null").empty());
    CHECK(hostOfOrigin("").empty());
    CHECK(hostOfOrigin("http://").empty());
}

TEST_CASE("the window is shut until somebody opens it") {
    PairingWindow window{std::chrono::seconds(120)};

    CHECK_FALSE(window.isOpen(kNow));
    CHECK(window.claim(kNow, wall(), "192.168.1.5", "") == PairingWindow::Result::NotOpen);
    CHECK(window.history().empty());
}

TEST_CASE("an open window grants exactly once, so two devices means two presses") {
    PairingWindow window{std::chrono::seconds(120)};
    window.open(kNow);

    CHECK(window.isOpen(kNow));
    CHECK(window.claim(kNow, wall(), "192.168.1.5", "TV") == PairingWindow::Result::Granted);

    CHECK_FALSE(window.isOpen(kNow));
    CHECK(window.claim(kNow, wall(), "192.168.1.6", "") == PairingWindow::Result::NotOpen);

    REQUIRE(window.history().size() == 1);
    CHECK(window.history().front().name == "TV");
    CHECK(window.history().front().address == "192.168.1.5");
}

TEST_CASE("the window closes on its own") {
    PairingWindow window{std::chrono::seconds(120)};
    window.open(kNow);

    CHECK(window.isOpen(kNow + std::chrono::seconds(119)));
    CHECK_FALSE(window.isOpen(kNow + std::chrono::seconds(120)));
    CHECK(window.claim(kNow + std::chrono::seconds(121), wall(), "192.168.1.5", "") ==
          PairingWindow::Result::NotOpen);
}

TEST_CASE("remaining counts down and never goes negative") {
    PairingWindow window{std::chrono::seconds(120)};
    CHECK(window.remaining(kNow).count() == 0);

    window.open(kNow);
    CHECK(window.remaining(kNow).count() == 120);
    CHECK(window.remaining(kNow + std::chrono::seconds(90)).count() == 30);
    CHECK(window.remaining(kNow + std::chrono::seconds(600)).count() == 0);
}

// A forwarded port or a tunnel must not be pairable through, or "local network only" stops
// being true without saying so.
TEST_CASE("a caller from outside the local network is refused") {
    PairingWindow window{std::chrono::seconds(120)};
    window.open(kNow);

    CHECK(window.claim(kNow, wall(), "203.0.113.9", "") ==
          PairingWindow::Result::AddressNotPrivate);

    // The grant is unspent, or anything on the internet could hold the route down for ever.
    CHECK(window.isOpen(kNow));
    CHECK(window.claim(kNow, wall(), "192.168.1.5", "") == PairingWindow::Result::Granted);
}

TEST_CASE("a name is display text and is treated as such") {
    PairingWindow window{std::chrono::seconds(120)};

    SUBCASE("pairing never requires one") {
        window.open(kNow);
        CHECK(window.claim(kNow, wall(), "192.168.1.5", "") == PairingWindow::Result::Granted);
        CHECK(window.history().front().name.empty());
    }

    // The name is written to a line-oriented log, so a newline in it would forge a line.
    SUBCASE("a name with control characters is dropped, not stored") {
        window.open(kNow);
        CHECK(window.claim(kNow, wall(), "192.168.1.5", "TV\nPaired: attacker") ==
              PairingWindow::Result::Granted);
        CHECK(window.history().front().name.empty());
    }
}

TEST_CASE("the history is bounded, and drops the oldest rather than the newest") {
    PairingWindow window{std::chrono::seconds(120)};

    for (size_t at = 0; at < kMaxPairingHistory + 5; ++at) {
        window.open(kNow);
        REQUIRE(window.claim(kNow, wall(), "192.168.1.5", "device " + std::to_string(at)) ==
                PairingWindow::Result::Granted);
    }

    const auto history = window.history();
    CHECK(history.size() == kMaxPairingHistory);
    CHECK(history.back().name == "device " + std::to_string(kMaxPairingHistory + 4));
}

TEST_CASE("pairing with no open window is refused, with or without a token") {
    const TestServer server;

    const auto shut = pair(server);
    REQUIRE(shut);
    CHECK(shut->status == 403);
    CHECK(json::parse(shut->body)["error"] == "pairing is not open");

    const auto credentialed =
        server.client().Post("/api/pair", TestServer::bearer(), "{}", "application/json");
    REQUIRE(credentialed);
    CHECK(credentialed->status == 403);
}

TEST_CASE("an open window hands the token to an unauthenticated caller") {
    const TestServer server;
    server.component().openPairingWindow();

    const auto response = pair(server, R"({"name":"Living room TV"})");
    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body["token"] == kToken);
    CHECK(body["apiVersion"] == 1);

    const auto again = pair(server);
    REQUIRE(again);
    CHECK(again->status == 403);
}

TEST_CASE("the pane can see what paired and when") {
    const TestServer server;
    server.component().openPairingWindow();

    CHECK(server.component().pairingState().open);
    CHECK(server.component().pairingState().remainingSeconds > 0);

    REQUIRE(pair(server, R"({"name":"iMac"})")->status == 200);

    const auto state = server.component().pairingState();
    CHECK_FALSE(state.open);
    REQUIRE(state.history.size() == 1);
    CHECK(state.history.front().name == "iMac");
    CHECK_FALSE(state.history.front().address.empty());
}

TEST_CASE("the window can be shut again from the pane") {
    const TestServer server;
    server.component().openPairingWindow();
    server.component().closePairingWindow();

    REQUIRE(pair(server)->status == 403);
}

// A text/plain POST needs no preflight, so a page could fire one blind and burn the grant
// without reading the answer. Requiring JSON is what makes every cross-origin caller preflighted.
TEST_CASE("a request that would skip preflight is refused before it costs anything") {
    const TestServer server;
    server.component().openPairingWindow();

    const auto simple = server.client().Post("/api/pair", "", "text/plain");
    REQUIRE(simple);
    CHECK(simple->status == 415);

    CHECK(server.component().pairingState().open);
    CHECK(pair(server)->status == 200);
}

TEST_CASE("a malformed body is refused rather than guessed at, and spends no grant") {
    const TestServer server;
    server.component().openPairingWindow();

    CHECK(pair(server, "[]")->status == 400);
    CHECK(pair(server, R"({"name":5})")->status == 400);
    CHECK(pair(server, R"({"name":")" + std::string(200, 'x') + R"("})")->status == 400);

    CHECK(server.component().pairingState().open);
}

// The body cap in front of this route is the only thing bounding what an anonymous caller
// can make a headless player read, and this is the only unauthenticated route that does
// anything at all.
TEST_CASE("an oversized pairing body is refused before it can spend the grant") {
    const TestServer server;
    server.component().openPairingWindow();

    // One byte past the limit rather than a multiple of it: the refusal is decided from
    // Content-Length either way, and a body the client is still writing when the server
    // closes on it makes whether the 413 arrives a race.
    const auto oversize =
        server.client().Post("/api/pair", std::string(kMaxBodyBytes + 1, 'x'), "application/json");

    REQUIRE(oversize);
    CHECK(oversize->status == 413);

    // The window is what the person at the player opened, and no anonymous caller may cost
    // them it: a legitimate device pairing straight afterwards is the proof.
    CHECK(server.component().pairingState().open);
    CHECK(pair(server)->status == 200);
}

// foo_jean.log is a line format, and the pairing line is the one somebody reads after a
// pairing they did not expect.
TEST_CASE("a name cannot forge a line in the log on its way to the pane") {
    clearLog();

    const TestServer server;
    server.component().openPairingWindow();

    REQUIRE(pair(server, R"({"name":"TV\n[info] paired with 203.0.113.9"})")->status == 200);

    CHECK_FALSE(logged("203.0.113.9"));

    const auto lines = loggedLines();
    CHECK(std::none_of(lines.begin(), lines.end(), [](const std::string& line) {
        return line.find('\n') != std::string::npos;
    }));

    // The label costs the label and not the pairing: the device is still paired and the pane
    // still has a row for it.
    const auto state = server.component().pairingState();
    REQUIRE(state.history.size() == 1);
    CHECK(state.history.front().name.empty());
}

TEST_CASE("an empty body is a pairing with no name") {
    const TestServer server;
    server.component().openPairingWindow();

    const auto response = server.client().Post("/api/pair", "", "application/json");
    REQUIRE(response);
    CHECK(response->status == 200);
}

// The permissive CORS default is safe while every route needs a token to do anything. This one
// does not, so it keeps the stricter same-host rule: no other origin may read a token out of it.
TEST_CASE("the pairing route does not reflect any origin the way the rest do") {
    const TestServer server;
    server.component().openPairingWindow();

    const httplib::Headers elsewhere{{"Origin", "http://evil.example"}};

    SUBCASE("a foreign origin gets no allow header on pairing") {
        const auto response =
            server.client().Post("/api/pair", elsewhere, "{}", "application/json");
        REQUIRE(response);
        CHECK_FALSE(response->has_header("Access-Control-Allow-Origin"));
    }

    SUBCASE("its preflight is refused too, so the POST never happens in a browser") {
        const auto preflight = server.client().Options("/api/pair", elsewhere);
        REQUIRE(preflight);
        CHECK_FALSE(preflight->has_header("Access-Control-Allow-Origin"));
    }

    SUBCASE("every other route still reflects it, which is the default this preserves") {
        const auto status = server.client().Get("/api/status", elsewhere);
        REQUIRE(status);
        CHECK(status->get_header_value("Access-Control-Allow-Origin") == "http://evil.example");
    }

    SUBCASE("an origin on the host the request was addressed to is allowed") {
        const std::string host = std::string(TestServer::kClientHost) + ":8880";
        const httplib::Headers sameHost{{"Origin", "http://" + host}};

        const auto preflight = server.client().Options("/api/pair", sameHost);
        REQUIRE(preflight);
        CHECK(preflight->get_header_value("Access-Control-Allow-Origin") == "http://" + host);
    }
}

TEST_CASE("a named origin list governs pairing as it governs everything else") {
    auto settings = servingSettings();
    settings.allowedOrigins = {"http://localhost:8123"};
    const TestServer server(settings);
    server.component().openPairingWindow();

    const httplib::Headers dev{{"Origin", "http://localhost:8123"}};
    const auto response = server.client().Post("/api/pair", dev, "{}", "application/json");
    REQUIRE(response);
    CHECK(response->get_header_value("Access-Control-Allow-Origin") == "http://localhost:8123");
    CHECK(response->status == 200);
}

TEST_CASE("pairing attempts are limited separately from playlist changes") {
    const TestServer server;

    int allowed = 0;
    for (int attempt = 0; attempt < 40; ++attempt) {
        const auto response = pair(server);
        REQUIRE(response);
        if (response->status != 429)
            ++allowed;
    }

    // Ten, the burst in core/http_server.cpp, and a token comes back only every six seconds
    // so nothing here can earn one. "Some were refused" would pass with a burst of thirty-nine,
    // which is not a limit in front of an unauthenticated route.
    CHECK(allowed == 10);

    // Two separate limiters, so hammering this cannot lock a legitimate client out of the API.
    const auto playlists = server.client().Get("/api/capabilities", TestServer::bearer());
    REQUIRE(playlists);
    CHECK(playlists->status == 200);
}
