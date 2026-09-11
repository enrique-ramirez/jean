// One cover over a real socket, and the pure half behind it.

#include "third_party/doctest.h"

#include "core/artwork.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <iterator>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kTrack[] = "Artist/Album/01.flac";
constexpr char kAddress[] = "/api/artwork?track=Artist%2FAlbum%2F01.flac";

constexpr char kJpeg[] =
    "\xFF\xD8\xFF"
    "and then the rest of a photograph";
constexpr char kPng[] =
    "\x89PNG\r\n\x1A\n"
    "and then the rest of a drawing";

constexpr char kTag[] = "\"7f3a1c00deadbeef\"";

struct ArtLog {
    explicit ArtLog(std::string cover) : picture(std::move(cover)) {}

    std::string picture;
    std::string tag = kTag;
    std::vector<std::string> asked;
};

Player showing(ArtLog* log) {
    return TestServer::showing([log](const std::string& track) {
        log->asked.push_back(track);

        ArtworkSource source;
        if (track != kTrack)
            return source;

        source.tag = log->tag;
        source.picture = log->picture;
        return source;
    });
}

httplib::Result getHolding(const TestServer& server, const std::string& path,
                           const std::string& tag) {
    auto headers = TestServer::bearer();
    headers.emplace("If-None-Match", tag);
    return server.client().Get(path, headers);
}

}  // namespace

TEST_CASE("an address is refused for length and for control characters, never for shape") {
    CHECK(trackAddressRefusal(kTrack).empty());

    CHECK(trackAddressRefusal("../../../etc/passwd").empty());

    CHECK(trackAddressRefusal("") == "'track' is required");
    CHECK_FALSE(trackAddressRefusal(std::string(kMaxTrackAddressLength + 1, 'a')).empty());
    CHECK_FALSE(trackAddressRefusal(std::string("Album/a\nb.flac")).empty());
}

TEST_CASE("only pictures a browser draws are given a type") {
    CHECK(imageTypeOf(kJpeg) == "image/jpeg");
    CHECK(imageTypeOf(kPng) == "image/png");
    CHECK(imageTypeOf("GIF89a and the rest") == "image/gif");
    CHECK(imageTypeOf(std::string("RIFF\x20\x00\x00\x00WEBPVP8 ", 16)) == "image/webp");
    CHECK(imageTypeOf("BM and the rest") == "image/bmp");

    CHECK(imageTypeOf("").empty());
    CHECK(imageTypeOf("not a picture at all").empty());

    // Refusing to name SVG keeps two problems away from this route at once
    // (ARCHITECTURE.md, *Facts about the player*).
    CHECK(imageTypeOf(R"(<svg xmlns="http://www.w3.org/2000/svg"></svg>)").empty());
}

// The validator is the picture rather than a stat of the file the picture came from because
// the player names that file only once it has loaded the picture anyway (ARCHITECTURE.md, *Facts
// about the player*).
TEST_CASE("a validator is the picture, so it moves when and only when the picture does") {
    const auto tag = artworkTag(kJpeg);

    CHECK(tag.front() == '"');
    CHECK(tag.back() == '"');

    SUBCASE("a folder image replaced in place moves it, which nothing in the player announces") {
        CHECK(artworkTag(std::string(kJpeg) + " and a wider scan of the sleeve") != tag);
    }

    SUBCASE("a cover embedded in the track's own tags in place of a folder image moves it") {
        CHECK(artworkTag(kPng) != tag);
    }

    // Nothing but the bytes reaches the fold: no salt, no install identity, nothing a restart
    // would change.
    SUBCASE("a cover nobody touched keeps it, whatever has happened to the component") {
        CHECK(artworkTag(std::string(kJpeg)) == tag);
    }
}

TEST_CASE("a cover is sent with the type it actually is, and a validator to ask again with") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = get(server, kAddress);

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == kJpeg);
    CHECK(response->get_header_value("Content-Type") == "image/jpeg");
    CHECK(response->get_header_value("ETag") == kTag);
    CHECK(log.asked == std::vector<std::string>{kTrack});
}

// no-cache rather than no-store: the client is meant to keep the bytes and ask before it
// trusts them. must-revalidate is not decoration either; the route is authenticated, and
// ARCHITECTURE.md, *Facts about the player*, is what that directive is for and what a browser
// does with the same response, which is not the same question.
TEST_CASE("the client is told to keep the bytes and revalidate them") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = get(server, kAddress);

    REQUIRE(response);
    CHECK(response->get_header_value("Cache-Control") == "no-cache, must-revalidate");
    CHECK(response->get_header_value("Cache-Control").find("no-store") == std::string::npos);
}

TEST_CASE("a client that already holds the cover is answered without the picture") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto first = get(server, kAddress);
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto again = getHolding(server, kAddress, first->get_header_value("ETag"));

    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
    CHECK(again->get_header_value("ETag") == kTag);
    CHECK(again->get_header_value("Cache-Control") == "no-cache, must-revalidate");

    CHECK(log.asked.size() == 2);
}

TEST_CASE("a validator from another cover is not the one this URL holds") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = getHolding(server, kAddress, "\"0000000000000000\"");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == kJpeg);
}

TEST_CASE("an address the snapshot does not hold is a refusal rather than another sleeve") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = get(server, "/api/artwork?track=Artist%2FAlbum%2Fgone.flac");

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(json::parse(response->body)["error"] == "no artwork for that track");
    CHECK(response->get_header_value("ETag").empty());
}

TEST_CASE("a picture in a format this component does not send is refused rather than guessed") {
    ArtLog log{"a file that is not a picture"};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = get(server, kAddress);

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(json::parse(response->body)["error"] ==
          "that artwork is not in a format this component sends");
    CHECK(response->get_header_value("Content-Type") == "application/json");
}

TEST_CASE("a picture larger than this component sends is refused rather than streamed") {
    ArtLog log{std::string(kMaxArtworkBytes + 1, 'x')};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = get(server, kAddress);

    REQUIRE(response);
    CHECK(response->status == 413);
    CHECK(json::parse(response->body)["error"] ==
          "that artwork is larger than this component sends");
}

TEST_CASE("an unusable address never reaches the player") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    SUBCASE("no track at all") {
        const auto response = get(server, "/api/artwork");

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "'track' is required");
    }

    SUBCASE("a control character in the address") {
        const auto response = get(server, "/api/artwork?track=Album%2Fa%0Ab.flac");

        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(log.asked.empty());
}

TEST_CASE("an install that does not serve the library says so rather than answering 404") {
    const TestServer server;

    const auto response = get(server, kAddress);

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(json::parse(response->body)["error"] == "artwork is not available");
}

TEST_CASE("artwork answers nothing without a token") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = server.client().Get(kAddress);

    REQUIRE(response);
    CHECK(response->status == 401);
    CHECK(log.asked.empty());
}

// A screenful of covers is the ordinary case and must not be refused, so what this pins is
// that the ceiling exists at all and that the player stops being reached once it is met.
TEST_CASE("a client looping on artwork stops reaching the player") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));
    auto client = server.client();

    // Twice the burst, so the bucket is exhausted however fast the loop runs: refilling past
    // it would take fifteen seconds of the loop, which nothing sleeps waiting for.
    constexpr int kAttempts = 600;
    int refused = 0;

    // Kept rather than asserted inside the loop, so how many refusals a machine's speed
    // produces cannot change how many assertions the suite runs.
    std::string retryAfter;
    std::string refusal;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = client.Get(kAddress, TestServer::bearer());
        REQUIRE(response);

        if (response->status != 429)
            continue;

        refused++;
        retryAfter = response->get_header_value("Retry-After");
        refusal = json::parse(response->body)["error"].get<std::string>();
    }

    CHECK(refused > 0);
    CHECK(retryAfter == "1");
    CHECK(refusal == "too many artwork requests");
    CHECK(static_cast<int>(log.asked.size()) == kAttempts - refused);
}

// cpp-httplib's own compression list is somebody else's (third_party/README.md), so it is
// pinned here rather than restated as a second mechanism.
TEST_CASE("a cover is never compressed, however the client asks") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = undecoding(server).Get(kAddress, accepting("gzip"));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Encoding").empty());
    CHECK_FALSE(isGzip(response->body));
    CHECK(response->body == kJpeg);
}

// Neither half of a conditional request is free cross-origin (ARCHITECTURE.md, *Facts about the
// player*): without both, the browser cache does the revalidation and an explicit one from
// a page cannot.
TEST_CASE("a page on another origin can read the validator and send it back") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));
    const httplib::Headers origin{{"Origin", "http://localhost:5173"}};

    const auto preflight = server.client().Options("/api/artwork", origin);

    REQUIRE(preflight);
    CHECK(preflight->status == 204);
    CHECK(preflight->get_header_value("Access-Control-Allow-Headers").find("If-None-Match") !=
          std::string::npos);

    auto headers = TestServer::bearer();
    headers.emplace("Origin", "http://localhost:5173");
    const auto first = server.client().Get(kAddress, headers);

    REQUIRE(first);
    REQUIRE(first->status == 200);
    CHECK(first->get_header_value("Access-Control-Expose-Headers").find("ETag") !=
          std::string::npos);

    headers.emplace("If-None-Match", first->get_header_value("ETag"));
    const auto again = server.client().Get(kAddress, headers);

    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->get_header_value("Access-Control-Allow-Origin") == "http://localhost:5173");
}

TEST_CASE("artwork answers no status contract/openapi.yaml does not document") {
    INFO("shape changed -- update contract/openapi.yaml to match");

    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));
    const TestServer off;

    std::set<int> seen;
    const auto note = [&seen](const httplib::Result& response) {
        REQUIRE_MESSAGE(response, "no answer from GET /artwork");
        seen.insert(response->status);
    };

    const auto sent = get(server, kAddress);
    note(sent);
    REQUIRE(sent);

    note(getHolding(server, kAddress, sent->get_header_value("ETag")));
    note(server.client().Get(kAddress));
    note(get(server, "/api/artwork"));
    note(get(server, "/api/artwork?track=Artist%2FAlbum%2Fgone.flac"));
    note(get(off, kAddress));

    ArtLog huge{std::string(kMaxArtworkBytes + 1, 'x')};
    const TestServer enormous(servingSettings(), showing(&huge));
    note(get(enormous, kAddress));

    auto client = server.client();
    for (int attempt = 0; attempt < 600; ++attempt)
        note(client.Get(kAddress, TestServer::bearer()));

    const auto published = publishedRoutes();
    const auto artwork = std::find_if(published.begin(), published.end(), [](const SpecRoute& r) {
        return r.method == "GET" && r.path == "/artwork";
    });

    REQUIRE(artwork != published.end());

    std::set<int> undocumented;
    std::set_difference(seen.begin(), seen.end(), artwork->statuses.begin(),
                        artwork->statuses.end(), std::inserter(undocumented, undocumented.end()));

    CHECK(undocumented.empty());
}
