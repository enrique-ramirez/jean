// GET /api/queue over a real socket. What these pin is what a client drawing the queue panel
// reads: each entry in the player's order, its fixed fields, where it sits in the library and in
// a playlist when it sits anywhere, and nothing past that.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/player_state.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <set>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kLibraryPath[] = "Fictional Artist/Imaginary Album/01 Track.flac";

QueuedTrack track(std::string title) {
    QueuedTrack queued;
    queued.title = std::move(title);
    queued.artist = "Fictional Artist";
    queued.album = "Imaginary Album";
    queued.albumArtist = "Various Fictional Artists";
    queued.duration = 214.5;
    return queued;
}

QueuedTrack fromTheLibrary(std::string title) {
    auto queued = track(std::move(title));
    queued.libraryPath = kLibraryPath;
    return queued;
}

QueuedTrack fromAPlaylistRow(std::string title, uint32_t index) {
    auto queued = track(std::move(title));
    queued.location = PlayingLocation{kPlaylistId, index};
    return queued;
}

Player queueing(std::vector<QueuedTrack> entries, uint64_t revision = 1) {
    Player player = servingPlayer();
    player.readQueue = [entries, revision] {
        QueueRead read;
        read.revision = revision;
        read.entries = entries;
        return read;
    };
    return player;
}

json queueOf(const TestServer& server) {
    const auto response = get(server, "/api/queue");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

json entriesOf(const TestServer& server) {
    const auto body = queueOf(server);
    REQUIRE(body.contains("entries"));
    REQUIRE(body["entries"].is_array());
    return body["entries"];
}

std::set<std::string> keysOf(const json& object) {
    std::set<std::string> keys;
    for (const auto& item : object.items())
        keys.insert(item.key());
    return keys;
}

const std::set<std::string> kEntryKeys = {"title",       "artist",      "duration", "album",
                                          "albumArtist", "libraryPath", "location"};

constexpr uint32_t kQueueLimit = 1000;

}  // namespace

TEST_CASE("GET /api/queue answers every entry in the player's order with the fields a row draws") {
    auto second = track("Second");
    second.artist = "Another Artist";
    second.album = "Another Album";
    second.albumArtist = "Another Artist";
    second.duration = 61.25;

    const TestServer server(servingSettings(),
                            queueing({track("First"), second, track("Third")}));

    const auto entries = entriesOf(server);
    REQUIRE(entries.size() == 3);

    CHECK(entries[0]["title"] == "First");
    CHECK(entries[1]["title"] == "Second");
    CHECK(entries[2]["title"] == "Third");

    const auto& drawn = entries[1];
    CHECK(drawn["artist"] == "Another Artist");
    CHECK(drawn["album"] == "Another Album");
    CHECK(drawn["albumArtist"] == "Another Artist");
    REQUIRE(drawn["duration"].is_number());
    CHECK(drawn["duration"].get<double>() == doctest::Approx(61.25));

    CHECK(entries[0]["artist"] == "Fictional Artist");
    CHECK(entries[0]["albumArtist"] == "Various Fictional Artists");
}

// A move names the revision it was planned against, so the revision has to be the one these
// entries were read at. One read separately from /state could belong to a different queue.
TEST_CASE("GET /api/queue answers the queue revision its entries were read at, and nothing else "
          "beside them") {
    constexpr uint64_t kReadAt = 42;
    const TestServer server(servingSettings(), queueing({track("Only")}, kReadAt));

    const auto body = queueOf(server);

    CHECK(keysOf(body) == std::set<std::string>{"entries", "revision"});
    REQUIRE(body["revision"].is_number_unsigned());
    CHECK(body["revision"].get<uint64_t>() == kReadAt);
    REQUIRE(body["entries"].is_array());
    CHECK(body["entries"].size() == 1);
}

// A client drawing a row reads each fixed field as text. A null would crash that read, and a "?"
// would be drawn as if it were the tag's value.
TEST_CASE("a queued track missing its tags answers an empty string for each, never null") {
    QueuedTrack untagged;
    untagged.duration = 0;
    const TestServer server(servingSettings(), queueing({untagged}));

    const auto entries = entriesOf(server);
    REQUIRE(entries.size() == 1);

    for (const char* field : {"title", "artist", "album", "albumArtist"}) {
        INFO("field: ", field);
        REQUIRE(entries[0].contains(field));
        CHECK(entries[0][field] == "");
    }

    REQUIRE(entries[0]["duration"].is_number());
}

// The library path is what a client asks GET /api/artwork for, so an entry the library does not
// hold has to say so rather than carry a key that finds no cover.
TEST_CASE("a queued track the media library holds carries its library path, and one it does not "
          "carries null") {
    const TestServer server(servingSettings(),
                            queueing({fromTheLibrary("Held"), track("Not held")}));

    const auto entries = entriesOf(server);
    REQUIRE(entries.size() == 2);

    REQUIRE(entries[0].contains("libraryPath"));
    REQUIRE(entries[1].contains("libraryPath"));
    CHECK(entries[0]["libraryPath"] == kLibraryPath);
    CHECK(entries[1]["libraryPath"].is_null());
}

TEST_CASE("a queued playlist row carries its playlist's GUID and position, and a track queued "
          "with no playlist carries null") {
    constexpr uint32_t kRow = 7;
    const TestServer server(servingSettings(),
                            queueing({fromAPlaylistRow("Row", kRow), fromTheLibrary("Handle")}));

    const auto entries = entriesOf(server);
    REQUIRE(entries.size() == 2);

    REQUIRE(entries[0].contains("location"));
    REQUIRE(entries[0]["location"].is_object());
    CHECK(entries[0]["location"]["playlistId"] == kPlaylistId);
    CHECK(entries[0]["location"]["index"] == kRow);

    REQUIRE(entries[1].contains("location"));
    CHECK(entries[1]["location"].is_null());
}

// A field past these is one a client may start reading, and the queue read is bounded to what
// Jean draws. A beefweb id or an absolute path creeping in is the likely one.
TEST_CASE("every queue entry carries exactly its seven keys, whichever of them are null") {
    const TestServer server(servingSettings(),
                            queueing({fromAPlaylistRow("Row", 0), fromTheLibrary("Handle"),
                                      track("Neither")}));

    const auto entries = entriesOf(server);
    REQUIRE(entries.size() == 3);

    for (const auto& entry : entries) {
        INFO("entry: ", entry.dump());
        CHECK(keysOf(entry) == kEntryKeys);
    }

    CHECK(keysOf(entries[0]["location"]) == std::set<std::string>{"index", "playlistId"});
}

TEST_CASE("a queue of QUEUE_LIMIT entries is answered whole and in order") {
    std::vector<QueuedTrack> queued;
    queued.reserve(kQueueLimit);
    for (uint32_t index = 0; index < kQueueLimit; ++index)
        queued.push_back(fromAPlaylistRow("Track " + std::to_string(index), index));

    const TestServer server(servingSettings(), queueing(std::move(queued)));

    const auto entries = entriesOf(server);
    REQUIRE(entries.size() == kQueueLimit);

    for (uint32_t index = 0; index < kQueueLimit; ++index) {
        INFO("entry ", index);
        REQUIRE(entries[index]["title"] == "Track " + std::to_string(index));
        REQUIRE(entries[index]["location"]["index"] == index);
    }
}
