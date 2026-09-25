// GET /api/track/library and GET /api/track/playing over a real socket: one track's columns,
// addressed the way a cover is or addressed by nothing. library_test.cpp covers the column gate
// both routes share with the export, and the ordinal order the library address resolves through.

#include "third_party/doctest.h"

#include "core/library.h"
#include "core/player_state.h"
#include "core/tag_write.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <cctype>
#include <chrono>
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
    std::string path = "/api/track/library?track=" + escaped(track);
    if (subsong)
        path += "&subsong=" + std::to_string(*subsong);

    for (const std::string& column : columns)
        path += "&columns=" + escaped(column);

    return path;
}

// The one-track read, standing in for fb2k/library.cpp: that file needs the foobar2000 SDK and
// never compiles here, so this holds a media library snapshot and evaluates the columns against
// the handle it finds, the way the player will. An ordinal is resolved against the same
// snapshot in ordinal order, as fb2k/library.cpp's resolveOrdinals does, so a case here witnesses
// the route handing the pair over and the outcome coming back, and no more: the component's own
// generation and range checks are reviewed rather than tested.
struct FakeLibrary {
    struct Read {
        std::string track;
        uint32_t subsong = 0;
        std::optional<OrdinalTrackRef> ordinal;
        std::vector<std::string> columns;
    };

    struct Handle {
        std::string track;
        uint32_t subsong = 0;
    };

    // One entry per file, holding its handles by the subsong each one is, as the snapshot's
    // relative-path map does. A subsong is a number the player gave the handle rather than a
    // position in the file: `kCueAddress` says what turns on that. Each handle carries what a
    // column evaluates to on it.
    std::map<std::string, std::map<uint32_t, std::map<std::string, std::string>>> snapshot;

    // Addresses the snapshot holds twice over, which is what two media library roots sharing
    // one library-relative path produce.
    std::set<std::string> heldTwice;

    // The snapshot's handles by ordinal, and the structure generation that order was built at.
    std::vector<Handle> inOrdinalOrder;
    uint64_t structure = 0;

    // Every address the route handed over, held or not.
    std::vector<Read> asked;

    LibraryTrackRead readAt(const std::string& track, uint32_t subsong,
                            const std::vector<std::string>& columns) const {
        LibraryTrackRead read;

        const auto file = snapshot.find(track);
        if (file == snapshot.end())
            return read;

        const auto found = file->second.find(subsong);
        if (found == file->second.end())
            return read;

        read.held = true;
        for (const std::string& column : columns) {
            const auto value = found->second.find(column);
            read.columns.push_back(value == found->second.end() ? kUnresolved : value->second);
        }

        return read;
    }
};

constexpr char kTitle[] = "%title%";
constexpr char kRatingColumn[] = "%rating%";
constexpr uint64_t kLibraryStructure = 12;

FakeLibrary holding() {
    FakeLibrary library;
    library.snapshot = {{kTrackAddress, {{0, {{kTitle, "A Song"}, {kRatingColumn, kRating}}}}},
                        {kCueAddress,
                         {{1, {{kTitle, "The Overture"}}},
                          {2, {{kTitle, "The Middle"}}},
                          {3, {{kTitle, "The End"}}}}}};
    library.inOrdinalOrder = {
        {kCueAddress, 1}, {kCueAddress, 2}, {kCueAddress, 3}, {kTrackAddress, 0}};
    library.structure = kLibraryStructure;

    return library;
}

// The pointer must outlive the server.
Player reading(FakeLibrary* library) {
    Player player;
    player.readLibraryTrack = [library](const std::string& track, uint32_t subsong,
                                        const std::vector<std::string>& columns) {
        library->asked.push_back({track, subsong, std::nullopt, columns});

        LibraryTrackRead read;
        if (library->heldTwice.count(track) != 0) {
            read.outcome = outcomeForAnAddressNamingTwoTracks().value();
            return read;
        }

        return library->readAt(track, subsong, columns);
    };

    player.readLibraryOrdinal = [library](const OrdinalTrackRef& at,
                                          const std::vector<std::string>& columns) {
        library->asked.push_back({{}, 0, at, columns});

        LibraryTrackRead read;
        if (at.structure != library->structure) {
            read.outcome = PlaylistOutcome::structureMoved;
            return read;
        }

        if (at.ordinal >= library->inOrdinalOrder.size())
            return read;

        const auto& handle = library->inOrdinalOrder[at.ordinal];
        return library->readAt(handle.track, handle.subsong, columns);
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

namespace {

std::string atOrdinal(const std::string& pair, const std::vector<std::string>& columns) {
    std::string path = "/api/track/library?" + pair;
    for (const std::string& column : columns)
        path += "&columns=" + escaped(column);

    return path;
}

std::string atOrdinal(uint32_t ordinal, uint64_t structure,
                      const std::vector<std::string>& columns) {
    return atOrdinal(
        "ordinal=" + std::to_string(ordinal) + "&structure=" + std::to_string(structure), columns);
}

}  // namespace

// The read-back a timed-out write ends at, for the write that was retried by ordinal because its
// path named two tracks. Asking again by that path can only be refused, so the ordinal is the one
// address that reads the copy the rating landed on.
TEST_CASE("an ordinal against the current structure answers the columns of the track at it") {
    FakeLibrary library = holding();
    library.heldTwice = {kTrackAddress};
    const TestServer server(servingSettings(), reading(&library));

    const auto song = get(server, atOrdinal(3, kLibraryStructure, {kTitle, kRatingColumn}));

    REQUIRE(song);
    CHECK(song->status == 200);
    CHECK(json::parse(song->body) == json{{"columns", json::array({"A Song", kRating})}});

    REQUIRE(library.asked.size() == 1);
    REQUIRE(library.asked[0].ordinal);
    CHECK(library.asked[0].ordinal->ordinal == 3);
    CHECK(library.asked[0].ordinal->structure == kLibraryStructure);
    CHECK(library.asked[0].track.empty());
    CHECK(library.asked[0].columns == std::vector<std::string>{kTitle, kRatingColumn});

    // Three subsongs of one file, each its own ordinal: no subsong is sent, because an ordinal
    // names one already.
    const auto middle = get(server, atOrdinal(1, kLibraryStructure, {kTitle}));

    REQUIRE(middle);
    CHECK(middle->status == 200);
    CHECK(json::parse(middle->body) == json{{"columns", json::array({"The Middle"})}});
}

// A route that took the first form it found would answer one of the two tracks and let the
// client believe it asked about the other.
TEST_CASE("a read naming both a track and an ordinal is a 400, and the player is never asked") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    const auto response = get(
        server, atOrdinal("track=" + escaped(kTrackAddress) + "&ordinal=3&structure=" +
                              std::to_string(kLibraryStructure),
                          {kTitle}));

    REQUIRE(response);
    CHECK(response->status == 400);
    CHECK(json::parse(response->body).count("columns") == 0);
    CHECK(library.asked.empty());
}

// The pair parses the way POST /api/tags parses it: an ordinal means nothing without the
// generation it was counted at, and a generation alone names no track.
TEST_CASE("a read naming no address, or half of the ordinal pair, is a 400 and is never looked up") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    const std::map<std::string, std::string> refused{
        {"neither a track nor an ordinal", ""},
        {"an ordinal with no structure", "ordinal=3"},
        {"a structure with no ordinal", "structure=12"},
        {"an ordinal that is not a number", "ordinal=three&structure=12"},
        {"a negative ordinal", "ordinal=-1&structure=12"},
        {"an ordinal past what 32 bits hold", "ordinal=4294967296&structure=12"},
        {"a structure that is not a number", "ordinal=3&structure=twelve"},
    };

    for (const auto& asked : refused) {
        INFO("case: ", asked.first);

        const auto response = get(server, atOrdinal(asked.second, {kTitle}));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body).count("columns") == 0);
    }

    CHECK(library.asked.empty());
}

// Ordinals shift whenever a track is added or removed anywhere, so the track at an ordinal under
// an older generation is whichever one moved into that place.
TEST_CASE("an ordinal counted against a structure the library has moved past is a 409") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    for (const uint64_t stale : {kLibraryStructure - 1, kLibraryStructure + 1}) {
        INFO("structure: ", stale);

        const auto response = get(server, atOrdinal(3, stale, {kTitle}));

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body).count("columns") == 0);
    }
}

TEST_CASE("an ordinal past the last track is the 404 an unknown address gets") {
    FakeLibrary library = holding();
    const TestServer server(servingSettings(), reading(&library));

    const auto unknown = get(server, oneTrack("Someone/A Record/02 Another Song.flac", {kTitle}));
    REQUIRE(unknown);
    REQUIRE(unknown->status == 404);

    const uint32_t count = static_cast<uint32_t>(library.inOrdinalOrder.size());
    for (const uint32_t beyond : {count, count + 1}) {
        INFO("ordinal: ", beyond);

        const auto response = get(server, atOrdinal(beyond, kLibraryStructure, {kTitle}));

        REQUIRE(response);
        CHECK(response->status == 404);
        CHECK(json::parse(response->body) == json::parse(unknown->body));
    }
}

namespace {

std::string columnsQuery(const std::vector<std::string>& columns) {
    std::string query;
    for (const std::string& column : columns)
        query += (query.empty() ? "columns=" : "&columns=") + escaped(column);

    return query;
}

std::string playingAsking(const std::string& query) {
    return "/api/track/playing" + (query.empty() ? "" : "?" + query);
}

std::string playing(const std::vector<std::string>& columns) {
    return playingAsking(columnsQuery(columns));
}

// foobar2000's own absolute path, backslashes and all, and a subsong past 0: a cue sheet's track
// is the case where an answer that dropped the subsong would name the file's first track.
constexpr char kPlayingPath[] = R"(C:\Music\Someone\A Record\disc.flac)";
constexpr uint32_t kPlayingSubsong = 2;

constexpr char kArtistColumn[] = "%artist%";
constexpr char kBitrateColumn[] = "%bitrate%";

// Whatever the player has loaded, standing in for fb2k/: the columns are evaluated against it
// the way the player's now-playing formatting will, and an empty `path` is nothing loaded.
struct FakePlayback {
    std::string path = kPlayingPath;
    uint32_t subsong = kPlayingSubsong;
    std::map<std::string, std::string> values{
        {kTitle, "The Middle"}, {kArtistColumn, "Someone"}, {kBitrateColumn, "912"}};

    // Every column list the route handed over.
    std::vector<std::vector<std::string>> asked;
};

FakePlayback stopped() {
    FakePlayback playback;
    playback.path.clear();
    playback.values.clear();
    return playback;
}

// The pointer must outlive the server. Leaves readLibraryTrack null, which is an install with
// the media library switched off.
Player playingFrom(FakePlayback* playback) {
    Player player;
    player.readPlayingTrack = [playback](const std::vector<std::string>& columns) {
        playback->asked.push_back(columns);

        PlayingTrackRead read;
        if (playback->path.empty())
            return read;

        read.playing = true;
        read.path = playback->path;
        read.subsong = playback->subsong;
        for (const std::string& column : columns) {
            const auto value = playback->values.find(column);
            read.columns.push_back(value == playback->values.end() ? kUnresolved : value->second);
        }

        return read;
    };

    return player;
}

httplib::Result getAsking(const TestServer& server, const std::string& path,
                          const std::string& ifNoneMatch) {
    return server.client().Get(path, httplib::Headers{{"If-None-Match", ifNoneMatch}});
}

}  // namespace

TEST_CASE("the playing track's columns come back in the order they were asked for") {
    FakePlayback playback;
    const TestServer server(servingSettings(), playingFrom(&playback));

    const auto response = get(server, playing({kBitrateColumn, kTitle, kArtistColumn}));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body).at("columns") == json::array({"912", "The Middle", "Someone"}));

    REQUIRE(playback.asked.size() == 1);
    CHECK(playback.asked[0] == std::vector<std::string>{kBitrateColumn, kTitle, kArtistColumn});
}

// The request named no track, so the answer is the only thing that can say which one it was
// read from: a client holding it after a skip compares these two against GET /api/state's
// player.path and player.subsong before drawing a single column.
TEST_CASE("the playing track's answer names the track it was read from, and carries nothing else") {
    FakePlayback playback;
    const TestServer server(servingSettings(), playingFrom(&playback));

    const auto response = get(server, playing({kTitle}));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body) == json{{"path", kPlayingPath},
                                              {"subsong", kPlayingSubsong},
                                              {"columns", json::array({"The Middle"})}});
}

// Every route under /api/library/ answers 503 until the snapshot is built. The playing track is
// read from the player rather than the snapshot, so a radio stream, a file outside every library
// root and a player that has just started all have an answer here.
TEST_CASE("the playing track is read with the media library switched off or still building") {
    FakePlayback playback;
    playback.path = "http://radio.example/stream";
    playback.subsong = 0;

    const TestServer switchedOff(servingSettings(), playingFrom(&playback));

    Library building;
    REQUIRE_FALSE(building.state().ready);
    const TestServer stillBuilding(servingSettings(), playingFrom(&playback), &building);

    for (const TestServer* server : {&switchedOff, &stillBuilding}) {
        const auto response = get(*server, playing({kTitle}));

        REQUIRE(response);
        CHECK(response->status == 200);

        const auto body = json::parse(response->body);
        CHECK(body.at("path") == "http://radio.example/stream");
        CHECK(body.at("columns") == json::array({"The Middle"}));
    }
}

TEST_CASE("the playing track is a 404 while nothing is playing") {
    FakePlayback playback = stopped();
    const TestServer server(servingSettings(), playingFrom(&playback));

    const auto response = get(server, playing({kTitle}));

    REQUIRE(response);
    CHECK(response->status == 404);
    CHECK(json::parse(response->body).count("columns") == 0);
}

// The poll says paused, and the player still has the track loaded. The details panel stays open
// across a pause, so a 404 here would blank it for as long as the music is held.
TEST_CASE("a paused track is answered like a playing one") {
    PlayerStateStore state;
    state.started(PlayingTrack{kPlayingPath, kPlayingSubsong, std::nullopt, 214.0},
                  std::chrono::steady_clock::now());
    state.paused(std::chrono::steady_clock::now());
    REQUIRE(state.read().state.playback == PlaybackState::paused);

    FakePlayback playback;
    const TestServer server(servingSettings(), playingFrom(&playback), nullptr, countingMint(),
                            &state);

    const auto response = get(server, playing({kTitle}));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body) == json{{"path", kPlayingPath},
                                              {"subsong", kPlayingSubsong},
                                              {"columns", json::array({"The Middle"})}});
}

// One gate for both routes, so a client reads the same refusal whichever it asked. Each case is
// sent to GET /api/track/library as well and the two answers compared whole, which holds the
// sentence to whatever that route says rather than to a copy of it here.
TEST_CASE("the playing track refuses the column lists GET /api/track/library refuses, in its words") {
    FakePlayback playback;
    const TestServer server(servingSettings(), playingFrom(&playback));

    // cpp-httplib drops a query pair whose raw text repeats an earlier one, so a repeat has to
    // be spelled twice to arrive twice: %74 is `t`.
    const std::map<std::string, std::string> refused{
        {"no columns", ""},
        {"one past the cap", columnsQuery(columnsNumbering(kMaxColumns + 1))},
        {"an empty column", columnsQuery({kTitle, ""})},
        {"a column past the longest",
         columnsQuery({kTitle, std::string(kMaxColumnLength + 1, 'x')})},
        {"a column repeated", "columns=%25title%25&columns=%25%74itle%25"},
    };

    auto raw = server.client();
    raw.set_path_encode(false);

    for (const auto& asked : refused) {
        INFO("case: ", asked.first);

        const auto query = asked.second.empty() ? "" : "&" + asked.second;
        const auto library =
            raw.Get("/api/track/library?track=" + escaped(kTrackAddress) + query);
        const auto response = raw.Get(playingAsking(asked.second));

        REQUIRE(library);
        REQUIRE(response);
        CHECK(library->status == 400);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body) == json::parse(library->body));
    }

    CHECK(playback.asked.empty());

    const auto atTheCap = get(server, playing(columnsNumbering(kMaxColumns)));
    const auto atTheLongest = get(server, playing({std::string(kMaxColumnLength, 'x')}));

    REQUIRE(atTheCap);
    REQUIRE(atTheLongest);
    CHECK(atTheCap->status == 200);
    CHECK(json::parse(atTheCap->body).at("columns").size() == kMaxColumns);
    CHECK(atTheLongest->status == 200);
}

// The address names nothing durable: the same URL answers a different track after every skip,
// so a cache holding one answer and serving it again would draw the last track's details under
// this one. Unlike the playing cover there is no held answer to fold a validator from.
TEST_CASE("every answer about the playing track says ask again, and none carries a validator") {
    FakePlayback playback;
    const TestServer playingServer(servingSettings(), playingFrom(&playback));

    FakePlayback nothing = stopped();
    const TestServer stoppedServer(servingSettings(), playingFrom(&nothing));

    std::map<std::string, httplib::Result> answers;
    answers.emplace("present", get(playingServer, playing({kTitle})));
    answers.emplace("nothing playing", get(stoppedServer, playing({kTitle})));
    answers.emplace("refused", get(playingServer, playing({})));

    for (const auto& answer : answers) {
        INFO("answer: ", answer.first);

        REQUIRE(answer.second);
        CHECK(answer.second->get_header_value("Cache-Control") == "private, no-cache");
        CHECK_FALSE(answer.second->has_header("ETag"));
    }

    CHECK(answers.at("present")->status == 200);
    CHECK(answers.at("nothing playing")->status == 404);
    CHECK(answers.at("refused")->status == 400);
}

TEST_CASE("a conditional request for the playing track is answered in full, never 304") {
    FakePlayback playback;
    const TestServer server(servingSettings(), playingFrom(&playback));

    for (const char* validator : {"*", R"("anything")", R"(W/"anything")"}) {
        INFO("If-None-Match: ", validator);

        const auto response = getAsking(server, playing({kTitle}), validator);

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(json::parse(response->body).at("columns") == json::array({"The Middle"}));
    }
}
