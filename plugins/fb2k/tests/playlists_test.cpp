// The decisions taken before foobar2000 is involved. playlist_route_test.cpp covers what a
// client sees over a socket.

#include "third_party/doctest.h"

#include "core/api.h"
#include "core/player_state.h"
#include "core/playlists.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <utility>
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

using Ordinals = std::vector<uint32_t>;

// The library contract/openapi.yaml writes its worked example against, and the generation
// that example resolves the set to.
constexpr size_t kTracks = 16;
constexpr uint64_t kStructure = 41;

constexpr size_t kShortLibrary = 12;

std::string base64(const std::vector<uint8_t>& bytes) {
    constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string text;
    for (size_t at = 0; at < bytes.size(); at += 3) {
        const size_t have = bytes.size() - at < 3 ? bytes.size() - at : 3;

        uint32_t group = 0;
        for (size_t part = 0; part < have; ++part)
            group |= uint32_t{bytes[at + part]} << (16 - 8 * part);

        for (size_t part = 0; part < have + 1; ++part)
            text += kAlphabet[(group >> (18 - 6 * part)) & 0x3F];

        text.append(3 - have, '=');
    }

    return text;
}

// One bit per library ordinal, least significant bit first, over exactly the bytes a library
// that size takes: what ui/test/unit/encodeFill.test.ts encodes and what this decodes.
std::string bitsetOf(const Ordinals& ordinals, size_t trackCount) {
    std::vector<uint8_t> bytes((trackCount + 7) / 8, 0);

    for (const uint32_t ordinal : ordinals) {
        REQUIRE(ordinal / 8 < bytes.size());
        bytes[ordinal / 8] |= static_cast<uint8_t>(1u << (ordinal % 8));
    }

    return base64(bytes);
}

// The foobar2000 SDK's pfc_infinite is ~0, which is this once it meets a size_t.
constexpr size_t kInfinite = std::numeric_limits<size_t>::max();

const std::vector<std::string> kPlaylistGuids{"45837d74-fa4f-415c-bba9-bf2db8f0dc04",
                                              "9b1c2e30-7d4a-4f6e-8a21-3c5d6e7f8091",
                                              "e2f4a6b8-1c3d-4e5f-9a7b-0c1d2e3f4a5b"};

FillRequest filling(const std::string& form, size_t trackCount = kTracks) {
    return parseFill(R"({"structure": )" + std::to_string(kStructure) + ", " + form + "}",
                     trackCount, std::nullopt);
}

constexpr uint32_t kRowCeiling = 1500000;

std::string runsOf(uint64_t start, uint64_t count) {
    return R"("runs": [[)" + std::to_string(start) + ", " + std::to_string(count) + "]]";
}

RemoveRowsRequest removing(const std::string& form) {
    return parseRemoveRows(R"({"structure": "7", )" + form + "}");
}

SourceRowsRequest copying(const std::string& form) {
    return parseSourceRows(R"({"source": ")" + kPlaylistGuids[0] + R"(", )" + form + "}");
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

TEST_CASE("one set sent as runs, as a bitset and as a plain list names the same rows") {
    // contract/openapi.yaml's worked example: ordinals 0, 1 and 9 of a 16-track library.
    CHECK(bitsetOf({0, 1, 9}, kTracks) == "AwI=");

    for (const std::string& form :
         {R"("runs": [[0, 2], [9, 1]])", R"("bitset": "AwI=")", R"("ordinals": [0, 1, 9])"}) {
        INFO("form: ", form);
        const auto request = filling(form);

        REQUIRE(request.ok());
        CHECK(request.ordinals == Ordinals{0, 1, 9});
        CHECK(request.structure == kStructure);
    }
}

TEST_CASE("only a plain list carries an order, and the other two forms come back ascending") {
    // A queue is click-ordered, and a caller that chose runs or a bitset for one would have
    // it reordered with nothing to say so.
    CHECK(filling(R"("ordinals": [9, 0, 1])").ordinals == Ordinals{9, 0, 1});

    CHECK(filling(R"("runs": [[9, 1], [0, 2]])").ordinals == Ordinals{0, 1, 9});
    CHECK(filling(R"("bitset": "AwI=")").ordinals == Ordinals{0, 1, 9});

    // Queueing one track twice is something a person does on purpose, and a plain list is
    // the only form that can say it.
    CHECK(filling(R"("ordinals": [4, 4])").ordinals == Ordinals{4, 4});
}

TEST_CASE("a body names exactly one of the three forms, so two is refused and so is none") {
    for (const std::string& forms :
         {R"("runs": [[0, 2]], "bitset": "AwI=")", R"("runs": [[0, 2]], "ordinals": [0, 1])",
          R"("bitset": "AwI=", "ordinals": [0, 1])",
          R"("runs": [[0, 2]], "bitset": "AwI=", "ordinals": [0, 1])"}) {
        INFO("forms: ", forms);
        const auto request = filling(forms);

        CHECK_FALSE(request.ok());
        CHECK(describe(request.refusal) == "unacceptable ordinal set");
        CHECK(httpStatusFor(request.refusal) == 400);
        CHECK(request.ordinals.empty());
    }

    // A body naming no set at all is the same refusal: a fill that would insert nothing is a
    // caller's mistake rather than a request to honour.
    const auto silent = parseFill(R"({"structure": 41})", kTracks, std::nullopt);
    CHECK_FALSE(silent.ok());
    CHECK(describe(silent.refusal) == "unacceptable ordinal set");
    CHECK(httpStatusFor(silent.refusal) == 400);
}

TEST_CASE("a body that is not JSON is a malformed body rather than a bad ordinal set") {
    // Two refusals a client switches on, and contract/openapi.yaml keeps them apart: a body the
    // parser could not read, and a set it read and would not take. One string for both would
    // send a caller looking at ordinals it never managed to send.
    for (const std::string& body : {"not json", "[0, 1, 9]", R"("a string")"}) {
        INFO("body: ", body);
        const auto request = parseFill(body, kTracks, std::nullopt);

        CHECK_FALSE(request.ok());
        CHECK(describe(request.refusal) == "malformed request");
    }
}

TEST_CASE("an ordinal past the end of the library is refused rather than dropped") {
    CHECK(filling(R"("ordinals": [11])", kShortLibrary).ordinals == Ordinals{11});
    CHECK(filling(R"("runs": [[10, 2]])", kShortLibrary).ordinals == Ordinals{10, 11});
    CHECK(filling(R"("bitset": ")" + bitsetOf({11}, kShortLibrary) + R"(")", kShortLibrary)
              .ordinals == Ordinals{11});

    for (const std::string& form :
         {std::string(R"("ordinals": [12])"), std::string(R"("runs": [[10, 3]])"),
          R"("bitset": ")" + bitsetOf({12}, kShortLibrary) + R"(")"}) {
        INFO("form: ", form);
        const auto request = filling(form, kShortLibrary);

        CHECK_FALSE(request.ok());
        CHECK(describe(request.refusal) == "unacceptable ordinal set");
        CHECK(httpStatusFor(request.refusal) == 400);
        CHECK(request.ordinals.empty());
    }
}

TEST_CASE("runs resolving to more rows than the library holds are refused") {
    // Runs are the one form whose wire cost and resolved cost come apart: overlapping pairs
    // cost eight bytes each and resolve to a whole library each, and about 20,000 of them fit
    // inside kMaxBodyBytes.
    for (const std::string& form :
         {R"("runs": [[0, 12], [0, 1]])", R"("runs": [[0, 12], [0, 12], [0, 12]])"}) {
        INFO("form: ", form);
        const auto request = filling(form, kShortLibrary);

        CHECK_FALSE(request.ok());
        CHECK(describe(request.refusal) == "unacceptable ordinal set");
        CHECK(httpStatusFor(request.refusal) == 400);
        CHECK(request.ordinals.empty());
    }
}

TEST_CASE("runs covering exactly the whole library are taken, as one run or as several") {
    // Playing everything is the commonest fill there is, and a total that reaches the
    // library's size has not passed it.
    const auto whole = filling(R"("runs": [[0, 12]])", kShortLibrary);
    REQUIRE(whole.ok());
    CHECK(whole.ordinals == Ordinals{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11});

    const auto halves = filling(R"("runs": [[6, 6], [0, 6]])", kShortLibrary);
    REQUIRE(halves.ok());
    CHECK(halves.ordinals == whole.ordinals);
}

TEST_CASE("a plain list may name more rows than the library holds, since a repeat is meant") {
    const auto queued =
        filling(R"("ordinals": [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])", kShortLibrary);

    REQUIRE(queued.ok());
    CHECK(queued.ordinals == Ordinals(13, 4));
}

TEST_CASE("runs resolving past the row ceiling are refused on a removal and on a copy") {
    // The empty set below pins the refusal's own contract, not the order decodeSelection
    // works in: every refusal path returns a fresh, empty result regardless of when it is
    // reached. What actually keeps this refusal cheap is decodeSelection's own shape; see
    // the comment on its sum loop.
    for (const std::string& form :
         {runsOf(0, uint64_t{kRowCeiling} + 1),
          R"("runs": [[0, )" + std::to_string(kRowCeiling) + R"(], [0, 1]])"}) {
        INFO("form: ", form);

        const auto removal = removing(form);
        CHECK_FALSE(removal.ok());
        CHECK(describe(removal.refusal) == "unacceptable ordinal set");
        CHECK(httpStatusFor(removal.refusal) == 400);
        CHECK(removal.ordinals.empty());

        const auto copy = copying(form);
        CHECK_FALSE(copy.ok());
        CHECK(describe(copy.refusal) == "unacceptable ordinal set");
        CHECK(httpStatusFor(copy.refusal) == 400);
        CHECK(copy.positions.empty());
    }
}

TEST_CASE("a selection reaching the row ceiling exactly is still taken") {
    // Selecting a whole playlist is the commonest edit there is, so a ceiling tightened by one
    // row refuses real work.
    const auto whole = runsOf(0, kRowCeiling);

    const auto removal = removing(whole);
    REQUIRE(removal.ok());
    CHECK(removal.ordinals.size() == kRowCeiling);
    CHECK(removal.ordinals.back() == kRowCeiling - 1);

    const auto copy = copying(whole);
    REQUIRE(copy.ok());
    CHECK(copy.positions.size() == kRowCeiling);
    CHECK(copy.positions.back() == kRowCeiling - 1);
}

TEST_CASE("a playlist position past the row ceiling is refused rather than dropped") {
    CHECK(removing(runsOf(kRowCeiling - 1, 1)).ordinals == Ordinals{kRowCeiling - 1});
    CHECK(copying(runsOf(kRowCeiling - 1, 1)).positions == Ordinals{kRowCeiling - 1});

    const auto removal = removing(runsOf(kRowCeiling, 1));
    CHECK_FALSE(removal.ok());
    CHECK(describe(removal.refusal) == "unacceptable ordinal set");
    CHECK(httpStatusFor(removal.refusal) == 400);
    CHECK(removal.ordinals.empty());

    const auto copy = copying(runsOf(kRowCeiling, 1));
    CHECK_FALSE(copy.ok());
    CHECK(describe(copy.refusal) == "unacceptable ordinal set");
    CHECK(httpStatusFor(copy.refusal) == 400);
    CHECK(copy.positions.empty());

    const auto listed = removing(R"("ordinals": [)" + std::to_string(kRowCeiling) + "]");
    CHECK_FALSE(listed.ok());
    CHECK(listed.ordinals.empty());
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

TEST_CASE("a queued position is answered as the playlist's GUID and the row") {
    std::vector<size_t> askedFor;
    const auto guidAt = [&askedFor](size_t index) {
        askedFor.push_back(index);
        return kPlaylistGuids.at(index);
    };

    const auto location = queuedLocation(2, 17, guidAt);

    REQUIRE(location.has_value());
    CHECK(location->playlistId == kPlaylistGuids[2]);
    CHECK(location->index == 17);
    CHECK(askedFor == std::vector<size_t>{2});
}

// The infinite sentinel is a real value foobar2000 produces, not a hypothetical one: see
// ARCHITECTURE.md, *Facts about the player*.
TEST_CASE("a stale queued position is answered as no position, and no playlist is looked up") {
    const std::vector<std::pair<size_t, size_t>> stale{
        {kInfinite, 17}, {2, kInfinite}, {kInfinite, kInfinite}};

    for (const auto& position : stale) {
        const size_t playlist = position.first;
        const size_t item = position.second;
        INFO("playlist: ", playlist, ", item: ", item);

        size_t lookups = 0;
        const auto guidAt = [&lookups](size_t index) {
            ++lookups;
            return kPlaylistGuids.at(index);
        };

        CHECK_FALSE(queuedLocation(playlist, item, guidAt).has_value());
        CHECK(lookups == 0);
    }
}
