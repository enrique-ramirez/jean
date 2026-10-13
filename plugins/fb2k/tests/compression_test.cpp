#include "third_party/doctest.h"

#include "support/http.h"
#include "support/streams.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr int kPlaylistCount = 200;

Player listingManyPlaylists() {
    std::vector<PlaylistAnnotation> playlists;

    for (int i = 0; i < kPlaylistCount; ++i) {
        PlaylistAnnotation playlist;
        playlist.id = kPlaylistId;
        playlist.index = i;
        playlist.title = "#Jean Folder " + std::to_string(i);
        playlists.push_back(playlist);
    }

    return TestServer::listing(
        [playlists] { return PlaylistsResult{PlayerOutcome::done, playlists}; });
}

constexpr size_t kPages = 40;
constexpr char kPage[] = "an ogg page, and the next one looks a great deal like it. ";

std::string wholeStream() {
    std::string all;
    for (size_t i = 0; i < kPages; ++i)
        all += kPage;
    return all;
}

}  // namespace

TEST_CASE("a client that accepts gzip is answered with less than it would have had") {
    const TestServer server(servingSettings(), listingManyPlaylists());

    const auto plain = undecoding(server).Get("/api/playlists", accepting("identity"));
    const auto gzipped = undecoding(server).Get("/api/playlists", accepting("gzip"));

    REQUIRE(plain);
    REQUIRE(gzipped);
    CHECK(gzipped->status == 200);
    CHECK(gzipped->get_header_value("Content-Encoding") == "gzip");
    CHECK(isGzip(gzipped->body));
    CHECK(gzipped->body.size() < plain->body.size());
}

TEST_CASE("a client that does not accept gzip gets the bytes as they were") {
    const TestServer server(servingSettings(), listingManyPlaylists());

    const auto response = undecoding(server).Get("/api/playlists", accepting("identity"));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Encoding").empty());
    CHECK(json::parse(response->body)["playlists"].size() == kPlaylistCount);
}

TEST_CASE("the gzipped answer decodes back to the bytes the plain one gave") {
    const TestServer server(servingSettings(), listingManyPlaylists());

    const auto plain = undecoding(server).Get("/api/playlists", accepting("identity"));
    const auto decoded = server.client().Get("/api/playlists", accepting("gzip"));

    REQUIRE(plain);
    REQUIRE(decoded);
    REQUIRE(decoded->get_header_value("Content-Encoding") == "gzip");
    CHECK(decoded->body == plain->body);
}

// cpp-httplib's content-type gate is the only thing leaving this body alone;
// third_party/README.md has why, and why an upgrade could land on this case.
TEST_CASE("the audio stream is never compressed, however the listener asks") {
    const TestServer server(
        servingSettings(),
        TestServer::streaming(opensWith(std::vector<std::string>(kPages, kPage))));

    const auto response =
        undecoding(server).Get("/api/stream?ticket=" + ticketFrom(server), accepting("gzip"));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Encoding").empty());
    CHECK_FALSE(isGzip(response->body));
    CHECK(response->body == wholeStream());
}
