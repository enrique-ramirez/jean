// Three covers over a real socket, and the pure half behind them: the one a client addresses by
// track, the one the player is showing, which a client addresses by nothing at all, and the one
// a client addresses by a playlist and a position, for a track no path reaches.

#include "third_party/doctest.h"

#include "core/artwork.h"
#include "core/http_server.h"
#include "support/log_capture.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
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

// The same address as a query a client could hang on any route, which is what the positional
// route has to ignore.
constexpr char kTrackQuery[] = "?track=Artist%2FAlbum%2F01.flac";

constexpr char kPlayingAddress[] = "/api/artwork/playing";

constexpr char kJpeg[] =
    "\xFF\xD8\xFF"
    "and then the rest of a photograph";
constexpr char kPng[] =
    "\x89PNG\r\n\x1A\n"
    "and then the rest of a drawing";

constexpr char kTag[] = "\"7f3a1c00deadbeef\"";

constexpr int kSecondsPerDay = 24 * 60 * 60;
constexpr int kCoverLifetime = 180 * kSecondsPerDay;
constexpr int kMissingCoverLifetime = 10 * 60;

std::string freshFor(int seconds) {
    return "private, max-age=" + std::to_string(seconds);
}

constexpr char kAskEveryTime[] = "private, no-cache";

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
    return server.client().Get(path, httplib::Headers{{"If-None-Match", tag}});
}

TestServer servingPlaying(NowPlayingArtwork* playing, ArtLog* log) {
    return TestServer(servingSettings(), showing(log), nullptr, countingMint(), nullptr, playing);
}

constexpr uint32_t kOffLibraryRow = 0;
constexpr uint32_t kCoverlessRow = 1;
constexpr uint32_t kInLibraryRow = 2;
constexpr uint32_t kRowsInPlaylist = 3;

constexpr char kAbsentPlaylistId[] = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

std::string rowAddress(const std::string& playlistId, uint32_t row) {
    return "/api/artwork/playlists/" + playlistId + "/" + std::to_string(row);
}

struct RowArtLog {
    explicit RowArtLog(std::string cover) : picture(std::move(cover)) {}

    std::string picture;
    std::vector<std::pair<std::string, uint32_t>> asked;
};

// A playlist of three rows, one per answer the player has about a row it holds. The row the
// media library holds a path for carries a cover as well, so a refusal there is the path being
// refused and not a picture being missing.
PlaylistRowArtworkReader rowReader(RowArtLog* log) {
    return [log](const std::string& playlistId, uint32_t row) {
        log->asked.emplace_back(playlistId, row);

        PlaylistArtworkRead read;
        if (playlistId != kPlaylistId) {
            read.outcome = PlaylistOutcome::noSuchPlaylist;
            return read;
        }

        if (row >= kRowsInPlaylist) {
            read.outcome = PlaylistOutcome::positionPastEnd;
            return read;
        }

        if (row == kInLibraryRow)
            read.libraryPath = kTrack;

        if (row != kCoverlessRow) {
            read.source.tag = artworkTag(log->picture);
            read.source.picture = log->picture;
        }

        return read;
    };
}

Player showingRows(RowArtLog* rows, ArtLog* byTrack = nullptr) {
    Player player = byTrack ? showing(byTrack) : Player{};
    player.readPlaylistRowArtwork = rowReader(rows);
    return player;
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

// One album is one address, so the lifetime is what the route is for: a client holding the
// sleeve spends no request on it until the lifetime runs out. private is the other half, since
// an authenticated picture has no business in a cache somebody else reads.
TEST_CASE("a cover is fresh for 180 days, and in no cache but that client's") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = get(server, kAddress);

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Cache-Control") == freshFor(kCoverLifetime));
}

// An absence is the answer most likely to stop being true, and nothing tells a client it has:
// a cover dropped into the album's folder is drawn within the window, with no reload.
TEST_CASE("a cover the player does not have is asked for again ten minutes later") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));

    const auto response = get(server, "/api/artwork?track=Artist%2FAlbum%2Fgone.flac");

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(response->get_header_value("Cache-Control") == freshFor(kMissingCoverLifetime));
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
    CHECK(again->get_header_value("Cache-Control") == freshFor(kCoverLifetime));

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

// A screenful of covers is the ordinary case and must not be refused, so what this pins is
// that the ceiling exists at all and that the player stops being reached once it is met.
TEST_CASE("a client looping on artwork stops reaching the player") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));
    auto client = server.client();

    // Twice the burst, and the server's clock stands still, so the second half is all refused.
    constexpr int kAttempts = 600;
    int refused = 0;

    // Kept rather than asserted inside the loop, so how many refusals a machine's speed
    // produces cannot change how many assertions the suite runs.
    std::string retryAfter;
    std::string refusal;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = client.Get(kAddress);
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

// The budget is deep because a screenful of covers is the ordinary case, so a refusal here is a
// client stuck in a loop. The clock moves once, between two loops, and far enough to earn a cover
// back, so the second loop starts with an allowed read and then refuses again.
TEST_CASE("a burst of refused artwork reads writes one error line, and an allowed read starts a new burst") {
    ArtLog log{kJpeg};
    const TestServer server(servingSettings(), showing(&log));
    auto client = server.client();
    clearLog();

    constexpr int kAttempts = 600;
    constexpr auto kLongEnoughToEarnACover = std::chrono::seconds(1);
    std::vector<int> statuses;

    const auto loop = [&client, &statuses] {
        for (int attempt = 0; attempt < kAttempts; ++attempt) {
            const auto response = client.Get(kAddress);
            statuses.push_back(response ? response->status : 0);
        }
    };

    loop();
    server.advanceRateLimits(kLongEnoughToEarnACover);
    loop();

    const auto refused = std::count(statuses.begin(), statuses.end(), 429);
    REQUIRE(refusalBursts(statuses) == 2);
    REQUIRE(static_cast<size_t>(refused) > refusalBursts(statuses));
    CHECK(errorLinesContaining("refusing artwork reads") == 2);
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
    Settings settings = servingSettings();
    settings.allowedOrigins = {"http://localhost:5173"};
    const TestServer server(settings, showing(&log));
    const httplib::Headers origin{{"Origin", "http://localhost:5173"}};

    const auto preflight = server.client().Options("/api/artwork", origin);

    REQUIRE(preflight);
    CHECK(preflight->status == 204);
    CHECK(preflight->get_header_value("Access-Control-Allow-Headers").find("If-None-Match") !=
          std::string::npos);

    httplib::Headers headers{{"Origin", "http://localhost:5173"}};
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
        note(client.Get(kAddress));

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

// foobar2000 calls its now-playing album art notification with nothing to show, against the
// guarantee the SDK's own album_art.h makes that it never does. So an empty picture reaches this
// store, and a validator kept for one is a cover a client would be told it still holds.
TEST_CASE("an empty cover held leaves nothing to serve, the same as a cover let go") {
    NowPlayingArtwork playing;
    playing.hold(kJpeg);

    playing.hold("");
    const auto held = playing.current();

    CHECK(held.picture.empty());
    CHECK(held.tag.empty());

    playing.clear();
    const auto gone = playing.current();

    CHECK(held.picture == gone.picture);
    CHECK(held.tag == gone.tag);
}

// foobar2000's own now-playing loader takes no path, no index and no handle
// (plugins/fb2k/ARCHITECTURE.md, *Facts about the player*), and this is the whole of what
// separates this route from the one addressed by a track: a request with nothing in it is
// answered, so a stream, a CD track and a file the media library has never seen all have a
// cover. Where the picture came from, a folder beside the file or the file's own tags, is
// the player's answer and never this component's.
TEST_CASE("the cover of whatever is playing is answered to a request that addresses nothing") {
    ArtLog log{kJpeg};
    NowPlayingArtwork playing;
    playing.hold(kJpeg);
    const TestServer server(servingPlaying(&playing, &log));

    const auto response = get(server, kPlayingAddress);

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == kJpeg);
    CHECK(response->get_header_value("Content-Type") == "image/jpeg");
    CHECK(response->get_header_value("ETag") == artworkTag(kJpeg));
    CHECK(log.asked.empty());
}

TEST_CASE("a player showing no cover is refused in the words artwork already refuses with") {
    ArtLog log{kJpeg};
    NowPlayingArtwork playing;
    const TestServer server(servingPlaying(&playing, &log));

    const auto response = get(server, kPlayingAddress);

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(json::parse(response->body)["error"] == "no artwork for that track");
    CHECK(response->get_header_value("ETag").empty());
    CHECK(log.asked.empty());
}

// The same empty picture, one layer out: a validator standing for no bytes is how a route ends
// up telling a client that a cover which is not there is still good.
TEST_CASE("an empty cover held is refused rather than answered with no picture") {
    ArtLog log{kJpeg};
    NowPlayingArtwork playing;
    playing.hold(kJpeg);
    const TestServer server(servingPlaying(&playing, &log));

    const auto first = get(server, kPlayingAddress);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto tag = first->get_header_value("ETag");

    playing.hold("");

    SUBCASE("a client asking outright") {
        const auto response = get(server, kPlayingAddress);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body)["error"] == "no artwork for that track");
        CHECK(response->get_header_value("ETag").empty());
    }

    SUBCASE("a client holding the cover the empty one replaced") {
        const auto again = getHolding(server, kPlayingAddress, tag);

        REQUIRE(again);
        CHECK(again->status == 404);
        CHECK(json::parse(again->body)["error"] == "no artwork for that track");
    }

    SUBCASE("a client that would take any cover this URL has") {
        const auto again = getHolding(server, kPlayingAddress, "*");

        REQUIRE(again);
        CHECK(again->status == 404);
        CHECK(json::parse(again->body)["error"] == "no artwork for that track");
    }

    CHECK(log.asked.empty());
}

// GET /api/artwork?track= loads the cover on every request including a conditional one, and
// says so in its own description in contract/openapi.yaml. This is the route that does not:
// the picture is held, so the client that already has it costs a comparison of two strings.
TEST_CASE("a client already holding the playing cover is sent no picture and costs no file read") {
    ArtLog log{kJpeg};
    NowPlayingArtwork playing;
    playing.hold(kJpeg);
    const TestServer server(servingPlaying(&playing, &log));

    const auto first = get(server, kPlayingAddress);
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto again = getHolding(server, kPlayingAddress, first->get_header_value("ETag"));

    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
    CHECK(again->get_header_value("ETag") == artworkTag(kJpeg));
    CHECK(log.asked.empty());
}

// The address carries nothing about what is playing, so the picture behind this URL changes
// without the URL changing and a lifetime would hand a client the last album's sleeve.
TEST_CASE("the playing cover is asked about on every request, since the URL outlives the track") {
    ArtLog log{kJpeg};
    NowPlayingArtwork playing;
    playing.hold(kJpeg);
    const TestServer server(servingPlaying(&playing, &log));

    const auto first = get(server, kPlayingAddress);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    CHECK(first->get_header_value("Cache-Control") == kAskEveryTime);

    const auto again = getHolding(server, kPlayingAddress, first->get_header_value("ETag"));

    REQUIRE(again);
    REQUIRE(again->status == 304);
    CHECK(again->get_header_value("Cache-Control") == kAskEveryTime);
}

// What the validator is folded from is what decides whether a second track of one album costs
// anything: the picture, and nothing else. A validator carrying a track path, a counter or the
// time the picture arrived answers every other case here correctly and still downloads the
// same sleeve once per track.
TEST_CASE("a cover held again keeps its validator, and a different cover moves it") {
    ArtLog log{kJpeg};
    NowPlayingArtwork playing;
    playing.hold(kJpeg);
    const TestServer server(servingPlaying(&playing, &log));

    const auto first = get(server, kPlayingAddress);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto tag = first->get_header_value("ETag");

    SUBCASE("the next track of the same album") {
        playing.hold(kJpeg);

        const auto again = getHolding(server, kPlayingAddress, tag);

        REQUIRE(again);
        CHECK(again->status == 304);
        CHECK(again->body.empty());
    }

    SUBCASE("the first track of the next album") {
        playing.hold(kPng);

        const auto again = getHolding(server, kPlayingAddress, tag);

        REQUIRE(again);
        CHECK(again->status == 200);
        CHECK(again->body == kPng);
        CHECK(again->get_header_value("ETag") == artworkTag(kPng));
    }

    CHECK(log.asked.empty());
}

// The player pushes a cover only when there is one to show and says nothing about a track with
// none (plugins/fb2k/ARCHITECTURE.md, *Facts about the player*), so a held picture would answer
// for the next track indefinitely. Whatever watches playback lets it go on a track change.
TEST_CASE("a cover let go is not answered for the track that follows it") {
    ArtLog log{kJpeg};
    NowPlayingArtwork playing;
    playing.hold(kJpeg);
    const TestServer server(servingPlaying(&playing, &log));

    const auto first = get(server, kPlayingAddress);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto tag = first->get_header_value("ETag");

    playing.clear();

    SUBCASE("a client is refused in the words a player showing nothing is refused in") {
        const auto response = get(server, kPlayingAddress);

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body)["error"] == "no artwork for that track");
        CHECK(response->get_header_value("ETag").empty());
    }

    SUBCASE("a client holding the old cover is told it is gone rather than that it still stands") {
        const auto again = getHolding(server, kPlayingAddress, tag);

        REQUIRE(again);
        CHECK(again->status == 404);
        CHECK(json::parse(again->body)["error"] == "no artwork for that track");
    }

    SUBCASE("the picture goes with the validator, so there is nothing left to answer with") {
        const auto held = playing.current();

        CHECK(held.picture.empty());
        CHECK(held.tag.empty());
    }

    SUBCASE("the same cover held again validates the copy the client kept") {
        playing.hold(kJpeg);

        const auto again = getHolding(server, kPlayingAddress, tag);

        REQUIRE(again);
        CHECK(again->status == 304);
        CHECK(again->body.empty());
        CHECK(again->get_header_value("ETag") == artworkTag(kJpeg));
    }

    CHECK(log.asked.empty());
}

// A playlist row outside the media library has no path a client can address, so the client
// names the playlist and the position instead and the player resolves the handle behind them.
// Everything past that is the route addressed by a track: the same type, the same validator,
// the same conditional answer.
TEST_CASE("a row outside the media library is sent its cover, addressed by a position alone") {
    RowArtLog rows{kJpeg};
    const TestServer server(servingSettings(), showingRows(&rows));

    const auto response = get(server, rowAddress(kPlaylistId, kOffLibraryRow));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->body == kJpeg);
    CHECK(response->get_header_value("Content-Type") == "image/jpeg");
    CHECK(response->get_header_value("ETag") == artworkTag(kJpeg));

    REQUIRE(rows.asked.size() == 1);
    CHECK(rows.asked.front().first == kPlaylistId);
    CHECK(rows.asked.front().second == kOffLibraryRow);
}

TEST_CASE("a client already holding a row's cover is answered without the picture") {
    RowArtLog rows{kJpeg};
    const TestServer server(servingSettings(), showingRows(&rows));
    const auto address = rowAddress(kPlaylistId, kOffLibraryRow);

    const auto first = get(server, address);
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto again = getHolding(server, address, first->get_header_value("ETag"));

    REQUIRE(again);
    CHECK(again->status == 304);
    CHECK(again->body.empty());
    CHECK(again->get_header_value("ETag") == artworkTag(kJpeg));
}

// A row is a position in a set somebody reorders, so this URL names a different track once the
// playlist is edited, the same way the playing one does once the track changes.
TEST_CASE("a row's cover is asked about on every request, since the URL outlives the row") {
    RowArtLog rows{kJpeg};
    const TestServer server(servingSettings(), showingRows(&rows));
    const auto address = rowAddress(kPlaylistId, kOffLibraryRow);

    const auto first = get(server, address);
    REQUIRE(first);
    REQUIRE(first->status == 200);
    CHECK(first->get_header_value("Cache-Control") == kAskEveryTime);

    const auto again = getHolding(server, address, first->get_header_value("ETag"));

    REQUIRE(again);
    REQUIRE(again->status == 304);
    CHECK(again->get_header_value("Cache-Control") == kAskEveryTime);
}

// The row the media library holds a path for is the case worth reading twice: the player
// answered a picture for it and the route refuses anyway, because one album is one address
// and a position is not an address for an album.
TEST_CASE("a position with no cover of its own to send is refused, and four things are none") {
    RowArtLog rows{kJpeg};
    const TestServer server(servingSettings(), showingRows(&rows));

    std::string playlistId = kPlaylistId;
    uint32_t row = kOffLibraryRow;
    std::string refusal;

    SUBCASE("a playlist the player does not have") { playlistId = kAbsentPlaylistId; }

    SUBCASE("a position past the end of the playlist") { row = kRowsInPlaylist; }

    SUBCASE("a row the media library holds a path for") {
        row = kInLibraryRow;
        refusal = "no artwork for that track";
    }

    SUBCASE("a row whose track has no cover at all") {
        row = kCoverlessRow;
        refusal = "no artwork for that track";
    }

    const auto response = get(server, rowAddress(playlistId, row));

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(response->get_header_value("Content-Type") == "application/json");
    CHECK(response->get_header_value("ETag").empty());

    const auto body = json::parse(response->body);
    CHECK_FALSE(body["error"].get<std::string>().empty());

    // Which words the two a playlist cannot answer are refused in is the route's to pick; the
    // two the player resolved carry what an unanswerable track already carries.
    if (!refusal.empty())
        CHECK(body["error"] == refusal);

    // Only the player knows a playlist it does not have, so each of the four is a refusal it
    // was asked for rather than a request turned back at the door.
    REQUIRE(rows.asked.size() == 1);
    CHECK(rows.asked.front().first == playlistId);
    CHECK(rows.asked.front().second == row);
}

// The client's whole say in this request is a playlist and a number. A path it also knows is
// worth nothing here, and the reader addressed by a track is never reached through this route.
TEST_CASE("a path in the request buys no cover from a position") {
    ArtLog byTrack{kPng};
    RowArtLog rows{kJpeg};
    const TestServer server(servingSettings(), showingRows(&rows, &byTrack));

    SUBCASE("beside a position that has a cover, the position's is the one sent") {
        const auto response = get(server, rowAddress(kPlaylistId, kOffLibraryRow) + kTrackQuery);

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->body == kJpeg);
    }

    SUBCASE("beside a position that has none, the refusal stands") {
        const auto response = get(server, rowAddress(kPlaylistId, kCoverlessRow) + kTrackQuery);

        REQUIRE(response);
        CHECK(response->status == 404);
    }

    CHECK(rows.asked.size() == 1);
    CHECK(byTrack.asked.empty());
}

TEST_CASE("a picture a position names is bounded and typed as one a track names is") {
    SUBCASE("larger than this component sends") {
        RowArtLog rows{std::string(kMaxArtworkBytes + 1, 'x')};
        const TestServer server(servingSettings(), showingRows(&rows));

        const auto response = get(server, rowAddress(kPlaylistId, kOffLibraryRow));

        REQUIRE(response);
        CHECK(response->status == 413);
        CHECK(json::parse(response->body)["error"] ==
              "that artwork is larger than this component sends");
    }

    SUBCASE("in a format this component does not send") {
        RowArtLog rows{"a file that is not a picture"};
        const TestServer server(servingSettings(), showingRows(&rows));

        const auto response = get(server, rowAddress(kPlaylistId, kOffLibraryRow));

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body)["error"] ==
              "that artwork is not in a format this component sends");
    }
}

// One budget for every cover, so a client cannot spend twice by asking two ways. A second
// bucket would be full when the batch at the end arrives, and the shared one is empty.
TEST_CASE("a client looping on positions spends the budget a track address spends") {
    ArtLog byTrack{kJpeg};
    RowArtLog rows{kJpeg};
    const TestServer server(servingSettings(), showingRows(&rows, &byTrack));
    auto client = server.client();
    const auto address = rowAddress(kPlaylistId, kOffLibraryRow);

    constexpr int kAttempts = 600;
    int refused = 0;

    std::string retryAfter;
    std::string refusal;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = client.Get(address);
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
    CHECK(static_cast<int>(rows.asked.size()) == kAttempts - refused);

    constexpr int kThen = 10;
    int deniedByTrack = 0;

    for (int attempt = 0; attempt < kThen; ++attempt) {
        const auto response = client.Get(kAddress);
        REQUIRE(response);

        if (response->status == 429)
            deniedByTrack++;
    }

    CHECK(deniedByTrack == kThen);
}
