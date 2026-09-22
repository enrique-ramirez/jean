// The queue routes over a real socket. What these pin is what a client drawing the queue panel
// reads: each entry in the player's order, its fixed fields, where it sits in the library and in
// a playlist when it sits anywhere, and nothing past that. And what a client queueing, moving or
// clearing asks of the player, and what it hears back, including that a refused request never
// reaches it.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/library.h"
#include "core/player_state.h"
#include "support/keys.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <iterator>
#include <optional>
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

const Keys kEntryKeys = {"title",       "artist",      "duration", "album",
                         "albumArtist", "libraryPath", "location"};

constexpr uint32_t kQueueLimit = 1000;

// The store moves its revision only when the queue it is handed differs, so each change is a
// different queue.
void changeTheQueueUntil(PlayerStateStore& store, uint64_t revision) {
    for (uint64_t change = 0; store.read().queueRevision < revision && change < revision;
         ++change) {
        QueueEntry entry;
        entry.path = "Fictional Artist/Imaginary Album/" + std::to_string(change) + ".flac";
        store.queueChanged({entry});
    }
    REQUIRE(store.read().queueRevision == revision);
}

TestServer servingQueue(const Player& player, PlayerStateStore* store, Library* library = nullptr) {
    return TestServer(servingSettings(), player, library, countingMint(), store);
}

}  // namespace

TEST_CASE("GET /api/queue answers every entry in the player's order with the fields a row draws") {
    auto second = track("Second");
    second.artist = "Another Artist";
    second.album = "Another Album";
    second.albumArtist = "Another Artist";
    second.duration = 61.25;

    const TestServer server(servingSettings(), queueing({track("First"), second, track("Third")}));

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
TEST_CASE(
    "GET /api/queue answers the queue revision its entries were read at, and nothing else "
    "beside them") {
    constexpr uint64_t kReadAt = 42;
    const TestServer server(servingSettings(), queueing({track("Only")}, kReadAt));

    const auto body = queueOf(server);

    CHECK(keysOf(body) == Keys{"entries", "revision"});
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
TEST_CASE(
    "a queued track the media library holds carries its library path, and one it does not "
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

TEST_CASE(
    "a queued playlist row carries its playlist's GUID and position, and a track queued "
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
    const TestServer server(
        servingSettings(),
        queueing({fromAPlaylistRow("Row", 0), fromTheLibrary("Handle"), track("Neither")}));

    const auto entries = entriesOf(server);
    REQUIRE(entries.size() == 3);

    for (const auto& entry : entries) {
        INFO("entry: ", entry.dump());
        CHECK(keysOf(entry) == kEntryKeys);
    }

    CHECK(keysOf(entries[0]["location"]) == Keys{"index", "playlistId"});
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

namespace {

constexpr char kQueueRows[] = "/api/queue";

struct RowQueueLog {
    int calls = 0;
    std::string playlistId;
    std::vector<uint32_t> positions;
    std::optional<QueuePosition> at;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

Player queueingRows(RowQueueLog* log) {
    Player player = servingPlayer();
    player.queuePlaylistRows = [log](const std::string& playlistId,
                                     const std::vector<uint32_t>& positions,
                                     std::optional<QueuePosition> at) {
        log->calls++;
        log->playlistId = playlistId;
        log->positions = positions;
        log->at = at;
        return log->answer;
    };
    return player;
}

std::string rowsOf(const std::string& playlistId, const json& positions) {
    return json{{"playlistId", playlistId}, {"positions", positions}}.dump();
}

bool accepted(const httplib::Result& response) {
    constexpr int kRedirected = 300;
    return response && response->status >= 200 && response->status < kRedirected;
}

}  // namespace

// A multi-select is queued in the order it was clicked, so a route that sorted the positions, or
// queued them as a range, would play them in an order nobody chose.
TEST_CASE(
    "queueing playlist rows hands the player the playlist and every position in the order "
    "given, once, at the end of the queue") {
    RowQueueLog log;
    const TestServer server(servingSettings(), queueingRows(&log));

    const auto response = post(server, kQueueRows, rowsOf(kPlaylistId, {7, 2, 5}));

    REQUIRE(response);
    CHECK(accepted(response));

    REQUIRE(log.calls == 1);
    CHECK(log.playlistId == kPlaylistId);
    CHECK(log.positions == std::vector<uint32_t>{7, 2, 5});
    CHECK_FALSE(log.at.has_value());
}

// Zero is the head of the queue, and the one position a parse reading a missing field as zero
// would confuse with the end.
TEST_CASE(
    "queueing playlist rows at a queue position hands the player that position and the "
    "queue revision the client planned it against") {
    for (const uint32_t at : {uint32_t{0}, uint32_t{2}}) {
        INFO("at: ", at);
        PlayerStateStore store;
        changeTheQueueUntil(store, 9);
        RowQueueLog log;
        const TestServer server = servingQueue(queueingRows(&log), &store);

        auto body = json::parse(rowsOf(kPlaylistId, {4}));
        body["at"] = at;
        body["revision"] = 9;

        const auto response = post(server, kQueueRows, body.dump());

        REQUIRE(response);
        CHECK(accepted(response));

        REQUIRE(log.calls == 1);
        CHECK(log.positions == std::vector<uint32_t>{4});
        REQUIRE(log.at.has_value());
        CHECK(log.at->index == at);
        CHECK(log.at->revision == 9);
    }
}

TEST_CASE(
    "a queue request the component can judge for itself is a 400 and never reaches the "
    "player") {
    RowQueueLog log;
    const TestServer server(servingSettings(), queueingRows(&log));

    const auto positioned = [](const json& at, const json& revision) {
        auto body = json::parse(rowsOf(kPlaylistId, {1}));
        body["at"] = at;
        if (!revision.is_null())
            body["revision"] = revision;
        return body.dump();
    };

    const std::vector<std::string> bodies = {
        "not json",
        json{{"positions", {1}}}.dump(),
        rowsOf("nonsense", {1}),
        rowsOf("45837D74-FA4F-415C-BBA9-BF2DB8F0DC04", {1}),
        json{{"playlistId", kPlaylistId}}.dump(),
        rowsOf(kPlaylistId, json::array()),
        rowsOf(kPlaylistId, 1),
        rowsOf(kPlaylistId, {1.5}),
        rowsOf(kPlaylistId, {"3"}),
        rowsOf(kPlaylistId, {-1}),
        rowsOf(kPlaylistId, {nullptr}),
        positioned(-1, 9),
        positioned(1.5, 9),
        positioned("2", 9),
        positioned(2, nullptr),
    };

    for (const auto& body : bodies) {
        INFO("body: ", body);
        const auto response = post(server, kQueueRows, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.calls == 0);
}

// Only the player knows which playlists exist and how many rows each holds, so these two are
// answered from inside the job rather than judged at the route.
TEST_CASE(
    "queueing from a playlist the player does not have is a 404, and a position past that "
    "playlist's end is a 400") {
    struct Case {
        PlaylistOutcome outcome;
        int status;
    };

    for (const auto& expected : {Case{PlaylistOutcome::noSuchPlaylist, 404},
                                 Case{PlaylistOutcome::positionPastEnd, 400}}) {
        INFO("outcome: ", describe(expected.outcome));
        RowQueueLog log;
        log.answer = expected.outcome;
        const TestServer server(servingSettings(), queueingRows(&log));

        const auto response = post(server, kQueueRows, rowsOf(kPlaylistId, {3}));

        REQUIRE(response);
        CHECK(response->status == expected.status);
        CHECK(json::parse(response->body)["error"].is_string());
        CHECK(log.calls == 1);
    }
}

namespace {

struct TrackQueueLog {
    int calls = 0;
    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;
    std::optional<QueuePosition> at;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

// Both sources recorded, so a body can be shown to reach the one it names and never the other.
Player queueingEither(RowQueueLog* rows, TrackQueueLog* tracks) {
    Player player = queueingRows(rows);
    player.queueLibraryTracks = [tracks](uint64_t structure, const std::vector<uint32_t>& ordinals,
                                         std::optional<QueuePosition> at) {
        tracks->calls++;
        tracks->structure = structure;
        tracks->ordinals = ordinals;
        tracks->at = at;
        return tracks->answer;
    };
    return player;
}

constexpr size_t kLibraryTracks = 8;

void buildLibrary(Library& library, size_t trackCount = kLibraryTracks) {
    LibraryBuilder builder({"%title%"}, trackCount);
    auto& sink = builder.sink();

    for (size_t index = 0; index < trackCount; ++index) {
        const auto ordinal = std::to_string(index);
        sink.row(index, {"Artist/Album/", ordinal + ".flac", "0", "Track " + ordinal});
    }

    library.replace(builder.finish());
}

json tracksOf(uint64_t structure, const char* form, const json& selection) {
    return json{{"structure", structure}, {form, selection}};
}

}  // namespace

// A multi-select from the library is queued in the order it was clicked, which only the
// `ordinals` form can carry.
TEST_CASE(
    "queueing library tracks by ordinals hands the player the structure and every ordinal "
    "in the order given, once, at the end of the queue, and no playlist row") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

    const auto response =
        post(server, kQueueRows, tracksOf(structure, "ordinals", {5, 0, 3}).dump());

    REQUIRE(response);
    CHECK(response->status == 204);

    REQUIRE(tracks.calls == 1);
    CHECK(tracks.structure == structure);
    CHECK(tracks.ordinals == std::vector<uint32_t>{5, 0, 3});
    CHECK_FALSE(tracks.at.has_value());
    CHECK(rows.calls == 0);
}

// contract/openapi.yaml's `Runs` and `Bitset` are ascending by definition, for a queue as for a
// fill. Runs listed out of order are the case that tells ascending apart from as-listed.
TEST_CASE(
    "library tracks queued as runs or as a bitset reach the player in ascending ordinal "
    "order") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    struct Form {
        const char* name;
        json selection;
    };

    for (const auto& form : {Form{"runs", {{5, 2}, {0, 1}}}, Form{"bitset", "YQ=="}}) {
        INFO("form: ", form.name);
        RowQueueLog rows;
        TrackQueueLog tracks;
        const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

        const auto response =
            post(server, kQueueRows, tracksOf(structure, form.name, form.selection).dump());

        REQUIRE(response);
        CHECK(response->status == 204);

        REQUIRE(tracks.calls == 1);
        CHECK(tracks.ordinals == std::vector<uint32_t>{0, 5, 6});
        CHECK(rows.calls == 0);
    }
}

TEST_CASE(
    "queueing library tracks at a queue position hands the player that position and the "
    "queue revision the client planned it against") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    for (const uint32_t at : {uint32_t{0}, uint32_t{2}}) {
        INFO("at: ", at);
        PlayerStateStore store;
        changeTheQueueUntil(store, 9);
        RowQueueLog rows;
        TrackQueueLog tracks;
        const TestServer server = servingQueue(queueingEither(&rows, &tracks), &store, &library);

        auto body = tracksOf(structure, "ordinals", {4});
        body["at"] = at;
        body["revision"] = 9;

        const auto response = post(server, kQueueRows, body.dump());

        REQUIRE(response);
        CHECK(response->status == 204);

        REQUIRE(tracks.calls == 1);
        CHECK(tracks.ordinals == std::vector<uint32_t>{4});
        REQUIRE(tracks.at.has_value());
        CHECK(tracks.at->index == at);
        CHECK(tracks.at->revision == 9);
        CHECK(rows.calls == 0);
    }
}

// A body naming both would be queued from whichever source the parse happened to read first,
// and the client could not tell which.
TEST_CASE(
    "a queue request naming both a playlist and the library, or neither, is a 400 and "
    "reaches neither queue") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

    const auto withRows = [](json body) {
        body["playlistId"] = kPlaylistId;
        body["positions"] = {1};
        return body;
    };

    const std::vector<json> bodies = {
        json::object(),
        json{{"at", 0}, {"revision", 1}},
        withRows(tracksOf(structure, "ordinals", {1})),
        withRows(tracksOf(structure, "runs", {{0, 1}})),
        withRows(tracksOf(structure, "bitset", "Ag==")),
        json{{"playlistId", kPlaylistId}, {"structure", structure}, {"ordinals", {1}}},
        json{{"positions", {1}}, {"structure", structure}, {"ordinals", {1}}},
    };

    for (const auto& body : bodies) {
        INFO("body: ", body.dump());
        const auto response = post(server, kQueueRows, body.dump());
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(rows.calls == 0);
    CHECK(tracks.calls == 0);
}

TEST_CASE(
    "a library selection the component can judge for itself is a 400 and never reaches the "
    "player") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

    const auto positioned = [structure](const json& at, const json& revision) {
        auto body = tracksOf(structure, "ordinals", {1});
        body["at"] = at;
        if (!revision.is_null())
            body["revision"] = revision;
        return body;
    };

    auto twoForms = tracksOf(structure, "ordinals", {1});
    twoForms["runs"] = {{1, 1}};

    const std::vector<json> bodies = {
        json{{"structure", structure}},
        json{{"ordinals", {1}}},
        json{{"structure", std::to_string(structure)}, {"ordinals", {1}}},
        twoForms,
        tracksOf(structure, "ordinals", 1),
        tracksOf(structure, "ordinals", {1.5}),
        tracksOf(structure, "ordinals", {"3"}),
        tracksOf(structure, "ordinals", {-1}),
        tracksOf(structure, "ordinals", {nullptr}),
        tracksOf(structure, "ordinals", {kLibraryTracks}),
        tracksOf(structure, "runs", {{1}}),
        tracksOf(structure, "runs", {{1, 2, 3}}),
        tracksOf(structure, "runs", {{6, 4}}),
        tracksOf(structure, "runs", "0,1"),
        tracksOf(structure, "bitset", 7),
        tracksOf(structure, "bitset", "not base64!"),
        tracksOf(structure, "bitset", "AAE="),
        positioned(-1, 9),
        positioned("2", 9),
        positioned(2, nullptr),
    };

    for (const auto& body : bodies) {
        INFO("body: ", body.dump());
        const auto response = post(server, kQueueRows, body.dump());
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(tracks.calls == 0);
    CHECK(rows.calls == 0);
}

// An ordinal means a track only within the structure it was exported at. The shrunken library
// makes one of these ordinals past the end, which is still a moved structure rather than a 400:
// the client's remedy is to export again, not to fix the set.
TEST_CASE(
    "queueing library tracks against a structure the library has moved past is a 409 and "
    "never reaches the player") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    buildLibrary(library, kLibraryTracks - 6);

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

    for (const auto& body :
         {tracksOf(exported, "ordinals", {1}), tracksOf(exported, "ordinals", {7})}) {
        INFO("body: ", body.dump());
        const auto response = post(server, kQueueRows, body.dump());

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    }

    CHECK(tracks.calls == 0);
    CHECK(rows.calls == 0);
}

// The library can rebuild between the route's check and the job that resolves the ordinals on
// the main thread, so the player answers the same 409 from inside the job.
TEST_CASE("a structure the library moves past before the player's job runs is a 409") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    RowQueueLog rows;
    TrackQueueLog tracks;
    tracks.answer = PlaylistOutcome::structureMoved;
    const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

    const auto response = post(server, kQueueRows, tracksOf(structure, "ordinals", {2}).dump());

    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    CHECK(tracks.calls == 1);
}

// A request that queues nothing is a client bug, the same reason an empty `positions` is
// refused for a playlist row. An all-zero bitset is the same empty set in the third form.
TEST_CASE(
    "an empty library selection is a 400 and never reaches the player, whichever form "
    "carries it") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

    for (const auto& body :
         {tracksOf(structure, "ordinals", json::array()),
          tracksOf(structure, "runs", json::array()), tracksOf(structure, "bitset", "AA==")}) {
        INFO("body: ", body.dump());
        const auto response = post(server, kQueueRows, body.dump());
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(tracks.calls == 0);
    CHECK(rows.calls == 0);
}

// The ordinals are the client's own export, so the error has to name what is missing rather than
// blame the set, or the client retries with a set that cannot land either.
TEST_CASE(
    "queueing library tracks with nothing to resolve them against is a 503 naming what is "
    "missing") {
    TrackQueueLog tracks;
    Library unbuilt;

    const auto refused = [&tracks](Library* library, const std::string& error) {
        RowQueueLog rows;
        const TestServer server(servingSettings(), queueingEither(&rows, &tracks), library);

        const auto response = post(server, kQueueRows, tracksOf(1, "ordinals", {1}).dump());

        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(json::parse(response->body)["error"] == error);
        CHECK(rows.calls == 0);
    };

    SUBCASE("an install that does not serve the library at all") {
        refused(nullptr, "the media library is not available");
    }

    SUBCASE("a library whose first snapshot has not been built yet") {
        refused(&unbuilt, describe(DeltaOutcome::notBuilt));
    }

    CHECK(tracks.calls == 0);
}

TEST_CASE("an ordinal repeated in the request is queued twice") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

    const auto response = post(server, kQueueRows, tracksOf(structure, "ordinals", {3, 3}).dump());

    REQUIRE(response);
    CHECK(response->status == 204);
    REQUIRE(tracks.calls == 1);
    CHECK(tracks.ordinals == std::vector<uint32_t>{3, 3});
}

// A client refuses a selection past its own limit and the component holds none, so what has to
// hold here is that a selection of that size is answered rather than refused for its size, and
// that it fits in the body the server will read. Descending ordinals are the order only that form
// can carry and the widest ordinals in the library; one run per track is the longest a selection
// of that size can be written as runs.
TEST_CASE(
    "a selection of QUEUE_LIMIT library tracks reaches the player whole, in a body inside "
    "kMaxBodyBytes") {
    constexpr size_t kLibrarySize = size_t{kQueueLimit} * 2;

    Library library;
    buildLibrary(library, kLibrarySize);
    const uint64_t structure = library.state().structure;

    std::vector<uint32_t> clicked;
    std::vector<uint32_t> everyOther;
    json runs = json::array();
    for (uint32_t index = 0; index < kQueueLimit; ++index) {
        clicked.push_back(static_cast<uint32_t>(kLibrarySize) - 1 - index);
        everyOther.push_back(index * 2);
        runs.push_back({index * 2, 1});
    }

    struct Form {
        const char* name;
        json selection;
        std::vector<uint32_t> queued;
    };

    for (const auto& form : {Form{"ordinals", clicked, clicked}, Form{"runs", runs, everyOther}}) {
        INFO("form: ", form.name);
        RowQueueLog rows;
        TrackQueueLog tracks;
        const TestServer server(servingSettings(), queueingEither(&rows, &tracks), &library);

        const auto body = tracksOf(structure, form.name, form.selection).dump();
        CHECK(body.size() < kMaxBodyBytes);

        const auto response = post(server, kQueueRows, body);

        REQUIRE(response);
        CHECK(response->status == 204);

        REQUIRE(tracks.calls == 1);
        REQUIRE(tracks.ordinals.size() == kQueueLimit);
        CHECK(tracks.ordinals == form.queued);
        CHECK(rows.calls == 0);
    }
}

namespace {

constexpr char kMoveEntry[] = "/api/queue/move";
constexpr char kNoQueue[] = "the queue is not available";

// Two changes, so a revision one behind the store is still not zero, which is what a parse
// reading a missing field would also produce.
void changeTheQueueTwice(PlayerStateStore& store) {
    changeTheQueueUntil(store, 2);
}

json atPosition(json body, uint32_t at, uint64_t revision) {
    body["at"] = at;
    body["revision"] = revision;
    return body;
}

struct MoveLog {
    int calls = 0;
    uint32_t from = 0;
    uint32_t to = 0;
    uint64_t revision = 0;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

Player moving(MoveLog* log) {
    Player player = servingPlayer();
    player.moveQueueEntry = [log](uint32_t from, uint32_t to, uint64_t revision) {
        log->calls++;
        log->from = from;
        log->to = to;
        log->revision = revision;
        return log->answer;
    };
    return player;
}

json moveOf(const json& from, const json& to, const json& revision) {
    return json{{"from", from}, {"to", to}, {"revision", revision}};
}

struct ClearLog {
    int calls = 0;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

Player clearing(ClearLog* log) {
    Player player = servingPlayer();
    player.clearQueue = [log] {
        log->calls++;
        return log->answer;
    };
    return player;
}

struct RemoveLog {
    int calls = 0;
    uint32_t index = 0;
    uint64_t revision = 0;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

Player removing(RemoveLog* log) {
    Player player = servingPlayer();
    player.removeQueueEntry = [log](uint32_t index, uint64_t revision) {
        log->calls++;
        log->index = index;
        log->revision = revision;
        return log->answer;
    };
    return player;
}

httplib::Result removeEntry(const TestServer& server, const std::string& index,
                            const std::string& query) {
    return server.client().Delete(std::string(kQueueRows) + "/" + index + query,
                                  TestServer::bearer());
}

httplib::Result removeEntry(const TestServer& server, uint32_t index, uint64_t revision) {
    return removeEntry(server, std::to_string(index), "?revision=" + std::to_string(revision));
}

constexpr int kAttempts = 60;

httplib::Result clearTheQueue(const TestServer& server) {
    return server.client().Delete(kQueueRows, TestServer::bearer());
}

}  // namespace

// A position is only a position in the queue it was read from. A revision ahead of the store is
// what a client holds across a component restart, which counts from the start again.
TEST_CASE(
    "queueing at a queue position against a revision the queue has moved past, or never "
    "reached, is a 409 and reaches neither queue") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;
    REQUIRE(current >= 2);

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server = servingQueue(queueingEither(&rows, &tracks), &store, &library);

    for (const uint64_t named : {current - 1, current + 1}) {
        for (const auto& body : {atPosition(json::parse(rowsOf(kPlaylistId, {4})), 1, named),
                                 atPosition(tracksOf(structure, "ordinals", {4}), 1, named)}) {
            INFO("body: ", body.dump());
            const auto response = post(server, kQueueRows, body.dump());

            REQUIRE(response);
            CHECK(response->status == 409);
            if (response->status != 409)
                continue;

            const auto error = json::parse(response->body)["error"];
            REQUIRE(error.is_string());
            // A library request can be a 409 for either reason, and the remedies differ: export
            // again, or read the queue again.
            CHECK(error != describe(DeltaOutcome::structureChanged));
        }
    }

    CHECK(rows.calls == 0);
    CHECK(tracks.calls == 0);
}

TEST_CASE(
    "queueing at a queue position against the queue's current revision reaches the player "
    "with that revision") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server = servingQueue(queueingEither(&rows, &tracks), &store, &library);

    const auto rowsBody = atPosition(json::parse(rowsOf(kPlaylistId, {4})), 1, current);
    const auto tracksBody = atPosition(tracksOf(structure, "ordinals", {4}), 1, current);

    const auto rowsResponse = post(server, kQueueRows, rowsBody.dump());
    const auto tracksResponse = post(server, kQueueRows, tracksBody.dump());

    REQUIRE(rowsResponse);
    REQUIRE(tracksResponse);
    CHECK(rowsResponse->status == 204);
    CHECK(tracksResponse->status == 204);

    REQUIRE(rows.calls == 1);
    REQUIRE(rows.at.has_value());
    CHECK(rows.at->revision == current);

    REQUIRE(tracks.calls == 1);
    REQUIRE(tracks.at.has_value());
    CHECK(tracks.at->revision == current);
}

// The end of the queue is the end whatever it holds, so a client queueing there has no view to be
// stale against, and a queue other clients are busy changing must not refuse it.
TEST_CASE("queueing at the end of a queue that has moved on is never refused for it") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    PlayerStateStore store;
    changeTheQueueTwice(store);

    RowQueueLog rows;
    TrackQueueLog tracks;
    const TestServer server = servingQueue(queueingEither(&rows, &tracks), &store, &library);

    const auto rowsResponse = post(server, kQueueRows, rowsOf(kPlaylistId, {4}));
    const auto tracksResponse =
        post(server, kQueueRows, tracksOf(structure, "ordinals", {4}).dump());

    REQUIRE(rowsResponse);
    REQUIRE(tracksResponse);
    CHECK(rowsResponse->status == 204);
    CHECK(tracksResponse->status == 204);
    CHECK(rows.calls == 1);
    CHECK(tracks.calls == 1);
}

// `to` is the entry's index once it has moved: taken out at `from`, then put back at `to` in the
// queue without it, as Jean's queue panel plans a move. Zero both ways, since a parse reading a
// missing field as zero would get one of the two right, and a move to where the entry already is
// goes to the player like any other.
TEST_CASE(
    "moving a queue entry hands the player where it is, where it goes and the revision the "
    "client planned it against, once") {
    struct Move {
        uint32_t from;
        uint32_t to;
    };

    for (const auto& move : {Move{3, 0}, Move{0, 3}, Move{2, 2}}) {
        INFO("from ", move.from, " to ", move.to);
        PlayerStateStore store;
        changeTheQueueTwice(store);
        const uint64_t current = store.read().queueRevision;

        MoveLog log;
        const TestServer server = servingQueue(moving(&log), &store);

        const auto response = post(server, kMoveEntry, moveOf(move.from, move.to, current).dump());

        REQUIRE(response);
        CHECK(response->status == 204);

        REQUIRE(log.calls == 1);
        CHECK(log.from == move.from);
        CHECK(log.to == move.to);
        CHECK(log.revision == current);
    }
}

TEST_CASE(
    "moving a queue entry against a revision the queue has moved past, or never reached, is "
    "a 409 and never reaches the player") {
    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;
    REQUIRE(current >= 2);

    MoveLog log;
    const TestServer server = servingQueue(moving(&log), &store);

    for (const uint64_t named : {current - 1, current + 1}) {
        INFO("revision: ", named);
        const auto response = post(server, kMoveEntry, moveOf(2, 0, named).dump());

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.calls == 0);
}

TEST_CASE("a move the component can judge for itself is a 400 and never reaches the player") {
    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    MoveLog log;
    const TestServer server = servingQueue(moving(&log), &store);

    const std::vector<std::string> bodies = {
        "not json",
        json::object().dump(),
        json{{"to", 0}, {"revision", current}}.dump(),
        json{{"from", 2}, {"revision", current}}.dump(),
        json{{"from", 2}, {"to", 0}}.dump(),
        moveOf(-1, 0, current).dump(),
        moveOf(2, -1, current).dump(),
        moveOf(1.5, 0, current).dump(),
        moveOf("2", 0, current).dump(),
        moveOf(2, nullptr, current).dump(),
        moveOf(2, 0, -1).dump(),
        moveOf(2, 0, std::to_string(current)).dump(),
    };

    for (const auto& body : bodies) {
        INFO("body: ", body);
        const auto response = post(server, kMoveEntry, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.calls == 0);
}

TEST_CASE("a field no queue schema declares is refused, and nothing is queued or moved") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    RowQueueLog rows;
    TrackQueueLog tracks;
    MoveLog moves;

    Player player = queueingEither(&rows, &tracks);
    player.moveQueueEntry = moving(&moves).moveQueueEntry;
    const TestServer server = servingQueue(player, &store, &library);

    struct Target {
        std::string name;
        std::string path;
        json body;
    };

    const std::vector<Target> targets = {
        {"a playlist's rows", kQueueRows, json::parse(rowsOf(kPlaylistId, {4}))},
        {"library tracks", kQueueRows, tracksOf(structure, "ordinals", {4})},
        {"a move", kMoveEntry, moveOf(2, 0, current)}};

    const std::vector<std::pair<std::string, json>> undeclared = {{"replace", true},
                                                                  {"revison", current}};

    for (const auto& target : targets) {
        for (const auto& field : undeclared) {
            INFO("target: ", target.name, ", field: ", field.first);

            auto body = target.body;
            body[field.first] = field.second;

            const auto response = post(server, target.path, body.dump());

            REQUIRE(response);
            CHECK(response->status == 400);
            if (response->status != 400)
                continue;

            // The envelope was wrong rather than the set, which is the other refusal a client
            // switches on here: it would send a caller looking at positions it sent correctly.
            CHECK(json::parse(response->body)["error"] == describe(PlaylistRefusal::malformedBody));
        }
    }

    CHECK(rows.calls == 0);
    CHECK(tracks.calls == 0);
    CHECK(moves.calls == 0);
}

// Only the player knows how long the queue is, so this is answered from inside the job, the same
// way a row past a playlist's end is.
TEST_CASE("moving an entry from or to past the end of the queue is a 400") {
    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    MoveLog log;
    log.answer = PlaylistOutcome::positionPastEnd;
    const TestServer server = servingQueue(moving(&log), &store);

    const auto response = post(server, kMoveEntry, moveOf(9, 0, current).dump());

    REQUIRE(response);
    CHECK(response->status == 400);
    CHECK(json::parse(response->body)["error"].is_string());
    CHECK(log.calls == 1);
}

// See ARCHITECTURE.md, *Threads, and what may block*, for the race between the route's own
// check and the job's. The job answers the same 409 a stale revision gets at the route, so a
// client has one remedy for either.
TEST_CASE(
    "a queue that moves before the player's job runs is the same 409 the route answers for "
    "a stale revision") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    RowQueueLog rows;
    TrackQueueLog tracks;
    MoveLog moves;
    rows.answer = PlaylistOutcome::queueMoved;
    tracks.answer = PlaylistOutcome::queueMoved;
    moves.answer = PlaylistOutcome::queueMoved;

    Player player = queueingEither(&rows, &tracks);
    player.moveQueueEntry = moving(&moves).moveQueueEntry;
    const TestServer server = servingQueue(player, &store, &library);

    const auto staleAtTheRoute = post(server, kMoveEntry, moveOf(2, 0, current - 1).dump());
    REQUIRE(staleAtTheRoute);
    REQUIRE(staleAtTheRoute->status == 409);
    const auto routeError = json::parse(staleAtTheRoute->body)["error"];

    struct Request {
        const char* path;
        json body;
    };

    for (const auto& request :
         {Request{kQueueRows, atPosition(json::parse(rowsOf(kPlaylistId, {4})), 1, current)},
          Request{kQueueRows, atPosition(tracksOf(structure, "ordinals", {4}), 1, current)},
          Request{kMoveEntry, moveOf(2, 0, current)}}) {
        INFO("body: ", request.body.dump());
        const auto response = post(server, request.path, request.body.dump());

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"] == routeError);
    }

    CHECK(rows.calls == 1);
    CHECK(tracks.calls == 1);
    CHECK(moves.calls == 1);
}

// Zero is the head of the queue, and the index a parse reading a missing segment as zero would
// also produce.
TEST_CASE(
    "removing a queue entry hands the player its index and the revision the client read it "
    "at, once") {
    for (const uint32_t index : {uint32_t{0}, uint32_t{3}}) {
        INFO("index: ", index);
        PlayerStateStore store;
        changeTheQueueTwice(store);
        const uint64_t current = store.read().queueRevision;

        RemoveLog log;
        const TestServer server = servingQueue(removing(&log), &store);

        const auto response = removeEntry(server, index, current);

        REQUIRE(response);
        CHECK(response->status == 204);

        REQUIRE(log.calls == 1);
        CHECK(log.index == index);
        CHECK(log.revision == current);
    }
}

// An index read from an older queue names whichever entry has since slid into that place.
TEST_CASE(
    "removing a queue entry against a revision the queue has moved past, or never reached, "
    "is a 409 and never reaches the player") {
    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;
    REQUIRE(current >= 2);

    RemoveLog log;
    const TestServer server = servingQueue(removing(&log), &store);

    for (const uint64_t named : {current - 1, current + 1}) {
        INFO("revision: ", named);
        const auto response = removeEntry(server, 2, named);

        REQUIRE(response);
        CHECK(response->status == 409);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.calls == 0);
}

TEST_CASE("a remove the component can judge for itself is a 400 and never reaches the player") {
    PlayerStateStore store;
    changeTheQueueTwice(store);
    const std::string revision = "?revision=" + std::to_string(store.read().queueRevision);

    RemoveLog log;
    const TestServer server = servingQueue(removing(&log), &store);

    struct Request {
        const char* index;
        std::string query;
    };

    for (const auto& request : {
             Request{"2", ""},
             Request{"2", "?revision="},
             Request{"2", "?revision=-1"},
             Request{"2", "?revision=1.5"},
             Request{"2", "?revision=nine"},
             Request{"-1", revision},
             Request{"1.5", revision},
             Request{"two", revision},
         }) {
        INFO("index: ", request.index, " query: ", request.query);
        const auto response = removeEntry(server, request.index, request.query);

        REQUIRE(response);
        CHECK(response->status == 400);
        if (response->status == 400)
            CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.calls == 0);
}

// Only the player knows how long the queue is, so a past-the-end index is answered from inside
// the job; a queue that moves before the job runs (ARCHITECTURE.md, *Threads, and what may
// block*) is answered from there too, with the route's own 409.
TEST_CASE(
    "removing past the end of the queue is a 400, and a queue that moves before the player's "
    "job runs is the 409 a stale revision gets") {
    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    RemoveLog log;
    const TestServer server = servingQueue(removing(&log), &store);

    const auto staleAtTheRoute = removeEntry(server, 2, current - 1);
    REQUIRE(staleAtTheRoute);
    REQUIRE(staleAtTheRoute->status == 409);
    const auto routeError = json::parse(staleAtTheRoute->body)["error"];

    log.answer = PlaylistOutcome::positionPastEnd;
    const auto pastTheEnd = removeEntry(server, 9, current);
    REQUIRE(pastTheEnd);
    CHECK(pastTheEnd->status == 400);
    CHECK(json::parse(pastTheEnd->body)["error"].is_string());

    log.answer = PlaylistOutcome::queueMoved;
    const auto moved = removeEntry(server, 2, current);
    REQUIRE(moved);
    CHECK(moved->status == 409);
    CHECK(json::parse(moved->body)["error"] == routeError);

    CHECK(log.calls == 2);
}

// Emptying the queue means the same thing against any view of it, so a clear carries no revision
// and is not refused for a queue that moved.
TEST_CASE("clearing the queue asks the player once, whatever revision the client last read") {
    PlayerStateStore store;
    changeTheQueueTwice(store);

    ClearLog log;
    const TestServer server = servingQueue(clearing(&log), &store);

    const auto response = clearTheQueue(server);

    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(log.calls == 1);
}

// A client that gave up waiting has to re-read the queue to learn whether it emptied.
TEST_CASE("a clear the player does not finish in time is a 504") {
    PlayerStateStore store;
    changeTheQueueTwice(store);

    ClearLog log;
    log.answer = PlaylistOutcome::timedOut;
    const TestServer server = servingQueue(clearing(&log), &store);

    const auto response = clearTheQueue(server);

    REQUIRE(response);
    CHECK(response->status == 504);
    CHECK(json::parse(response->body)["error"].is_string());
    CHECK(log.calls == 1);
}

TEST_CASE("moving, removing or clearing on an install with no queue is a 503 naming the queue") {
    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    const TestServer server = servingQueue(servingPlayer(), &store);

    const auto moved = post(server, kMoveEntry, moveOf(2, 0, current).dump());
    const auto removed = removeEntry(server, 2, current);
    const auto cleared = clearTheQueue(server);

    for (const httplib::Result* response : {&moved, &removed, &cleared}) {
        REQUIRE(*response);
        CHECK((*response)->status == 503);
        CHECK(json::parse((*response)->body)["error"] == kNoQueue);
    }
}

TEST_CASE("a client moving, removing or clearing in a loop is slowed down rather than obeyed") {
    const auto slowedDown = [](const std::function<httplib::Result()>& send, const int& calls) {
        std::vector<httplib::Result> replies;
        std::generate_n(std::back_inserter(replies), kAttempts, send);

        CHECK(std::all_of(replies.begin(), replies.end(),
                          [](const httplib::Result& r) { return static_cast<bool>(r); }));

        const auto first429 =
            std::find_if(replies.begin(), replies.end(),
                         [](const httplib::Result& r) { return r && r->status == 429; });
        REQUIRE(first429 != replies.end());
        CHECK((*first429)->get_header_value("Retry-After") == "1");
        CHECK(json::parse((*first429)->body)["error"].is_string());
        CHECK(calls < kAttempts);
    };

    PlayerStateStore store;
    changeTheQueueTwice(store);
    const uint64_t current = store.read().queueRevision;

    SUBCASE("moving") {
        MoveLog log;
        const TestServer server = servingQueue(moving(&log), &store);
        const auto move = moveOf(2, 0, current).dump();
        slowedDown([&server, &move] { return post(server, kMoveEntry, move); }, log.calls);
    }

    SUBCASE("removing") {
        RemoveLog log;
        const TestServer server = servingQueue(removing(&log), &store);
        slowedDown([&server, current] { return removeEntry(server, 2, current); }, log.calls);
    }

    SUBCASE("clearing") {
        ClearLog log;
        const TestServer server = servingQueue(clearing(&log), &store);
        slowedDown([&server] { return clearTheQueue(server); }, log.calls);
    }
}
