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
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

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

    // One entry per file, holding its subsongs in subsong order, as the snapshot's
    // relative-path map does. Each subsong carries what a column evaluates to on its own handle.
    std::map<std::string, std::vector<std::map<std::string, std::string>>> snapshot;

    // Every address the route handed over, held or not.
    std::vector<Read> asked;
};

constexpr char kTitle[] = "%title%";
constexpr char kRatingColumn[] = "%rating%";
constexpr char kDiscAddress[] = "Someone/A Record/disc.flac";

FakeLibrary holding() {
    FakeLibrary library;
    library.snapshot = {{kTrackAddress, {{{kTitle, "A Song"}, {kRatingColumn, kRating}}}},
                        {kDiscAddress,
                         {{{kTitle, "The Overture"}},
                          {{kTitle, "The Middle"}},
                          {{kTitle, "The End"}}}}};

    return library;
}

// The pointer must outlive the server.
Player reading(FakeLibrary* library) {
    Player player;
    player.readLibraryTrack = [library](const std::string& track, uint32_t subsong,
                                        const std::vector<std::string>& columns) {
        library->asked.push_back({track, subsong, columns});

        LibraryTrackRead read;
        const auto file = library->snapshot.find(track);
        if (file == library->snapshot.end() || subsong >= file->second.size())
            return read;

        read.held = true;
        const auto& handle = file->second.at(subsong);
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

    const std::vector<std::string> inTheFile{"The Overture", "The Middle", "The End"};

    for (uint32_t subsong = 0; subsong < static_cast<uint32_t>(inTheFile.size()); ++subsong) {
        const auto response = get(server, oneTrack(kDiscAddress, {kTitle}, subsong));

        INFO("subsong: ", subsong);
        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(json::parse(response->body) ==
              json{{"columns", json::array({inTheFile.at(subsong)})}});
        CHECK(library.asked.back().subsong == subsong);
    }

    // What a client sends for a file holding one track, which is nearly all of them.
    const auto omitted = get(server, oneTrack(kDiscAddress, {kTitle}));

    REQUIRE(omitted);
    CHECK(json::parse(omitted->body) == json{{"columns", json::array({inTheFile.front()})}});
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
    const auto beyond = get(server, oneTrack(kDiscAddress, {kTitle}, 9));

    REQUIRE(beyond);
    CHECK(beyond->status == 404);

    // Four looked up rather than refused at the door: the snapshot decides, not the spelling.
    CHECK(library.asked.size() == 4);
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
