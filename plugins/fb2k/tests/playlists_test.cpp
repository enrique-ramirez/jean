// The decisions taken before foobar2000 is involved. playlist_route_test.cpp covers what a
// client sees over a socket.

#include "third_party/doctest.h"

#include "core/playlists.h"
#include "third_party/json.hpp"

#include <string>
#include <vector>

using namespace jean;
using nlohmann::json;

namespace {

AutoPlaylistRequest creating(const std::string& body) {
    return parseAutoPlaylist(body, Need::required);
}

AutoPlaylistRequest updating(const std::string& body) {
    return parseAutoPlaylist(body, Need::optional);
}

constexpr char kRock[] = R"({"title": "#Jean Rock", "query": "%genre% IS Rock"})";

PlaylistAnnotation managed(std::string id, std::string key) {
    PlaylistAnnotation playlist;
    playlist.id = std::move(id);

    AutoPlaylistSpec spec;
    spec.key = std::move(key);
    playlist.managed = std::move(spec);

    return playlist;
}

PlaylistAnnotation theirs(std::string id) {
    PlaylistAnnotation playlist;
    playlist.id = std::move(id);
    return playlist;
}

}  // namespace

TEST_CASE("a well-formed request is taken apart into its pieces") {
    const auto request = creating(R"({
        "title": "#Jean Rock",
        "key": "folder:genre:Rock",
        "query": "%genre% IS Rock",
        "sort": "%album artist%",
        "forceSort": true
    })");

    REQUIRE(request.ok());
    CHECK(request.spec.title == "#Jean Rock");
    CHECK(request.spec.key == "folder:genre:Rock");
    CHECK(request.spec.query == "%genre% IS Rock");
    CHECK(request.spec.sort == "%album artist%");
    CHECK(request.spec.forceSort);
}

TEST_CASE("only a title and a query are required") {
    const auto request = creating(kRock);

    REQUIRE(request.ok());
    CHECK(request.spec.key.empty());
    CHECK(request.spec.sort.empty());
    CHECK_FALSE(request.spec.forceSort);
}

TEST_CASE("a malformed body is refused rather than guessed at") {
    for (const char* body : {"not json", "[1,2,3]", "\"a string\"", "12"}) {
        INFO("body: ", body);
        const auto request = creating(body);
        CHECK_FALSE(request.ok());
        CHECK(request.refusal == PlaylistRefusal::malformedBody);
    }
}

TEST_CASE("a title is required when creating and optional when updating") {
    CHECK_FALSE(creating(R"({"query": "%genre% IS Rock"})").ok());

    // Absent means "do not rename", not "rename to whatever the client last saw".
    const auto update = updating(R"({"query": "%genre% IS Jazz"})");
    REQUIRE(update.ok());
    CHECK(update.spec.title.empty());
}

TEST_CASE("a query is required either way") {
    CHECK_FALSE(creating(R"({"title": "#Jean Rock"})").ok());
    CHECK_FALSE(updating(R"({"title": "#Jean Rock"})").ok());
    CHECK(creating(R"({"title": "x", "query": ""})").refusal == PlaylistRefusal::badQuery);
}

// A NUL truncates a title somewhere inside the SDK rather than here.
TEST_CASE("control characters are refused wherever they appear") {
    CHECK(creating("{\"title\": \"two\\nlines\", \"query\": \"a\"}").refusal ==
          PlaylistRefusal::badTitle);
    CHECK(creating("{\"title\": \"x\", \"query\": \"a\\u0000b\"}").refusal ==
          PlaylistRefusal::badQuery);
    CHECK(creating("{\"title\": \"x\", \"query\": \"a\", \"key\": \"k\\ty\"}").refusal ==
          PlaylistRefusal::badKey);
    CHECK(creating("{\"title\": \"x\", \"query\": \"a\", \"sort\": \"s\\rt\"}").refusal ==
          PlaylistRefusal::badSort);
}

TEST_CASE("each field is refused by name, so a client can say which control to fix") {
    CHECK(creating(R"({"title": 42, "query": "a"})").refusal == PlaylistRefusal::badTitle);
    CHECK(creating(R"({"title": "x", "query": 42})").refusal == PlaylistRefusal::badQuery);
    CHECK(creating(R"({"title": "x", "query": "a", "sort": 42})").refusal ==
          PlaylistRefusal::badSort);
    CHECK(creating(R"({"title": "x", "query": "a", "key": 42})").refusal ==
          PlaylistRefusal::badKey);
    CHECK(creating(R"({"title": "x", "query": "a", "forceSort": "yes"})").refusal ==
          PlaylistRefusal::malformedBody);
}

TEST_CASE("nothing unbounded reaches the player") {
    const auto tooLong = [](size_t length) { return std::string(length, 'x'); };

    CHECK_FALSE(creating(R"({"title": ")" + tooLong(257) + R"(", "query": "a"})").ok());
    CHECK_FALSE(creating(R"({"title": "x", "query": ")" + tooLong(4097) + R"("})").ok());
    CHECK_FALSE(creating(R"({"title": "x", "query": "a", "key": ")" + tooLong(257) + R"("})").ok());
}

TEST_CASE("previewing takes a query and nothing else") {
    const auto request = parseQueryPreview(R"({"query": "%genre% IS Rock"})");
    REQUIRE(request.ok());
    CHECK(request.spec.query == "%genre% IS Rock");

    // An empty query matches everything in foobar2000, which is a confusing thing to
    // answer to a box nobody has typed in yet.
    CHECK_FALSE(parseQueryPreview(R"({"query": ""})").ok());
    CHECK_FALSE(parseQueryPreview("{}").ok());
    CHECK_FALSE(parseQueryPreview("not json").ok());
}

TEST_CASE("a playlist id is the lower-case dashed form and nothing else") {
    CHECK(isPlaylistId("45837d74-fa4f-415c-bba9-bf2db8f0dc04"));

    // Upper case is what a person is likeliest to paste, and it is still refused: one
    // spelling, so that two ids are equal exactly when their strings are.
    CHECK_FALSE(isPlaylistId("45837D74-FA4F-415C-BBA9-BF2DB8F0DC04"));

    CHECK_FALSE(isPlaylistId("{45837d74-fa4f-415c-bba9-bf2db8f0dc04}"));
    CHECK_FALSE(isPlaylistId("45837d74fa4f415cbba9bf2db8f0dc04"));
    CHECK_FALSE(isPlaylistId("45837d74-fa4f-415c-bba9-bf2db8f0dc0"));
    CHECK_FALSE(isPlaylistId("45837g74-fa4f-415c-bba9-bf2db8f0dc04"));
    CHECK_FALSE(isPlaylistId("------------------------------------"));
    CHECK_FALSE(isPlaylistId(""));
}

TEST_CASE("a stored record survives the round trip") {
    AutoPlaylistSpec spec;
    spec.title = "#Jean Rock";
    spec.key = "folder:genre:Rock";
    spec.query = "%genre% IS Rock";
    spec.sort = "%album artist%";
    spec.forceSort = true;

    const auto restored = parseStoredAutoPlaylist(serialiseAutoPlaylist(spec));

    CHECK(restored.key == spec.key);
    CHECK(restored.query == spec.query);
    CHECK(restored.sort == spec.sort);
    CHECK(restored.forceSort == spec.forceSort);

    // Not the title: foobar2000 owns that, so a copy here could only ever go stale.
    CHECK(restored.title.empty());
    const auto stored = json::parse(serialiseAutoPlaylist(spec));
    CHECK(stored.find("title") == stored.end());
}

// A record written by a later version must not stop this one reading what it understands.
TEST_CASE("an unreadable stored record degrades rather than throwing") {
    CHECK(parseStoredAutoPlaylist("").query.empty());
    CHECK(parseStoredAutoPlaylist("not json").query.empty());
    CHECK(parseStoredAutoPlaylist("[1,2,3]").query.empty());
    CHECK(parseStoredAutoPlaylist(R"({"query": 42})").query.empty());

    const auto partial = parseStoredAutoPlaylist(R"({"query": "%genre% IS Rock", "future": 1})");
    CHECK(partial.query == "%genre% IS Rock");
    CHECK_FALSE(partial.forceSort);
}

TEST_CASE("a beefweb id is 'p' and digits, and anything else is reported absent") {
    CHECK(looksLikeBeefwebId("p1"));
    CHECK(looksLikeBeefwebId("p4294967295"));

    // Written by something other than the beefweb this reads. Passing it on would let a
    // client join the two APIs on a value neither of them means.
    CHECK_FALSE(looksLikeBeefwebId("1"));
    CHECK_FALSE(looksLikeBeefwebId("p1a"));
    CHECK_FALSE(looksLikeBeefwebId("P1"));
    CHECK_FALSE(looksLikeBeefwebId(""));
    CHECK_FALSE(looksLikeBeefwebId("p" + std::string(32, '1')));
}

TEST_CASE("a key is taken only by another playlist this component created") {
    const std::vector<PlaylistAnnotation> playlists{managed("id-1", "folder:genre:Rock"),
                                                    theirs("id-2")};

    CHECK(keyTaken(playlists, "folder:genre:Rock", {}));

    // The playlist being updated cannot collide with itself.
    CHECK_FALSE(keyTaken(playlists, "folder:genre:Rock", "id-1"));

    CHECK_FALSE(keyTaken(playlists, "folder:genre:Jazz", {}));

    // An empty key is how a client says it does not use keys, so it is never taken.
    CHECK_FALSE(keyTaken(playlists, "", {}));
    CHECK_FALSE(keyTaken({managed("id-1", "")}, "", {}));
}

TEST_CASE("the autoplaylist limit counts only the playlists this component created") {
    const std::vector<PlaylistAnnotation> one{managed("id-1", "a"), theirs("id-2"), theirs("id-3")};

    CHECK(roomForAnotherAutoPlaylist(one, 2).outcome == PlaylistOutcome::done);

    const auto full = roomForAnotherAutoPlaylist(one, 1);
    CHECK(full.outcome == PlaylistOutcome::tooMany);

    CHECK(full.detail == "this install allows 1 and already has 1");

    // Zero is how an install turns creation off, the same shape as an empty allowedFields
    // turning writes off.
    CHECK(roomForAnotherAutoPlaylist({}, 0).outcome == PlaylistOutcome::tooMany);
    CHECK(roomForAnotherAutoPlaylist({}, 1).outcome == PlaylistOutcome::done);
}
