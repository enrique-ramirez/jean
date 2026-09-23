// GET /api/library/track over a real socket: one track's columns, addressed the way a cover is.
// library_test.cpp covers the column gate this route shares with the export, and the ordinal
// order the address resolves through.

#include "third_party/doctest.h"

#include "core/library.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <cctype>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

// What the client acts on, which is the sentence rather than the enumerator carrying it: the
// same refusal reaches a client from POST /api/tags, and that route answers out of
// TagWriteOutcome instead.
constexpr char kNamesMoreThanOneTrack[] = "more than one track";

std::optional<PlaylistOutcome> outcomeForAnAddressNamingTwoTracks() {
    for (int raw = 0;; ++raw) {
        const auto outcome = static_cast<PlaylistOutcome>(raw);
        const auto said = describe(outcome);

        if (said == "unknown")
            return std::nullopt;
        if (said.find(kNamesMoreThanOneTrack) != std::string::npos)
            return outcome;
    }
}

std::string escaped(const std::string& value) {
    static constexpr char kHex[] = "0123456789ABCDEF";

    std::string out;
    for (const unsigned char character : value) {
        if (std::isalnum(character) || character == '-' || character == '.' ||
            character == '_' || character == '~') {
            out += static_cast<char>(character);
            continue;
        }

        out += '%';
        out += kHex[character >> 4];
        out += kHex[character & 0xF];
    }

    return out;
}

std::string oneTrack(const std::string& track, const std::vector<std::string>& columns,
                     std::optional<uint32_t> subsong = std::nullopt) {
    std::string path = "/api/library/track?track=" + escaped(track);
    if (subsong)
        path += "&subsong=" + std::to_string(*subsong);

    for (const std::string& column : columns)
        path += "&columns=" + escaped(column);

    return path;
}

// The one-track read, standing in for fb2k/library.cpp: that file needs the foobar2000 SDK and
// never compiles here, so this holds a media library snapshot and evaluates the columns against
// the handle it finds, the way the player will.
struct FakeLibrary {
    struct Read {
        std::string track;
        uint32_t subsong = 0;
        std::vector<std::string> columns;
    };

    // One entry per file, holding its handles by the subsong each one is, as the snapshot's
    // relative-path map does. A subsong is a number the player gave the handle rather than a
    // position in the file: `kCueAddress` says what turns on that. Each handle carries what a
    // column evaluates to on it.
    std::map<std::string, std::map<uint32_t, std::map<std::string, std::string>>> snapshot;

    // Addresses the snapshot holds twice over, which is what two media library roots sharing
    // one library-relative path produce.
    std::set<std::string> heldTwice;

    // Every address the route handed over, held or not.
    std::vector<Read> asked;
};

constexpr char kTitle[] = "%title%";
constexpr char kRatingColumn[] = "%rating%";

FakeLibrary holding() {
    FakeLibrary library;
    library.snapshot = {{kTrackAddress, {{0, {{kTitle, "A Song"}, {kRatingColumn, kRating}}}}},
                        {kCueAddress,
                         {{1, {{kTitle, "The Overture"}}},
                          {2, {{kTitle, "The Middle"}}},
                          {3, {{kTitle, "The End"}}}}}};

    return library;
}

// The pointer must outlive the server.
Player reading(FakeLibrary* library) {
    Player player;
    player.readLibraryTrack = [library](const std::string& track, uint32_t subsong,
                                        const std::vector<std::string>& columns) {
        library->asked.push_back({track, subsong, columns});

        LibraryTrackRead read;
        if (library->heldTwice.count(track) != 0) {
            read.outcome = outcomeForAnAddressNamingTwoTracks().value();
            return read;
        }

        const auto file = library->snapshot.find(track);
        if (file == library->snapshot.end())
            return read;

        const auto found = file->second.find(subsong);
        if (found == file->second.end())
            return read;

        read.held = true;
        const auto& handle = found->second;
        for (const std::string& column : columns) {
            const auto value = handle.find(column);
            read.columns.push_back(value == handle.end() ? kUnresolved : value->second);
        }

        return read;
    };

    return player;
}

std::vector<std::string> columnsNumbering(size_t count) {
    std::vector<std::string> columns;
    for (size_t n = 0; n < count; ++n)
        columns.push_back("%column" + std::to_string(n) + "%");

    return columns;
}

}  // namespace

TEST_CASE("the columns come back in the order they were asked for, and the address does not") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    const auto response = get(server, oneTrack(kTrackAddress, {kTitle, kRatingColumn}));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body) == json{{"columns", json::array({"A Song", kRating})}});

    REQUIRE(library.asked.size() == 1);
    CHECK(library.asked[0].track == kTrackAddress);
    CHECK(library.asked[0].columns == std::vector<std::string>{kTitle, kRatingColumn});
}

TEST_CASE("each subsong of one file is read at its own handle") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    const std::map<uint32_t, std::string> inTheFile{
        {1, "The Overture"}, {2, "The Middle"}, {3, "The End"}};

    for (const auto& inside : inTheFile) {
        const uint32_t subsong = inside.first;
        const auto response = get(server, oneTrack(kCueAddress, {kTitle}, subsong));

        INFO("subsong: ", subsong);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(json::parse(response->body) == json{{"columns", json::array({inside.second})}});
        CHECK(library.asked.back().subsong == subsong);
    }

    CHECK(library.asked.size() == inTheFile.size());
}

// The default is the ordinary file's own subsong, and it is the wrong number for a cue sheet:
// `kCueAddress` says why. The read-back a timed-out write ends at asks this route, so answering
// the file's first track for the subsong nothing holds would confirm a rating that never landed.
TEST_CASE("a read naming no subsong is read as 0, which a cue sheet's file does not hold") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    // What a client sends for a file holding one track, which is nearly all of them.
    const auto ordinary = get(server, oneTrack(kTrackAddress, {kTitle}));

    REQUIRE(ordinary);
    CHECK(ordinary->status == 200);
    CHECK(json::parse(ordinary->body) == json{{"columns", json::array({"A Song"})}});
    CHECK(library.asked.back().subsong == 0);

    const auto cue = get(server, oneTrack(kCueAddress, {kTitle}));

    REQUIRE(cue);
    CHECK(cue->status == 404);
    CHECK(library.asked.back().subsong == 0);
}

// An address is a key into the snapshot rather than a path, so `..` in one is neither refused
// nor meaningful. The third spelling below names the track kTrackAddress does, and a component
// resolving it as a path would answer that track's columns.
TEST_CASE("an address the snapshot does not hold is a 404, `..` and all") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    for (const char* address : {"Someone/A Record/02 Another Song.flac", "../../etc/passwd",
                                "Someone/A Record/../A Record/01 A Song.flac"}) {
        const auto response = get(server, oneTrack(address, {kTitle}));

        INFO("address: ", address);
        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == json{{"error", "no such track"}});
    }

    // A subsong past the last one in the file. Answering the file's first track instead is
    // what a dropped subsong looks like from a client: a cue sheet whose every track rates
    // and reads back as its own album's opener.
    const auto beyond = get(server, oneTrack(kCueAddress, {kTitle}, 9));

    REQUIRE(beyond);
    CHECK(beyond->status == 404);

    // Four looked up rather than refused at the door: the snapshot decides, not the spelling.
    CHECK(library.asked.size() == 4);
}

// Two media library roots can hold one library-relative path, so an address can name a track
// under each. Answering whichever sorts first would confirm a rating that landed on the other
// copy, which is worse than answering nothing: the client asked this route precisely to find
// out what the write did.
TEST_CASE("an address held under two roots is a 409 instead of one track's columns") {
    const auto ambiguous = outcomeForAnAddressNamingTwoTracks();
    REQUIRE_MESSAGE(ambiguous, "no PlaylistOutcome says an address names more than one track");

    FakeLibrary library = holding();
    library.heldTwice = {kTrackAddress};
    const TestServer server(servingSettings(), reading(&library));

    const auto response = get(server, oneTrack(kTrackAddress, {kTitle}));

    REQUIRE(response);
    CHECK(response->status == 409);

    const auto body = json::parse(response->body);
    CHECK(body.at("error") == describe(*ambiguous));
    CHECK(body.count("columns") == 0);
}

// parseLibraryRequest is the gate GET /api/library/export puts on a declaration, reused here
// rather than restated, so a client reads the refusal it already knows from declaring a set.
TEST_CASE("a column list past the cap is refused, and the player is never asked") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    const auto atTheCap = get(server, oneTrack(kTrackAddress, columnsNumbering(kMaxColumns)));

    REQUIRE(atTheCap);
    CHECK(atTheCap->status == 200);
    CHECK(json::parse(atTheCap->body).at("columns").size() == kMaxColumns);

    const auto past = get(server, oneTrack(kTrackAddress, columnsNumbering(kMaxColumns + 1)));

    REQUIRE(past);
    CHECK(past->status == 400);
    CHECK(json::parse(past->body).at("error") == "too many columns");

    CHECK(library.asked.size() == 1);
}

// A track whose get_relative_path answered false is held under an empty address, so an empty
// one sent by a client would resolve to whichever track that is rather than to nothing.
TEST_CASE("an empty address is a 400 and is never looked up") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    const auto response = get(server, oneTrack("", {kTitle}));

    REQUIRE(response);
    CHECK(response->status == 400);
    CHECK(library.asked.empty());
}
