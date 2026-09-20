// GET /api/state and the three /api/library/* routes over a real socket. library_test.cpp
// covers the snapshot, the deltas and the wire format; what these add is which status a
// client sees, that a refused request never reaches the snapshot or the player, and that a
// re-poll costs nothing.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/library.h"
#include "core/player_state.h"
#include "core/text.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iterator>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kTitle[] = "%title%";
constexpr char kPlays[] = "%play_count%";

// The declaration the fixture library is built from, percent-encoded as a client sends it.
constexpr char kExport[] = "/api/library/export?columns=%25title%25&columns=%25play_count%25";

TestServer serving(Library* library, const Player& player = {}) {
    return TestServer(servingSettings(), player, library);
}

TestServer serving(Library* library, PlayerStateStore* playerState) {
    return TestServer(servingSettings(), Player{}, library, countingMint(), playerState);
}

TestServer serving(Library* library, const Player& player, PlayerStateStore* playerState) {
    return TestServer(servingSettings(), player, library, countingMint(), playerState);
}

httplib::Result getHolding(const TestServer& server, const std::string& path,
                           const std::string& tag) {
    auto headers = TestServer::bearer();
    headers.emplace("If-None-Match", tag);
    return server.client().Get(path, headers);
}

httplib::Result refresh(const TestServer& server) {
    return post(server, "/api/library/refresh", "");
}

// Three tracks and two columns, so a delta can move one column and leave the other alone,
// which is the case the per-column format exists for. The third track's play count is the
// unresolved sentinel, which is what capability detection reads.
void fill(Library& library) {
    LibraryBuilder builder({kTitle, kPlays}, 3);
    auto& sink = builder.sink();
    sink.row(0, {"Artist/Album/", "01.flac", "0", "One", "4"});
    sink.row(1, {"Artist/Album/", "02.flac", "0", "Two", "0"});
    sink.row(2, {"Artist/Other/", "03.flac", "0", "Three", "?"});

    library.replace(builder.finish());
}

void fillPastTheCap(Library& library) {
    constexpr size_t kValueBytes = size_t{1024} * 1024;
    const size_t rows = (kMaxLibraryBytes / kValueBytes) + 4;

    LibraryBuilder builder({kTitle}, rows);
    auto& sink = builder.sink();
    for (size_t index = 0; index < rows; ++index) {
        const auto ordinal = std::to_string(index);
        sink.row(index, {"Artist/Album/", ordinal + ".flac", "0",
                         ordinal + std::string(kValueBytes, 'x')});
    }

    library.replace(builder.finish());
}

// A player halfway through a track, with its position marked well in the past so that a
// component reporting where playback would be now rather than where the mark was taken would
// report a different number on every poll.
PlayerState playing() {
    constexpr std::chrono::seconds kMarkAge{30};

    PlayerState state;
    state.playback = PlaybackState::playing;
    state.path = R"(X:\music\one.flac)";
    state.position.seconds = 42.5;
    state.position.taken = std::chrono::steady_clock::now() - kMarkAge;
    state.duration = 210;
    state.volume = -6;
    state.playbackMode = "repeatAll";
    return state;
}

constexpr char kSongTitle[] = "Salt Flats";
constexpr char kSongArtist[] = "The Vela Ensemble";

json playerSection(const TestServer& server) {
    const auto response = get(server, "/api/state");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["player"];
}

constexpr char kPlayingPlaylistId[] = "6f1c0b8a-2d4e-4f7a-9c31-0ab5e8d24f60";
constexpr uint32_t kPlayingRow = 12;

// beefweb's own id for the same playlist, which this component holds beside the GUID and which
// is the one thing that may not cross: a client joining on it joins on the world being removed.
constexpr char kBeefwebPlaylistId[] = "p37";

Player listingThePlayingPlaylist() {
    return TestServer::listing([] {
        PlaylistAnnotation playlist;
        playlist.id = kPlayingPlaylistId;
        playlist.beefwebId = kBeefwebPlaylistId;
        playlist.title = "Evening";
        return PlaylistsResult{PlaylistOutcome::done, {playlist}};
    });
}

PlayerState playingFromThePlaylist() {
    PlayerState state = playing();
    state.playingLocation = PlayingLocation{kPlayingPlaylistId, kPlayingRow};
    return state;
}

std::vector<QueueEntry> oneQueued() {
    QueueEntry entry;
    entry.path = R"(X:\music\two.flac)";
    return {entry};
}

std::vector<PlaylistMark> oneListed() {
    return {PlaylistMark{kPlayingPlaylistId, "Evening", 1, 1}};
}

bool mentions(const std::string& body, const std::string& text) {
    return toLower(body).find(toLower(text)) != std::string::npos;
}

std::set<std::string> keysOf(const json& object) {
    std::set<std::string> keys;
    for (const auto& field : object.items())
        keys.insert(field.key());
    return keys;
}

uint64_t playOne(Library& library, const std::string& count) {
    return library.apply({{0, {"Artist/Album/", "01.flac", "0", "One", count}}});
}

// cpp-httplib emits one field line per set_header, and applyCors has already put Origin in one
// of them, so the header a cache reads as a list arrives here as two entries.
bool variesOnEncoding(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Vary"); ++at) {
        if (response.get_header_value("Vary", "", at) == "Accept-Encoding")
            return true;
    }

    return false;
}

constexpr int kPollBurst = 30;
constexpr int kPollsPastTheBudget = 30;

constexpr char kOrigin[] = "https://jean.example";

httplib::Headers bearerFrom(const char* origin) {
    auto headers = TestServer::bearer();
    headers.emplace("Origin", origin);
    return headers;
}

std::optional<httplib::Response> pollPastTheBudget(
    httplib::Client& client, const httplib::Headers& headers = TestServer::bearer()) {
    for (int attempt = 0; attempt < kPollBurst + kPollsPastTheBudget; attempt++) {
        const auto response = client.Get("/api/state", headers);
        if (response && response->status == 429)
            return *response;
    }

    return std::nullopt;
}

// A client that does not ask to keep its connection is answered `Connection: close` whatever the
// route decided, because cpp-httplib echoes back the close the client itself sent. httplib::Client
// sends one by default, so a case about keep-alive has to turn that off or it reads its own header.
httplib::Client polling(const TestServer& server) {
    auto client = server.client();
    client.set_keep_alive(true);
    return client;
}

bool endsTheConnection(const httplib::Response& response) {
    for (size_t at = 0; at < response.get_header_value_count("Connection"); ++at) {
        for (const auto& option : splitOn(response.get_header_value("Connection", "", at), ','))
            if (equalsIgnoringCase(option, "close"))
                return true;
    }

    return false;
}

// One socket answering both stacks, which is how a test reaches the component from two source
// addresses without an interface alias: 127.0.0.1 arrives as ::ffff:127.0.0.1 and ::1 as itself.
// cpp-httplib sets IPV6_V6ONLY to 0 on a listening socket unless it is told otherwise.
TestServer servingBothStacks(Library* library) {
    Settings settings = servingSettings();
    settings.bindAddress = "::";
    return TestServer(std::move(settings), Player{}, library);
}

httplib::Client overIpv6(const TestServer& server) {
    httplib::Client client("::1", server.port());
    client.set_connection_timeout(2, 0);
    client.set_read_timeout(5, 0);
    return client;
}

bool isDelaySeconds(const std::string& value) {
    return !value.empty() &&
           std::all_of(value.begin(), value.end(), [](char c) { return c >= '0' && c <= '9'; });
}

struct BuildLog {
    int calls = 0;
    std::vector<std::string> columns;
    std::vector<RebuildReason> reasons;
};

Player building(BuildLog* log) {
    Player player;
    player.refreshLibrary = [log](std::vector<std::string> columns, RebuildReason why) {
        log->calls++;
        log->columns = std::move(columns);
        log->reasons.push_back(why);
    };
    return player;
}

}  // namespace

TEST_CASE("the poll document carries both generations and the set that is ready") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body)["library"];
    CHECK(body["ready"] == true);
    CHECK(body["structure"] == 1);
    CHECK(body["revision"] == 1);
    CHECK(body["trackCount"] == 3);
    CHECK(body["columns"] == json::array({kTitle, kPlays}));
}

TEST_CASE("the poll document carries what the player is doing beside the library's generations") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body.contains("player"));

    REQUIRE(body.contains("library"));
    CHECK(body["library"] == json{{"ready", true},
                                  {"structure", 1},
                                  {"revision", 1},
                                  {"trackCount", 3},
                                  {"columns", json::array({kTitle, kPlays})}});
}

// The first poll of a component that has just started, before a playback callback has fired.
// A client has to be able to draw "nothing is playing" from it, and a section that is absent or
// null leaves it nothing to draw from.
TEST_CASE("a player with nothing playing still answers a player section a client can draw") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    const auto body = json::parse(response->body);
    REQUIRE(body.contains("player"));

    const auto player = body["player"];
    REQUIRE(player.is_object());

    const std::vector<std::string> published = {"playback", "path",   "subsong", "position",
                                                "duration", "volume", "muted",   "playbackMode"};
    for (const std::string& field : published) {
        INFO("field: ", field);
        REQUIRE(player.contains(field));
    }

    CHECK(player["playback"] == "stopped");
    CHECK(player["path"] == "");
    CHECK(player["subsong"] == 0);
    CHECK(player["duration"] == 0);
    CHECK(player["volume"] == 0);
    CHECK(player["muted"] == false);
    CHECK(player["playbackMode"] == nullptr);
}

// A steady_clock time point means nothing on another machine, so what crosses the wire is how old
// the mark is when the response is built, and the client adds its own elapsed time to that. The
// default time point is the clock's epoch, which is the machine's boot on Windows and on macOS,
// so a mark nobody has taken yet reports an uptime unless the component says there is no age.
TEST_CASE("the position is a mark with how old it is, never a number the server advanced") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    const auto body = json::parse(response->body);
    REQUIRE(body.contains("player"));
    REQUIRE(body["player"].contains("position"));

    const auto position = body["player"]["position"];
    REQUIRE(position.is_object());
    REQUIRE(position.contains("seconds"));
    REQUIRE(position.contains("ageSeconds"));
    CHECK(position["seconds"] == 0);

    // The document is built in microseconds, so anything approaching a second is an uptime.
    constexpr double kFreshSeconds = 1;
    const double age = position["ageSeconds"].get<double>();
    CHECK(age >= 0);
    CHECK(age < kFreshSeconds);
}

// A pause and a stop are different things to a person, and a client has to be able to tell them
// apart from the document rather than by guessing from an empty path.
TEST_CASE("a paused player publishes the track it is holding, and the document says paused") {
    Library library;
    fill(library);
    PlayerStateStore store;
    const PlayerState started = playing();
    store.publish(started);
    const TestServer server = serving(&library, &store);

    constexpr std::chrono::seconds kRanOnFor{10};
    store.paused(started.position.taken + kRanOnFor);

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto player = json::parse(response->body)["player"];
    CHECK(player["playback"] == "paused");
    CHECK(player["path"] == R"(X:\music\one.flac)");
    CHECK(player["duration"] == 210);
    CHECK(player["position"]["seconds"].get<double>() ==
          doctest::Approx(started.position.seconds + kRanOnFor.count()));
}

TEST_CASE("a stopped player publishes no track, and the document says stopped") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    store.stopped();

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto player = json::parse(response->body)["player"];
    CHECK(player["playback"] == "stopped");
    CHECK(player["path"] == "");
    CHECK(player["duration"] == 0);
    CHECK(player["position"]["seconds"] == 0);
    CHECK(player["volume"] == -6);

    // The mark goes with the position it dates. One left standing publishes a position of zero
    // aged by however long the track had been playing, which a client interpolates forward.
    constexpr double kFreshSeconds = 1;
    CHECK(player["position"]["ageSeconds"].get<double>() < kFreshSeconds);
}

TEST_CASE("the poll document names the playing track, whether the media library holds it or not") {
    Library library;
    fill(library);
    PlayerStateStore store;
    PlayerState started = playing();
    started.title = kSongTitle;
    started.artist = kSongArtist;
    store.publish(started);
    const TestServer server = serving(&library, &store);

    const auto player = playerSection(server);
    REQUIRE(player.contains("title"));
    REQUIRE(player.contains("artist"));

    CHECK(player["title"] == kSongTitle);
    CHECK(player["artist"] == kSongArtist);
    CHECK(player["path"] == started.path);
}

// A client that cannot tell an unnamed track from one named with an empty string draws a blank
// status bar for both, and only one of those is honest.
TEST_CASE("a name the player did not compute is null, never a missing key or an empty string") {
    Library library;
    fill(library);
    PlayerStateStore store;
    const TestServer server = serving(&library, &store);

    SUBCASE("the player named neither") {
        store.publish(playing());

        const auto player = playerSection(server);
        REQUIRE(player.contains("title"));
        REQUIRE(player.contains("artist"));
        CHECK(player["title"].is_null());
        CHECK(player["artist"].is_null());
    }

    SUBCASE("a title with no artist") {
        PlayerState started = playing();
        started.title = kSongTitle;
        store.publish(started);

        const auto player = playerSection(server);
        REQUIRE(player.contains("title"));
        REQUIRE(player.contains("artist"));
        CHECK(player["title"] == kSongTitle);
        CHECK(player["artist"].is_null());
    }

    SUBCASE("an artist with no title") {
        PlayerState started = playing();
        started.artist = kSongArtist;
        store.publish(started);

        const auto player = playerSection(server);
        REQUIRE(player.contains("title"));
        REQUIRE(player.contains("artist"));
        CHECK(player["artist"] == kSongArtist);
        CHECK(player["title"].is_null());
    }
}

TEST_CASE("the poll document places the playing track by the GUID GET /api/playlists answers") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playingFromThePlaylist());
    const TestServer server = serving(&library, listingThePlayingPlaylist(), &store);

    const auto listed = get(server, "/api/playlists");
    REQUIRE(listed);
    REQUIRE(listed->status == 200);

    const auto playlists = json::parse(listed->body)["playlists"];
    REQUIRE(playlists.size() == 1);

    const auto player = playerSection(server);
    REQUIRE(player.contains("playingLocation"));

    const auto location = player["playingLocation"];
    REQUIRE(location.is_object());
    CHECK(location["playlistId"] == playlists[0]["id"]);
    CHECK(location["index"] == kPlayingRow);
}

TEST_CASE("no part of the poll document carries the beefweb id the same playlist is listed under") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playingFromThePlaylist());
    const TestServer server = serving(&library, listingThePlayingPlaylist(), &store);

    const auto response = get(server, "/api/state");
    REQUIRE(response);
    REQUIRE(response->status == 200);

    INFO("beefweb id: ", kBeefwebPlaylistId);
    CHECK_FALSE(mentions(response->body, kBeefwebPlaylistId));
    CHECK_FALSE(mentions(response->body, "beefweb"));

    const auto location = json::parse(response->body)["player"]["playingLocation"];
    REQUIRE(location.is_object());
    CHECK(keysOf(location) == std::set<std::string>{"index", "playlistId"});
}

// The two states the "Playing from" line turns on. A place that is merely empty rather than
// absent reads as the first row of a playlist nobody can name.
TEST_CASE("a track playing from no playlist says so, rather than sitting at the first row of one") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playingFromThePlaylist());
    const TestServer server = serving(&library, listingThePlayingPlaylist(), &store);

    const auto fromAPlaylist = playerSection(server);

    store.playingLocationChanged(std::nullopt);
    const auto fromNowhere = playerSection(server);

    REQUIRE(fromAPlaylist.contains("playingLocation"));
    REQUIRE(fromNowhere.contains("playingLocation"));
    CHECK(fromAPlaylist["playingLocation"]["playlistId"] == kPlayingPlaylistId);
    CHECK(fromNowhere["playingLocation"].is_null());
}

// The spine is the component's own rather than something a client declared, so naming it in
// `columns` would make a client send it back and be told it had asked for a different set.
TEST_CASE("the poll document does not report the spine as a column") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    const auto columns = json::parse(response->body)["library"]["columns"];
    CHECK(std::find(columns.begin(), columns.end(), "directory") == columns.end());
}

TEST_CASE("a client that already holds a representation is answered without one") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    for (const char* path : {"/api/state", kExport}) {
        INFO("path: ", path);

        const auto first = get(server, path);
        REQUIRE(first);
        REQUIRE(first->status == 200);

        const auto tag = first->get_header_value("ETag");
        REQUIRE_FALSE(tag.empty());

        const auto again = getHolding(server, path, tag);
        REQUIRE(again);
        CHECK(again->status == 304);
        CHECK(again->body.empty());
        CHECK(again->get_header_value("ETag") == tag);
    }
}

TEST_CASE("a wildcard validator is honoured, as RFC 9110 requires") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = getHolding(server, "/api/state", "*");

    REQUIRE(response);
    CHECK(response->status == 304);
}

// The tag names the generations rather than the bytes, so anything that moves either of them
// has to invalidate it or a client keeps a stale library indefinitely.
TEST_CASE("a revision moving invalidates what a client was holding") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto first = get(server, kExport);
    REQUIRE(first);
    const auto tag = first->get_header_value("ETag");

    playOne(library, "5");

    const auto again = getHolding(server, kExport, tag);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);
}

// The library is left alone throughout, so a 200 here can only have come from the player half of
// the validator. Every movement gets a subcase, because one that the validator misses strands a
// client on a stale document until something else moves.
TEST_CASE("the player moving invalidates what a client was holding") {
    Library library;
    fill(library);
    PlayerStateStore store;
    const PlayerState started = playing();
    store.publish(started);
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    PlayerState moved = started;

    SUBCASE("another track starts") {
        moved.path = R"(X:\music\two.flac)";
        moved.duration = 185;
        moved.position.seconds = 0;
    }
    SUBCASE("the player is paused") {
        moved.playback = PlaybackState::paused;
    }
    SUBCASE("somebody seeks") {
        moved.position.seconds = 90;
    }
    SUBCASE("the volume moves") {
        moved.volume = -12;
    }

    store.publish(moved);

    const auto again = getHolding(server, "/api/state", tag);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);
}

TEST_CASE("a conditional poll is a 200 when the playing row moved, a 304 until it moves again") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playingFromThePlaylist());
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    const PlayingLocation oneRowUp{kPlayingPlaylistId, kPlayingRow - 1};
    store.playingLocationChanged(oneRowUp);

    const auto moved = getHolding(server, "/api/state", tag);
    REQUIRE(moved);
    CHECK(moved->status == 200);

    const auto movedTag = moved->get_header_value("ETag");
    REQUIRE_FALSE(movedTag.empty());
    CHECK(movedTag != tag);

    const auto held = getHolding(server, "/api/state", movedTag);
    REQUIRE(held);
    CHECK(held->status == 304);
    CHECK(held->body.empty());

    store.playingLocationChanged(oneRowUp);

    const auto republished = getHolding(server, "/api/state", movedTag);
    REQUIRE(republished);
    CHECK(republished->status == 304);
    CHECK(republished->get_header_value("ETag") == movedTag);
}

// The 304 is what the poll is for, and the position is what threatens it. The mark's age is
// computed per request, so a validator taken from the document rather than from the two versions
// makes every poll of a playing player a 200 carrying the whole library section again.
TEST_CASE("an untouched player stays a 304, however old its position mark is") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    const auto second = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(second);
    REQUIRE(first->status == 200);
    REQUIRE(second->status == 200);
    REQUIRE(first->body != second->body);

    const auto held = getHolding(server, "/api/state", second->get_header_value("ETag"));
    REQUIRE(held);
    CHECK(held->status == 304);
    CHECK(held->body.empty());
}

// The number a client refetches the queue on. A revision carried by the player version would move
// on every seek and send the client for a queue that had not changed.
TEST_CASE("the poll document's queue revision moves with the queue and not with the player") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto before = playerSection(server);
    REQUIRE(before.contains("queueRevision"));
    REQUIRE(before["queueRevision"].is_number_unsigned());

    store.seeked(90, std::chrono::steady_clock::now());
    const auto afterTheSeek = playerSection(server);

    store.queueChanged(oneQueued());
    const auto afterTheQueue = playerSection(server);

    REQUIRE(afterTheSeek.contains("queueRevision"));
    REQUIRE(afterTheQueue.contains("queueRevision"));
    CHECK(afterTheSeek["queueRevision"] == before["queueRevision"]);
    CHECK(afterTheQueue["queueRevision"].get<uint64_t>() >
          afterTheSeek["queueRevision"].get<uint64_t>());
}

TEST_CASE("a conditional poll is a 200 when the queue changed, and a 304 when it did not") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    store.queueChanged(oneQueued());

    const auto queued = getHolding(server, "/api/state", tag);
    REQUIRE(queued);
    CHECK(queued->status == 200);

    const auto queuedTag = queued->get_header_value("ETag");
    REQUIRE_FALSE(queuedTag.empty());
    CHECK(queuedTag != tag);

    store.queueChanged(oneQueued());

    const auto unchanged = getHolding(server, "/api/state", queuedTag);
    REQUIRE(unchanged);
    CHECK(unchanged->status == 304);
    CHECK(unchanged->get_header_value("ETag") == queuedTag);
}

TEST_CASE("the poll's playlists revision moves with the playlists and not with the player") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto before = playerSection(server);
    REQUIRE(before.contains("playlistsRevision"));
    REQUIRE(before["playlistsRevision"].is_number_unsigned());

    store.seeked(90, std::chrono::steady_clock::now());
    const auto afterTheSeek = playerSection(server);

    store.playlistsChanged(oneListed());
    const auto afterTheList = playerSection(server);

    REQUIRE(afterTheSeek.contains("playlistsRevision"));
    REQUIRE(afterTheList.contains("playlistsRevision"));
    CHECK(afterTheSeek["playlistsRevision"] == before["playlistsRevision"]);
    CHECK(afterTheList["playlistsRevision"].get<uint64_t>() >
          afterTheSeek["playlistsRevision"].get<uint64_t>());
}

// The two counters that may stay numbers, and the line that decides it. A playlist's own
// structure generation and content revision are seeded so that neither repeats across a restart
// of this component, which puts them past 2^53, where a JSON number stops being exact, so those
// two travel as strings of decimal digits. These two are inside 2^53 and exact, and the cases
// above compare them for order. The mistake this catches is converting every counter together on
// the grounds that counters should look alike: it would take the ordering away for nothing.
TEST_CASE("the poll's two revisions are numbers, where a playlist's own counters are not") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto player = playerSection(server);
    REQUIRE(player.contains("queueRevision"));
    REQUIRE(player.contains("playlistsRevision"));

    INFO("queueRevision: ", player["queueRevision"].dump(),
         ", playlistsRevision: ", player["playlistsRevision"].dump());

    CHECK(player["queueRevision"].is_number_unsigned());
    CHECK(player["playlistsRevision"].is_number_unsigned());
}

TEST_CASE("the player section names the playlists revision once and carries nothing else new") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playingFromThePlaylist());
    store.playlistsChanged(oneListed());
    const TestServer server = serving(&library, listingThePlayingPlaylist(), &store);

    const std::set<std::string> published = {
        "playback",        "path",          "subsong",           "position",
        "duration",        "volume",        "muted",             "playbackMode",
        "title",           "artist",        "playingLocation",   "queueRevision",
        "playlistsRevision"};

    CHECK(keysOf(playerSection(server)) == published);
}

TEST_CASE("a conditional poll is a 200 when the playlists changed, and a 304 when they did not") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    store.playlistsChanged(oneListed());

    const auto listed = getHolding(server, "/api/state", tag);
    REQUIRE(listed);
    CHECK(listed->status == 200);

    const auto listedTag = listed->get_header_value("ETag");
    REQUIRE_FALSE(listedTag.empty());
    CHECK(listedTag != tag);

    store.playlistsChanged(oneListed());

    const auto unchanged = getHolding(server, "/api/state", listedTag);
    REQUIRE(unchanged);
    CHECK(unchanged->status == 304);
    CHECK(unchanged->get_header_value("ETag") == listedTag);
}

// One document carries both halves, so a validator that stopped reporting the library when the
// player was folded into it would leave every library view stale until the player moved.
TEST_CASE("either library generation moving invalidates what a client was holding") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    SUBCASE("a track's data changed") {
        playOne(library, "5");
    }
    SUBCASE("the snapshot was rebuilt") {
        fill(library);
    }

    const auto again = getHolding(server, "/api/state", tag);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);
}

TEST_CASE("the export is the snapshot, framed as contract/openapi.yaml describes it") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, kExport);

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/octet-stream");
    CHECK(response->get_header_value("Cache-Control") == "no-cache, must-revalidate");

    const auto header = decode(response->body).header;
    CHECK(header["kind"] == "snapshot");
    CHECK(header["trackCount"] == 3);
    CHECK(columnNames(header) == std::vector<std::string>{kTitle, kPlays});
    CHECK(header["spine"]["directory"]["distinct"] == 2);
    CHECK(header["columns"][1]["hasUnresolved"] == true);
}

TEST_CASE("both binary routes are gzipped for a client that offers it") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto from = playOne(library, "5") - 1;

    for (const std::string& path :
         {std::string(kExport), "/api/library/changes?since=" + std::to_string(from)}) {
        INFO("path: ", path);

        const auto packed = undecoding(server).Get(path, accepting("gzip"));
        const auto plain = undecoding(server).Get(path, accepting("identity"));

        REQUIRE(packed);
        REQUIRE(plain);
        CHECK(packed->status == 200);
        CHECK(packed->get_header_value("Content-Encoding") == "gzip");
        CHECK(isGzip(packed->body));
        CHECK(packed->body.size() < plain->body.size());
    }
}

TEST_CASE("a client that does not offer gzip is sent the frame as it stands") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    for (const char* offer : {"identity", "", "deflate, br"}) {
        INFO("Accept-Encoding: ", offer);

        const auto response = undecoding(server).Get(kExport, accepting(offer));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(response->get_header_value("Content-Encoding").empty());
        CHECK_FALSE(isGzip(response->body));
        CHECK(decode(response->body).header["kind"] == "snapshot");
    }
}

TEST_CASE("gzip offered with a weight of zero is a refusal rather than a preference") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto refused = undecoding(server).Get(kExport, accepting("gzip;q=0, identity"));
    REQUIRE(refused);
    CHECK(refused->get_header_value("Content-Encoding").empty());

    const auto ranked = undecoding(server).Get(kExport, accepting("gzip;q=0.5, identity;q=0.1"));
    REQUIRE(ranked);
    CHECK(ranked->get_header_value("Content-Encoding") == "gzip");
}

// One gunzip, not two: this is what pins cpp-httplib's refusal to compress a response whose
// handler already set Content-Encoding, which an upgrade could take away.
TEST_CASE("the gzipped snapshot decodes to exactly the bytes the plain one carried") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto plain = undecoding(server).Get(kExport, accepting("identity"));
    const auto decoded = server.client().Get(kExport, accepting("gzip"));

    REQUIRE(plain);
    REQUIRE(decoded);
    REQUIRE(decoded->get_header_value("Content-Encoding") == "gzip");
    CHECK(decoded->body == plain->body);
    CHECK(decode(decoded->body).header["kind"] == "snapshot");
}

TEST_CASE("each coding gets its own validator, and every answer says the body depends on it") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    for (const char* path : {"/api/state", kExport}) {
        INFO("path: ", path);

        const auto packed = undecoding(server).Get(path, accepting("gzip"));
        const auto plain = undecoding(server).Get(path, accepting("identity"));

        REQUIRE(packed);
        REQUIRE(plain);
        CHECK_FALSE(packed->get_header_value("ETag").empty());
        CHECK(packed->get_header_value("ETag") != plain->get_header_value("ETag"));
        CHECK(variesOnEncoding(*packed));
        CHECK(variesOnEncoding(*plain));

        auto crossed = accepting("gzip");
        crossed.emplace("If-None-Match", plain->get_header_value("ETag"));

        const auto answered = undecoding(server).Get(path, crossed);
        REQUIRE(answered);
        CHECK(answered->status == 200);
        CHECK(answered->get_header_value("Content-Encoding") == "gzip");
    }
}

// kMaxLibraryBytes bounds what the component serialised and what a client has to hold once it
// has decoded, so a body that gzips to a few kilobytes is refused all the same.
TEST_CASE("the size cap is on the serialised snapshot rather than on what goes over the wire") {
    Library library;
    fillPastTheCap(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/export?columns=%25title%25");

    REQUIRE(response);
    CHECK(response->status == 413);
    CHECK(json::parse(response->body)["error"] ==
          "the library snapshot is larger than this component sends");
    CHECK(response->get_header_value("ETag").empty());
}

// Order decides where a column lands in the snapshot's array and nothing else, so two
// requests that differ only in it are the same declaration.
TEST_CASE("the order columns are named in does not make a different declaration") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    const auto response =
        get(server, "/api/library/export?columns=%25play_count%25&columns=%25title%25");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(log.calls == 0);
}

// The export request is the declaration, so a set nobody has built yet is not a refusal: it
// is a wait, and the client is told what is ready so it knows what to poll for.
TEST_CASE("asking for a set that is not ready starts building exactly that set") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    const auto response = get(server, "/api/library/export?columns=%25genre%25");

    REQUIRE(response);
    CHECK(response->status == 202);
    CHECK(log.calls == 1);
    CHECK(log.columns == std::vector<std::string>{"%genre%"});

    const auto body = json::parse(response->body);
    CHECK(body["ready"] == true);
    CHECK(body["columns"] == json::array({kTitle, kPlays}));
}

// Otherwise a client polling by re-asking would start a rebuild per attempt, and a library
// walk is the most expensive thing this component can be asked for.
TEST_CASE("asking again for a set already building does not start a second build") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    for (int attempt = 0; attempt < 4; ++attempt) {
        const auto response = get(server, "/api/library/export?columns=%25genre%25");
        REQUIRE(response);
        CHECK(response->status == 202);
    }

    CHECK(log.calls == 1);
}

TEST_CASE("a 202 the player cannot honour is not made") {
    Library library;
    const TestServer server = serving(&library);

    const auto response = get(server, kExport);

    REQUIRE(response);
    CHECK(response->status == 503);
    CHECK(json::parse(response->body)["error"] == "the media library is not available");
}

TEST_CASE("an export must say what it wants") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/export");

    REQUIRE(response);
    CHECK(response->status == 400);

    const auto body = json::parse(response->body);
    CHECK(body["error"] == "unacceptable column");
    CHECK(body["detail"] == "'columns' is required");
}

// CONTRIBUTING.md, *Security rules*: refuse before doing. An install with the feature switched
// off answers 503, so a malformed request answered 400 there is the proof that validation ran
// before anything looked at a snapshot.
TEST_CASE("a malformed request is refused before the snapshot is consulted") {
    const TestServer off = serving(nullptr);

    const auto overlong =
        get(off, "/api/library/export?columns=" + std::string(kMaxColumnLength + 1, 'x'));
    REQUIRE(overlong);
    CHECK(overlong->status == 400);
    CHECK(json::parse(overlong->body)["error"] == "unacceptable column");

    const auto notANumber = get(off, "/api/library/changes?since=soon");
    REQUIRE(notANumber);
    CHECK(notANumber->status == 400);
    CHECK(json::parse(notANumber->body)["error"] == "unacceptable revision");
}

// cpp-httplib drops a query pair whose raw text exactly repeats an earlier one, so the same
// column sent twice never reaches the component at all. Two spellings of one column do, and
// that is the case the refusal exists for.
TEST_CASE("one column named twice is refused, however it was spelled") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    auto raw = server.client();
    raw.set_path_encode(false);

    const auto spelled = raw.Get("/api/library/export?columns=a&columns=%61", TestServer::bearer());
    REQUIRE(spelled);
    CHECK(spelled->status == 400);
    CHECK(json::parse(spelled->body)["error"] == "duplicate column");
    CHECK(log.calls == 0);

    const auto collapsed = get(server, "/api/library/export?columns=a&columns=a");
    REQUIRE(collapsed);
    CHECK(collapsed->status == 202);
    CHECK(log.columns == std::vector<std::string>{"a"});
}

TEST_CASE("a delta names the columns that moved and no others") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto from = playOne(library, "5") - 1;

    const auto response = get(server, "/api/library/changes?since=" + std::to_string(from));

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/octet-stream");

    const auto header = decode(response->body).header;
    CHECK(header["kind"] == "delta");
    CHECK(header["since"] == from);
    CHECK(columnNames(header) == std::vector<std::string>{kPlays});
    CHECK(header["spine"].empty());
    CHECK(header["columns"][0]["ordinals"]["count"] == 1);
}

TEST_CASE("a delta must say what it is catching up from") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/changes");

    REQUIRE(response);
    CHECK(response->status == 400);

    const auto body = json::parse(response->body);
    CHECK(body["error"] == "unacceptable revision");
    CHECK(body["detail"] == "'since' is required");
}

// A rebuild with a different set moves `structure`, so a client holding the wrong one reaches
// this rather than a refusal of its own. Its next move is the same either way: export.
TEST_CASE("a client whose ordinals have shifted is told to export rather than patched") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, "/api/library/changes?since=0");

    REQUIRE(response);
    CHECK(response->status == 409);
    CHECK(json::parse(response->body)["error"] ==
          "tracks were added or removed; export the library again");
}

TEST_CASE("a client too far behind to be patched is told so, and so is one from the future") {
    Library library(1);
    fill(library);
    const TestServer server = serving(&library);

    playOne(library, "5");
    const auto current = playOne(library, "6");

    const auto behind = get(server, "/api/library/changes?since=1");
    REQUIRE(behind);
    CHECK(behind->status == 410);
    CHECK(json::parse(behind->body)["error"] ==
          "that revision is older than the retained window; export the library again");

    const auto ahead = get(server, "/api/library/changes?since=" + std::to_string(current + 1));
    REQUIRE(ahead);
    CHECK(ahead->status == 410);
    CHECK(json::parse(ahead->body)["error"] == "no such revision");
}

// The player can walk its library here, so each route's own guard is the only thing left to
// answer 503: one relaxed along with GET /state sends a client an export of nothing, or starts a
// walk on an install that has no library to walk.
TEST_CASE("an install with the library switched off says so on every library route") {
    BuildLog log;
    const TestServer off = serving(nullptr, building(&log));

    const auto unavailable = [](const httplib::Result& answer) {
        REQUIRE(answer);
        CHECK(answer->status == 503);
        CHECK(json::parse(answer->body)["error"] == "the media library is not available");
    };

    unavailable(get(off, kExport));
    unavailable(get(off, "/api/library/changes?since=1"));
    unavailable(refresh(off));
    CHECK(log.calls == 0);
}

// A player with no media library is still a player, and the poll is the only thing telling a
// client what it is doing. A 200 carrying a stopped player would pass the status code and leave
// the status bar blank, so the store is driven through a playing track and the section has to
// report it.
TEST_CASE("a player with no media library still answers what it is playing") {
    PlayerStateStore store;
    const PlayerState started = playing();
    store.publish(started);
    const TestServer server = serving(nullptr, &store);

    const auto response = get(server, "/api/state");

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    REQUIRE(body.contains("player"));

    const auto player = body["player"];
    CHECK(player["playback"] == "playing");
    CHECK(player["path"] == started.path);
    CHECK(player["position"]["seconds"] == started.position.seconds);
    CHECK(player["duration"] == started.duration);
    CHECK(player["volume"] == started.volume);
    CHECK(player["muted"] == started.muted);
    CHECK(player["playbackMode"] == *started.playbackMode);

    REQUIRE(body.contains("library"));
    CHECK(body["library"] == json{{"ready", false},
                                  {"structure", 0},
                                  {"revision", 0},
                                  {"trackCount", 0},
                                  {"columns", json::array()}});
}

// Every other validator case fills the library, so this is the one where the player half of the
// tag is the only half that can move. A component reaching for a generation it has no library to
// read would hand a client the same tag whatever the player did.
TEST_CASE("the validator still moves with the player when there is no media library") {
    PlayerStateStore store;
    const PlayerState started = playing();
    store.publish(started);
    const TestServer server = serving(nullptr, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    const auto untouched = getHolding(server, "/api/state", tag);
    REQUIRE(untouched);
    CHECK(untouched->status == 304);
    CHECK(untouched->body.empty());

    PlayerState moved = started;
    moved.playback = PlaybackState::paused;
    store.publish(moved);

    const auto again = getHolding(server, "/api/state", tag);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);
    CHECK(json::parse(again->body)["player"]["playback"] == "paused");
}

// The one state where the routes disagree on purpose: a client declares at the export route
// and waits at GET /state, and there is nothing yet for a delta to be a delta against.
TEST_CASE("a library that has not been built yet is a wait rather than an absence") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    const auto polled = get(server, "/api/state");
    REQUIRE(polled);
    CHECK(polled->status == 200);
    CHECK(json::parse(polled->body)["library"]["ready"] == false);
    CHECK(json::parse(polled->body)["library"]["structure"] == 0);

    const auto exported = get(server, kExport);
    REQUIRE(exported);
    CHECK(exported->status == 202);
    CHECK(log.columns == std::vector<std::string>{kTitle, kPlays});

    const auto patched = get(server, "/api/library/changes?since=1");
    REQUIRE(patched);
    CHECK(patched->status == 503);
    CHECK(json::parse(patched->body)["error"] == "the library snapshot has not been built yet");
}

TEST_CASE("a refresh reproduces the set a client last declared, as a change in the data") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    REQUIRE(get(server, "/api/library/export?columns=%25genre%25"));

    const auto response = refresh(server);

    REQUIRE(response);
    CHECK(response->status == 202);
    CHECK(log.calls == 2);
    CHECK(log.columns == std::vector<std::string>{"%genre%"});
    CHECK(log.reasons.front() == RebuildReason::columnsDeclared);
    CHECK(log.reasons.back() == RebuildReason::dataChanged);
    CHECK(json::parse(response->body)["structure"] == 1);
}

// Otherwise a refresh from a client that has not exported yet would replace a good snapshot
// with one built from nothing.
TEST_CASE("a refresh before anything is declared rebuilds what is already there") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    REQUIRE(refresh(server));

    CHECK(log.columns == std::vector<std::string>{kTitle, kPlays});
}

TEST_CASE("a refresh the player cannot make is refused rather than pretended") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = refresh(server);

    REQUIRE(response);
    CHECK(response->status == 503);
}

// Rule 5 of CONTRIBUTING.md, *Tests*: answering 429 and not walking the player's whole library
// are different promises, and only the second is the feature.
TEST_CASE("a client looping on refresh stops reaching the player") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));

    constexpr int kAttempts = 8;
    int refused = 0;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = refresh(server);
        REQUIRE(response);

        if (response->status == 429) {
            refused++;
            CHECK(response->get_header_value("Retry-After") == "30");
            CHECK(json::parse(response->body)["error"] == "too many library refreshes");
        }
    }

    CHECK(refused > 0);
    CHECK(log.calls == kAttempts - refused);
}

// Varying the set declared is the other way to ask for repeated library walks, and it spends
// the same bucket the refresh route does rather than a second one.
TEST_CASE("a client varying the set it declares stops reaching the player too") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    constexpr int kAttempts = 8;
    int refused = 0;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response =
            get(server, "/api/library/export?columns=%25genre" + std::to_string(attempt) + "%25");
        REQUIRE(response);

        if (response->status == 429)
            refused++;
    }

    CHECK(refused > 0);
    CHECK(log.calls == kAttempts - refused);
}

// The poll is the one route a client asks for on a timer, so a client bug turns into a request per
// millisecond. Rule 5 of CONTRIBUTING.md, *Tests*: answering 429 and not building the document are
// different promises, and the second is what keeps a looping client off the rest of the component.
TEST_CASE("a burst of polls past the budget is refused rather than served") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    std::optional<httplib::Response> refusal;

    for (int attempt = 0; attempt < kPollBurst + kPollsPastTheBudget; attempt++) {
        INFO("poll: ", attempt);

        const auto response = get(server, "/api/state");
        REQUIRE(response);

        if (attempt < kPollBurst) {
            CHECK(response->status == 200);
            continue;
        }

        if (response->status == 429 && !refusal)
            refusal = *response;
    }

    REQUIRE(refusal.has_value());
    CHECK(refusal->get_header_value("ETag").empty());

    const auto body = json::parse(refusal->body);
    CHECK_FALSE(body.contains("player"));
    CHECK_FALSE(body.contains("library"));
}

// A refusal a client cannot render is a client that stops updating with nothing on screen. It needs
// three things: a delay it can wait, a reason it can tell from the component's other refusals, and
// the delay readable from script on another origin, since a browser hands over no other headers.
TEST_CASE("a refused poll says how long to wait and why, where a browser can read both") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    auto client = server.client();
    const auto refusal = pollPastTheBudget(client, bearerFrom(kOrigin));
    REQUIRE(refusal.has_value());

    const auto wait = refusal->get_header_value("Retry-After");
    INFO("Retry-After: ", wait);

    // RFC 9110 allows an HTTP-date here as well, and the component's other two refusals send
    // delay-seconds. A client written to read one form cannot read the other.
    REQUIRE(isDelaySeconds(wait));

    // Zero tells a client to come straight back, which is the loop the budget exists to stop, and a
    // wait longer than this leaves a poll dead for minutes over a burst that refills in seconds.
    constexpr int kLongestUsefulWait = 60;
    const int seconds = std::stoi(wait);
    CHECK(seconds >= 1);
    CHECK(seconds <= kLongestUsefulWait);

    CHECK(refusal->get_header_value("Content-Type") == "application/json");

    const auto body = json::parse(refusal->body);
    REQUIRE(body.contains("error"));
    REQUIRE(body["error"].is_string());
    CHECK_FALSE(body["error"].get<std::string>().empty());
    CHECK(body["error"] != "too many library refreshes");
    CHECK(body["error"] != "too many artwork requests");

    const auto exposed = refusal->get_header_value("Access-Control-Expose-Headers");
    INFO("exposed: ", exposed);
    CHECK(exposed.find("Retry-After") != std::string::npos);
}

// The reason the bucket is keyed on the source address rather than held once for the route: a phone
// left looping in a pocket must not stop the laptop in the next room from seeing the player. One
// socket serves both stacks here, so the two clients arrive on two addresses over a real connection.
TEST_CASE("a client on another address polls on while one is being refused") {
    Library library;
    fill(library);
    const TestServer server = servingBothStacks(&library);
    REQUIRE(server.status().listening);

    auto elsewhere = overIpv6(server);

    INFO("the second address is ::1, reached through a dual-stack bind");
    const auto reachable = elsewhere.Get("/api/state", TestServer::bearer());
    REQUIRE(reachable);
    REQUIRE(reachable->status == 200);

    auto looping = server.client();
    REQUIRE(pollPastTheBudget(looping).has_value());

    const auto unaffected = elsewhere.Get("/api/state", TestServer::bearer());
    REQUIRE(unaffected);
    CHECK(unaffected->status == 200);

    const auto stillRefused = looping.Get("/api/state", TestServer::bearer());
    REQUIRE(stillRefused);
    CHECK(stillRefused->status == 429);
}

// cpp-httplib gives one pooled thread the whole life of a socket, keep-alive loop included, so a
// client polling faster than the keep-alive window holds a thread for as long as it polls, which is
// the cost the poll was chosen over a subscription to avoid. All three answers a poller meets are
// here, because a fix on the document alone leaves the two it meets most often idling on a socket.
TEST_CASE("the answer to a poll ends its connection rather than waiting on it for the next one") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    auto client = polling(server);

    const auto document = client.Get("/api/state", TestServer::bearer());
    REQUIRE(document);
    REQUIRE(document->status == 200);

    SUBCASE("the document") {
        CHECK(endsTheConnection(*document));
    }

    SUBCASE("the 304 that says nothing moved") {
        auto headers = TestServer::bearer();
        headers.emplace("If-None-Match", document->get_header_value("ETag"));

        const auto again = client.Get("/api/state", headers);
        REQUIRE(again);
        REQUIRE(again->status == 304);
        CHECK(endsTheConnection(*again));
    }

    SUBCASE("the refusal a client polling too fast is sent") {
        const auto refusal = pollPastTheBudget(client);
        REQUIRE(refusal.has_value());
        CHECK(endsTheConnection(*refusal));
    }
}

// The connection the poll gives up is the poll's alone. An export is one request in a burst of
// them, and a client paying a fresh connection for each is what turning keep-alive down across the
// component would cost every route that asks in bursts.
TEST_CASE("an export is still answered on a connection a client may ask again on") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    auto client = polling(server);
    const auto response = client.Get(kExport, TestServer::bearer());

    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK_FALSE(endsTheConnection(*response));
}

TEST_CASE("no library route answers without a token") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto rejected = [](const httplib::Result& answer) {
        REQUIRE(answer);
        CHECK(answer->status == 401);
    };

    rejected(server.client().Get("/api/state"));
    rejected(server.client().Get(kExport));
    rejected(server.client().Get("/api/library/changes?since=1"));
    rejected(server.client().Post("/api/library/refresh", "", "application/json"));
}

TEST_CASE("the library is reported as a capability rather than discovered by a 503") {
    Library library;
    const TestServer on = serving(&library);
    const TestServer off = serving(nullptr);

    const auto reported = [](const TestServer& server) {
        const auto response = get(server, "/api/capabilities");
        REQUIRE(response);
        return json::parse(response->body)["canReadLibrary"].get<bool>();
    };

    CHECK(reported(on) == true);
    CHECK(reported(off) == false);
}

// The same comparison api_contract_test.cpp makes for the stream routes: every refusal these
// routes can make is driven, and the answer compared with what the specification publishes.
TEST_CASE("no library route answers a status contract/openapi.yaml does not document") {
    INFO("shape changed -- update contract/openapi.yaml to match");

    BuildLog log;
    Library library(1);
    const TestServer server = serving(&library, building(&log));
    const TestServer off = serving(nullptr);

    std::map<std::string, std::set<int>> seen;
    const auto note = [&seen](const std::string& route, const httplib::Result& response) {
        REQUIRE_MESSAGE(response, "no answer from ", route);
        seen[route].insert(response->status);
    };

    note("GET /state", get(server, "/api/state"));
    note("GET /state", server.client().Get("/api/state"));
    note("GET /state", get(off, "/api/state"));

    for (int attempt = 0; attempt < kPollBurst + kPollsPastTheBudget; ++attempt)
        note("GET /state", get(server, "/api/state"));

    note("GET /library/export", get(off, kExport));
    note("GET /library/export", get(server, "/api/library/export"));
    note("GET /library/export", get(server, kExport));
    note("GET /library/changes", get(server, "/api/library/changes?since=1"));

    fill(library);
    playOne(library, "5");
    playOne(library, "6");

    const auto exported = get(server, kExport);
    note("GET /library/export", exported);
    REQUIRE(exported);
    note("GET /library/export", getHolding(server, kExport, exported->get_header_value("ETag")));
    note("GET /library/export", server.client().Get(kExport));

    const auto delta = get(server, "/api/library/changes?since=2");
    note("GET /library/changes", delta);
    REQUIRE(delta);
    note("GET /library/changes",
         getHolding(server, "/api/library/changes?since=2", delta->get_header_value("ETag")));
    note("GET /library/changes", server.client().Get("/api/library/changes?since=2"));
    note("GET /library/changes", get(server, "/api/library/changes"));
    note("GET /library/changes", get(server, "/api/library/changes?since=0"));
    note("GET /library/changes", get(server, "/api/library/changes?since=99"));
    note("GET /library/changes", get(off, "/api/library/changes?since=1"));

    note("POST /library/refresh", refresh(server));
    note("POST /library/refresh",
         server.client().Post("/api/library/refresh", "", "application/json"));
    note("POST /library/refresh", refresh(off));

    for (int attempt = 0; attempt < 8; ++attempt) {
        note("POST /library/refresh", refresh(server));
        note("GET /library/export",
             get(server, "/api/library/export?columns=%25genre" + std::to_string(attempt) + "%25"));
    }

    for (const auto& route : publishedRoutes()) {
        if (route.path.rfind("/library", 0) != 0 && route.path != "/state")
            continue;

        const auto name = route.method + " " + route.path;
        INFO("route: ", name);

        REQUIRE_FALSE(seen[name].empty());

        std::set<int> undocumented;
        std::set_difference(seen[name].begin(), seen[name].end(), route.statuses.begin(),
                            route.statuses.end(), std::inserter(undocumented, undocumented.end()));

        CHECK(undocumented.empty());
    }
}
