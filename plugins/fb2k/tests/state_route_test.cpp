// GET /api/state and the three /api/library/* routes over a real socket. library_test.cpp
// covers the snapshot, the deltas and the wire format; what these add is which status a
// client sees, that a refused request never reaches the snapshot or the player, and that a
// re-poll costs nothing.

#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/library.h"
#include "core/player_state.h"
#include "core/text.h"
#include "core/timeline.h"
#include "support/fixtures.h"
#include "support/keys.h"
#include "support/log_capture.h"
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

constexpr char kAskEveryTime[] = "private, no-cache";

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
    return server.client().Get(path, httplib::Headers{{"If-None-Match", tag}});
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
constexpr char kSongAlbum[] = "Dry Season";
constexpr char kSongAlbumArtist[] = "Various Fictional Artists";

// The first row fill() puts in the snapshot: the library-relative address a rating is written to
// and the one GET /api/artwork?track= takes.
constexpr char kTrackTheLibraryHolds[] = "Artist/Album/01.flac";

// Shaped as foobar2000 prints an output module's GUID and a device's, joined by a colon.
constexpr char kSpeakers[] =
    "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{0E1D3C47-5A7B-4F21-9C3D-2B8E6F4A1D90}";
constexpr char kHeadphones[] =
    "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{7C2A9E14-3B6D-4E8F-A1C5-9D0B2F7E4A36}";

json playerSection(const TestServer& server) {
    const auto response = get(server, "/api/state");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body)["player"];
}

constexpr char kPlayingPlaylistId[] = "6f1c0b8a-2d4e-4f7a-9c31-0ab5e8d24f60";
constexpr uint32_t kPlayingRow = 12;

Player listingThePlayingPlaylist() {
    return TestServer::listing([] {
        PlaylistAnnotation playlist;
        playlist.id = kPlayingPlaylistId;
        playlist.title = "Evening";
        return PlaylistsResult{PlayerOutcome::done, {playlist}};
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

httplib::Headers withOrigin(const char* origin) {
    return httplib::Headers{{"Origin", origin}};
}

std::optional<httplib::Response> pollPastTheBudget(httplib::Client& client,
                                                   const httplib::Headers& headers = {}) {
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

// What fb2k/streamer.cpp wires together: the encoder's timeline announcing each mark to the store
// the poll reads, and GET /api/stream/timeline answered from that same timeline.
struct Encoder {
    explicit Encoder(PlayerStateStore* store)
        : timeline(kTimelineMarks, [store] { store->timelineMarked(); }) {}

    Player publishing() {
        Player player;
        player.stream.readTimeline = [this] {
            return streamTimelineDocument(timeline.streamTime(), timeline.marks());
        };
        return player;
    }

    static constexpr size_t kTimelineMarks = 8;
    Timeline timeline;
};

StreamMark seekMark() {
    StreamMark mark;
    mark.at = 31.5;
    mark.path = R"(X:\music\one.flac)";
    mark.position = 90;
    return mark;
}

int pollStatus(httplib::Client& client) {
    const auto response = client.Get("/api/state");
    return response ? response->status : 0;
}

void pollUntilRefused(httplib::Client& client, std::vector<int>& statuses) {
    for (int attempt = 0; attempt < kPollBurst + kPollsPastTheBudget; attempt++) {
        statuses.push_back(pollStatus(client));
        if (statuses.back() == 429)
            return;
    }
}

size_t refusals(const std::vector<int>& statuses) {
    return static_cast<size_t>(std::count(statuses.begin(), statuses.end(), 429));
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
    player.library.refresh = [log](std::vector<std::string> columns, RebuildReason why) {
        log->calls++;
        log->columns = std::move(columns);
        log->reasons.push_back(why);
    };
    return player;
}

constexpr char kTrackTheLibraryDoesNotHold[] = "Artist/Album/never-added.flac";
constexpr char kTrackTheJobRefuses[] = "Artist/Album/refused.flac";
constexpr char kTrackTheJobIsTooSlowFor[] = "Artist/Album/slow.flac";

// Stands in for fb2k/library.cpp's one-track read. The address it is given decides the answer, so
// one server drives every status the player half of GET /api/track/library can produce.
Player readingOneTrack() {
    Player player;
    player.library.readTrack = [](const std::string& track, uint32_t,
                                  const std::vector<std::string>& columns) {
        LibraryTrackRead read;
        if (track == kTrackTheJobRefuses) {
            read.outcome = PlayerOutcome::playerRefused;
        } else if (track == kTrackTheJobIsTooSlowFor) {
            read.outcome = PlayerOutcome::timedOut;
        } else if (track == kTrackTheLibraryHolds) {
            read.held = true;
            read.columns.assign(columns.size(), "One");
        }

        return read;
    };
    return player;
}

std::string oneTrackPath(const std::string& track) {
    return "/api/track/library?track=" + track + "&columns=%25title%25";
}

constexpr char kColumnThePlayerRefuses[] = "refused";
constexpr char kColumnThePlayerIsTooSlowFor[] = "slow";
constexpr char kColumnAskedWithNothingPlaying[] = "stopped";

// Stands in for fb2k/'s now-playing read. The request names no track, so the column it asks for
// decides the answer, and one server drives every status the player half of GET
// /api/track/playing can produce.
Player readingThePlayingTrack() {
    Player player;
    player.playback.readPlayingTrack = [](const std::vector<std::string>& columns) {
        PlayingTrackRead read;
        if (columns.front() == kColumnThePlayerRefuses) {
            read.outcome = PlayerOutcome::playerRefused;
        } else if (columns.front() == kColumnThePlayerIsTooSlowFor) {
            read.outcome = PlayerOutcome::timedOut;
        } else if (columns.front() != kColumnAskedWithNothingPlaying) {
            read.playing = true;
            read.path = R"(C:\Music\Artist\Album\one.flac)";
            read.columns.assign(columns.size(), "One");
        }

        return read;
    };
    return player;
}

std::string playingTrackPath(const std::string& column) {
    return "/api/track/playing?columns=" + column;
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
                                  {"columns", json::array({kTitle, kPlays})},
                                  {"build", nullptr}});
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

    const auto& player = body["player"];
    REQUIRE(player.is_object());

    const std::vector<std::string> published = {"playback", "path",         "subsong",
                                                "position", "duration",     "volume",
                                                "muted",    "playbackMode", "outputDeviceId"};
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
    CHECK(player["outputDeviceId"] == nullptr);
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

// The path is foobar2000's own absolute one and no route takes it, so this is the only address a
// client can write a rating for the playing track to. A stream and a local file the media library
// does not hold both have none, and the stars are read-only for them.
TEST_CASE("the poll document carries where the media library holds the playing track") {
    Library library;
    fill(library);
    PlayerStateStore store;
    const TestServer server = serving(&library, &store);

    SUBCASE("the media library holds it") {
        PlayerState started = playing();
        started.libraryPath = kTrackTheLibraryHolds;
        store.publish(started);

        const auto player = playerSection(server);
        REQUIRE(player.contains("libraryPath"));
        CHECK(player.at("libraryPath") == kTrackTheLibraryHolds);
    }

    // Null rather than a missing key or an empty string, so a client reads one shape and can tell
    // a track with no address from one addressed by the empty relative path.
    SUBCASE("the media library does not hold it") {
        store.publish(playing());

        const auto player = playerSection(server);
        REQUIRE(player.contains("libraryPath"));
        CHECK(player.at("libraryPath").is_null());
    }
}

// A client keys a cover by the record a track is from rather than by the track, so every row of an
// album asks at one address and a record played through costs one request. The album artist is what
// tells two records of the same name apart, and it is not the track's artist: a compilation names a
// different one on every row.
TEST_CASE("the poll document names the record the playing track is from, beside the track") {
    Library library;
    fill(library);
    PlayerStateStore store;
    const TestServer server = serving(&library, &store);

    SUBCASE("the player named the record") {
        PlayerState started = playing();
        started.title = kSongTitle;
        started.artist = kSongArtist;
        started.album = kSongAlbum;
        started.albumArtist = kSongAlbumArtist;
        store.publish(started);

        const auto player = playerSection(server);
        REQUIRE(player.contains("album"));
        REQUIRE(player.contains("albumArtist"));

        CHECK(player["album"] == kSongAlbum);
        CHECK(player["albumArtist"] == kSongAlbumArtist);
        CHECK(player["title"] == kSongTitle);
        CHECK(player["artist"] == kSongArtist);
    }

    // A client that cannot tell an unnamed record from one named with an empty string keys every
    // untagged track in the library to one cover.
    SUBCASE("the player named neither") {
        store.publish(playing());

        const auto player = playerSection(server);
        REQUIRE(player.contains("album"));
        REQUIRE(player.contains("albumArtist"));
        CHECK(player["album"].is_null());
        CHECK(player["albumArtist"].is_null());
    }

    // A single, which carries an album artist on no row. A client falls back to the track's artist
    // for the key, and can only do that where the absence is reported rather than filled in.
    SUBCASE("an album with nobody credited for the record") {
        PlayerState started = playing();
        started.album = kSongAlbum;
        store.publish(started);

        const auto player = playerSection(server);
        CHECK(player["album"] == kSongAlbum);
        CHECK(player["albumArtist"].is_null());
    }
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

    const auto& location = player["playingLocation"];
    REQUIRE(location.is_object());
    CHECK(location["playlistId"] == playlists[0]["id"]);
    CHECK(location["index"] == kPlayingRow);
}

TEST_CASE("a playing location names a playlist by GUID and a row, and carries nothing else") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playingFromThePlaylist());
    const TestServer server = serving(&library, listingThePlayingPlaylist(), &store);

    const auto response = get(server, "/api/state");
    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto location = json::parse(response->body)["player"]["playingLocation"];
    REQUIRE(location.is_object());
    CHECK(keysOf(location) == Keys{"index", "playlistId"});
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

// Each of these answers what the library and the player are right now, under a URL that
// outlives both. A client holding one has last minute's answer, and a shared cache holds
// somebody else's library and what they are listening to. The validator is the other half:
// it is what makes the poll cheap, so the terms have to leave it standing.
TEST_CASE("every poll route asks again, in no cache but that client's, and keeps its validator") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto from = playOne(library, "5") - 1;
    const std::string changes = "/api/library/changes?since=" + std::to_string(from);

    for (const std::string& path : {std::string("/api/state"), std::string(kExport), changes}) {
        INFO("path: ", path);

        const auto first = get(server, path);
        REQUIRE(first);
        REQUIRE(first->status == 200);
        CHECK(first->get_header_value("Cache-Control") == kAskEveryTime);

        const auto tag = first->get_header_value("ETag");
        REQUIRE_FALSE(tag.empty());

        const auto again = getHolding(server, path, tag);
        REQUIRE(again);
        REQUIRE(again->status == 304);
        CHECK(again->get_header_value("ETag") == tag);
        CHECK(again->get_header_value("Cache-Control") == kAskEveryTime);
    }
}

// Every generation a tag names starts again with the component, so a browser still holding what
// the last run answered would revalidate against a snapshot that run never built and be told 304.
TEST_CASE("a tag one run of the component answered is never current in the next run") {
    Library before;
    Library after;
    fill(before);
    fill(after);
    const auto since = playOne(before, "5") - 1;
    REQUIRE(playOne(after, "5") - 1 == since);

    PlayerStateStore beforePlayer;
    PlayerStateStore afterPlayer;
    beforePlayer.publish(playing());
    afterPlayer.publish(playing());

    const TestServer first = serving(&before, &beforePlayer);
    const TestServer second = serving(&after, &afterPlayer);

    const std::string changes = "/api/library/changes?since=" + std::to_string(since);

    for (const std::string& path : {std::string("/api/state"), std::string(kExport), changes}) {
        INFO("path: ", path);

        const auto held = get(first, path);
        REQUIRE(held);
        REQUIRE(held->status == 200);

        const auto tag = held->get_header_value("ETag");
        REQUIRE_FALSE(tag.empty());

        const auto fresh = get(second, path);
        REQUIRE(fresh);
        REQUIRE(fresh->status == 200);
        CHECK(fresh->get_header_value("ETag") != tag);

        const auto revalidated = getHolding(second, path, tag);
        REQUIRE(revalidated);
        CHECK(revalidated->status == 200);
        CHECK_FALSE(revalidated->body.empty());
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

// A rescan takes the playing track into the media library while it is still playing, and then
// nothing else about the player moves. A field outside the comparison the version is computed
// from is a field whose change never reaches a client at all: it holds the ETag, it is answered
// 304, and the stars stay read-only until something unrelated moves.
TEST_CASE("a poll carries a body when the playing track's library path is all that changed") {
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

    PlayerState held = started;
    held.libraryPath = kTrackTheLibraryHolds;
    store.publish(held);

    const auto again = getHolding(server, "/api/state", tag);
    REQUIRE(again);
    REQUIRE(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);

    const auto player = json::parse(again->body).at("player");
    REQUIRE(player.contains("libraryPath"));
    CHECK(player.at("libraryPath") == kTrackTheLibraryHolds);
}

TEST_CASE(
    "the poll document names the output device the player is set to, spelled as "
    "GET /api/outputs spells it") {
    Library library;
    fill(library);
    PlayerStateStore store;
    PlayerState state = playing();
    state.outputDeviceId = kSpeakers;
    store.publish(state);
    const TestServer server = serving(&library, &store);

    CHECK(playerSection(server)["outputDeviceId"] == kSpeakers);
}

// A switch of output device moves nothing else about the player, the same shape as the library
// path above: a field outside the comparison the version is computed from holds the ETag, the
// switch is answered 304, and a picker stays ticked on the device the player has left.
TEST_CASE(
    "a poll carries a body when the output device is all that changed, and a 304 until it "
    "changes again") {
    Library library;
    fill(library);
    PlayerStateStore store;
    PlayerState started = playing();
    started.outputDeviceId = kSpeakers;
    started.outputSilent = false;
    store.publish(started);
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    PlayerState switched = started;
    switched.outputDeviceId = kHeadphones;
    store.publish(switched);

    const auto moved = getHolding(server, "/api/state", tag);
    REQUIRE(moved);
    REQUIRE(moved->status == 200);
    CHECK(json::parse(moved->body).at("player").at("outputDeviceId") == kHeadphones);

    const auto movedTag = moved->get_header_value("ETag");
    REQUIRE_FALSE(movedTag.empty());
    CHECK(movedTag != tag);

    store.outputDeviceChanged(std::string{kHeadphones}, false);

    const auto held = getHolding(server, "/api/state", movedTag);
    REQUIRE(held);
    CHECK(held->status == 304);

    store.outputDeviceChanged(std::nullopt, std::nullopt);

    const auto unnamed = getHolding(server, "/api/state", movedTag);
    REQUIRE(unnamed);
    REQUIRE(unnamed->status == 200);
    CHECK(json::parse(unnamed->body).at("player").at("outputDeviceId") == nullptr);
}

// One device id throughout, so a poll that read the answer off the id rather than off what the
// player reported would answer the same thing all three times.
TEST_CASE("the poll says whether the output plays anywhere as true, false or null, beside the id") {
    Library library;
    fill(library);
    PlayerStateStore store;
    PlayerState state = playing();
    state.outputDeviceId = kSpeakers;
    state.outputSilent = true;
    store.publish(state);
    const TestServer server = serving(&library, &store);

    const auto silent = playerSection(server);
    REQUIRE(silent.contains("outputSilent"));
    CHECK(silent["outputSilent"].is_boolean());
    CHECK(silent["outputSilent"] == true);
    CHECK(silent["outputDeviceId"] == kSpeakers);

    store.outputDeviceChanged(std::string{kSpeakers}, false);

    const auto audible = playerSection(server);
    CHECK(audible["outputSilent"].is_boolean());
    CHECK(audible["outputSilent"] == false);
    CHECK(audible["outputDeviceId"] == kSpeakers);

    store.outputDeviceChanged(std::nullopt, std::nullopt);

    const auto unknown = playerSection(server);
    REQUIRE(unknown.contains("outputSilent"));
    CHECK(unknown["outputSilent"].is_null());
    CHECK(unknown["outputDeviceId"].is_null());
}

TEST_CASE("a player whose output was never reported answers null for the id and for the silence") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto player = playerSection(server);

    REQUIRE(player.contains("outputSilent"));
    CHECK(player["outputSilent"].is_null());
    CHECK(player["outputDeviceId"].is_null());
}

TEST_CASE(
    "a poll carries a body when only the output's silence changed, and a 304 until it changes "
    "again") {
    Library library;
    fill(library);
    PlayerStateStore store;
    PlayerState started = playing();
    started.outputDeviceId = kSpeakers;
    started.outputSilent = false;
    store.publish(started);
    const TestServer server = serving(&library, &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    store.outputDeviceChanged(std::string{kSpeakers}, true);

    const auto moved = getHolding(server, "/api/state", tag);
    REQUIRE(moved);
    REQUIRE(moved->status == 200);
    CHECK(json::parse(moved->body).at("player").at("outputSilent") == true);

    const auto movedTag = moved->get_header_value("ETag");
    REQUIRE_FALSE(movedTag.empty());
    CHECK(movedTag != tag);

    store.outputDeviceChanged(std::string{kSpeakers}, true);

    const auto held = getHolding(server, "/api/state", movedTag);
    REQUIRE(held);
    CHECK(held->status == 304);
}

// The player's volume callback leaves the stream's hold out of `muted`, so the case reports a mute
// by hand, as a user's would arrive, and moves the level.
TEST_CASE("neither the volume nor a mute, the stream's hold included, moves outputSilent") {
    Library library;
    fill(library);
    PlayerStateStore store;
    PlayerState state = playing();
    state.outputDeviceId = kSpeakers;

    SUBCASE("an output that plays nowhere") {
        state.outputSilent = true;
    }
    SUBCASE("an output that plays somewhere") {
        state.outputSilent = false;
    }

    store.publish(state);
    const TestServer server = serving(&library, &store);
    const bool reported = *state.outputSilent;

    store.volumeChanged(-30, true);
    const auto muted = playerSection(server);
    CHECK(muted["muted"] == true);
    CHECK(muted["outputSilent"] == reported);

    store.volumeChanged(-100, false);
    const auto quiet = playerSection(server);
    CHECK(quiet["volume"] == -100);
    CHECK(quiet["outputSilent"] == reported);

    store.volumeChanged(0, false);
    CHECK(playerSection(server)["outputSilent"] == reported);
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

TEST_CASE(
    "a mark turns a conditional poll into a 200, and the timeline read after it holds the mark") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    store.queueChanged(oneQueued());
    store.playlistsChanged(oneListed());
    Encoder encoder(&store);
    const TestServer server = serving(&library, encoder.publishing(), &store);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto before = json::parse(first->body)["player"];
    REQUIRE(before.contains("timelineRevision"));

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    encoder.timeline.mark(seekMark());

    const auto marked = getHolding(server, "/api/state", tag);
    REQUIRE(marked);
    REQUIRE(marked->status == 200);
    CHECK(marked->get_header_value("ETag") != tag);

    const auto after = json::parse(marked->body)["player"];
    REQUIRE(after.contains("timelineRevision"));
    CHECK(after["timelineRevision"].get<uint64_t>() > before["timelineRevision"].get<uint64_t>());
    CHECK(after["queueRevision"] == before["queueRevision"]);
    CHECK(after["playlistsRevision"] == before["playlistsRevision"]);

    const auto timeline = get(server, "/api/stream/timeline");
    REQUIRE(timeline);
    REQUIRE(timeline->status == 200);
    const auto marks = json::parse(timeline->body)["marks"];
    REQUIRE_FALSE(marks.empty());
    CHECK(marks.back()["path"] == seekMark().path);
    CHECK(marks.back()["position"] == doctest::Approx(seekMark().position));

    const auto unchanged = getHolding(server, "/api/state", marked->get_header_value("ETag"));
    REQUIRE(unchanged);
    CHECK(unchanged->status == 304);
}

TEST_CASE(
    "with streaming switched off the timeline revision is 0, and nothing the player does moves "
    "it") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    Settings settings = servingSettings();
    settings.maxConcurrentStreams = 0;
    const TestServer server(settings, Player{}, &library, countingMint(), &store);

    const auto untouched = playerSection(server);
    REQUIRE(untouched.contains("timelineRevision"));
    CHECK(untouched["timelineRevision"] == 0);

    store.started(PlayingTrack{R"(X:\music\two.flac)", 0, std::nullopt, 180},
                  std::chrono::steady_clock::now());
    CHECK(playerSection(server)["timelineRevision"] == 0);

    store.seeked(90, std::chrono::steady_clock::now());
    CHECK(playerSection(server)["timelineRevision"] == 0);

    store.queueChanged(oneQueued());
    CHECK(playerSection(server)["timelineRevision"] == 0);

    store.playlistsChanged(oneListed());
    CHECK(playerSection(server)["timelineRevision"] == 0);

    store.stopped();
    CHECK(playerSection(server)["timelineRevision"] == 0);
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
// two travel as strings of decimal digits. These three are inside 2^53 and exact, and the cases
// above compare them for order. The mistake this catches is converting every counter together on
// the grounds that counters should look alike: it would take the ordering away for nothing.
TEST_CASE("the poll's three revisions are numbers, where a playlist's own counters are not") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playing());
    const TestServer server = serving(&library, &store);

    const auto player = playerSection(server);
    REQUIRE(player.contains("queueRevision"));
    REQUIRE(player.contains("playlistsRevision"));
    REQUIRE(player.contains("timelineRevision"));

    INFO("queueRevision: ", player["queueRevision"].dump(),
         ", playlistsRevision: ", player["playlistsRevision"].dump(),
         ", timelineRevision: ", player["timelineRevision"].dump());

    CHECK(player["queueRevision"].is_number_unsigned());
    CHECK(player["playlistsRevision"].is_number_unsigned());
    CHECK(player["timelineRevision"].is_number_unsigned());
}

TEST_CASE("the player section names each revision once and carries nothing else new") {
    Library library;
    fill(library);
    PlayerStateStore store;
    store.publish(playingFromThePlaylist());
    store.playlistsChanged(oneListed());
    const TestServer server = serving(&library, listingThePlayingPlaylist(), &store);

    const Keys published = {"playback",
                            "path",
                            "subsong",
                            "libraryPath",
                            "position",
                            "duration",
                            "volume",
                            "muted",
                            "playbackMode",
                            "outputDeviceId",
                            "outputSilent",
                            "title",
                            "artist",
                            "album",
                            "albumArtist",
                            "playingLocation",
                            "currentPlaylistId",
                            "queueRevision",
                            "playlistsRevision",
                            "timelineRevision",
                            "sessionRevision"};

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
    SUBCASE("the snapshot was rebuilt with a track more") {
        moveLibraryStructure(library);
    }

    const auto again = getHolding(server, "/api/state", tag);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);
}

// Neither generation moves until the build lands, so a tag made of the generations alone would
// hold a waiting client on a 304 and its progress bar still for the whole build.
TEST_CASE("a conditional poll is a 200 once the build's progress moves, and a 304 until it does") {
    Library library;
    fill(library);
    library.reportBuild(BuildProgress{BuildPhase::ordering, 0, 30441});
    const TestServer server = serving(&library);

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);

    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    const auto unchanged = getHolding(server, "/api/state", tag);
    REQUIRE(unchanged);
    REQUIRE(unchanged->status == 304);

    SUBCASE("the phase moved") {
        library.reportBuild(BuildProgress{BuildPhase::formatting, 0, 30441});
    }
    SUBCASE("a slice was formatted") {
        library.reportBuild(BuildProgress{BuildPhase::ordering, 8192, 30441});
    }
    SUBCASE("the total moved") {
        library.reportBuild(BuildProgress{BuildPhase::ordering, 0, 30442});
    }
    SUBCASE("the build ended") {
        library.endBuild();
    }

    const auto again = getHolding(server, "/api/state", tag);
    REQUIRE(again);
    CHECK(again->status == 200);
    CHECK(again->get_header_value("ETag") != tag);
}

// The export and the delta are the same bytes until the build lands, so a tag that moved with
// progress would send a client holding either of them the whole thing again once a slice.
TEST_CASE("a build's progress leaves the export and the delta a client holds current") {
    Library library;
    fill(library);
    playOne(library, "5");
    const TestServer server = serving(&library);

    const auto exported = get(server, kExport);
    const auto patched = get(server, "/api/library/changes?since=1");
    REQUIRE(exported);
    REQUIRE(patched);
    REQUIRE(exported->status == 200);
    REQUIRE(patched->status == 200);

    library.reportBuild(BuildProgress{BuildPhase::formatting, 8192, 30441});

    const auto exportedAgain = getHolding(server, kExport, exported->get_header_value("ETag"));
    const auto patchedAgain =
        getHolding(server, "/api/library/changes?since=1", patched->get_header_value("ETag"));
    REQUIRE(exportedAgain);
    REQUIRE(patchedAgain);
    CHECK(exportedAgain->status == 304);
    CHECK(patchedAgain->status == 304);
}

TEST_CASE("the export is the snapshot, framed as contract/openapi.yaml describes it") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);

    const auto response = get(server, kExport);

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(response->get_header_value("Content-Type") == "application/octet-stream");

    const auto header = decode(response->body).header;
    CHECK(header["kind"] == "snapshot");
    CHECK(header["trackCount"] == 3);
    CHECK(columnNames(header) == std::vector<std::string>{kTitle, kPlays});
    CHECK(header["spine"]["directory"]["distinct"] == 2);
    CHECK(header["columns"][1]["hasUnresolved"] == true);
}

TEST_CASE(
    "a client looping on the delta route is refused, and a refusal for what it asks spends "
    "nothing") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);
    const auto from = playOne(library, "5") - 1;
    const std::string path = "/api/library/changes?since=" + std::to_string(from);

    auto client = server.client();
    int refusals = 0;
    std::string retryAfter;
    std::string error;
    constexpr int kAttempts = 250;
    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = client.Get(path);
        REQUIRE(response);
        if (response->status != 429)
            continue;

        ++refusals;
        retryAfter = response->get_header_value("Retry-After");
        error = json::parse(response->body).at("error").get<std::string>();
    }

    CHECK(refusals > 0);
    CHECK(retryAfter == "1");
    CHECK(error == "too many library delta reads");

    const auto malformed = client.Get("/api/library/changes?since=soon");
    REQUIRE(malformed);
    CHECK(malformed->status == 400);

    server.advanceRateLimits(std::chrono::seconds(1));
    const auto answered = client.Get(path);
    REQUIRE(answered);
    CHECK(answered->status == 200);
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

    REQUIRE(get(server, "/api/library/export?columns=%25genre%25"));
    library.reportBuild(BuildProgress{BuildPhase::listing, 0, 0});

    for (int attempt = 0; attempt < 4; ++attempt) {
        const auto response = get(server, "/api/library/export?columns=%25genre%25");
        REQUIRE(response);
        CHECK(response->status == 202);
    }

    CHECK(log.calls == 1);
}

// A walk that times out on foobar2000's main thread ends the build without a snapshot, and the
// set stays declared. Were the declaration all that was checked, every retry after that would be
// answered 202 and nothing would ever build it.
TEST_CASE("asking again for a declared set nobody is building starts it again") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    const auto first = get(server, "/api/library/export?columns=%25genre%25");
    REQUIRE(first);
    REQUIRE(first->status == 202);
    REQUIRE(log.calls == 1);

    SUBCASE("the build ended without a snapshot") {
        library.reportBuild(BuildProgress{BuildPhase::listing, 0, 0});
        library.endBuild();
    }
    SUBCASE("the build never reported") {}

    const auto again = get(server, "/api/library/export?columns=%25genre%25");
    REQUIRE(again);
    CHECK(again->status == 202);
    CHECK(log.calls == 2);
    CHECK(log.columns == std::vector<std::string>{"%genre%"});
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

    const auto spelled = raw.Get("/api/library/export?columns=a&columns=%61");
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

    const auto& player = body["player"];
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
                                  {"columns", json::array()},
                                  {"build", nullptr}});
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

// A client retrying an export whose build keeps dying asks for a library walk each time, which is
// the loop the rebuild budget is there for.
TEST_CASE("asking again for a set nobody is building spends the rebuild budget") {
    BuildLog log;
    Library library;
    const TestServer server = serving(&library, building(&log));

    constexpr int kAttempts = 8;
    int refused = 0;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = get(server, "/api/library/export?columns=%25genre%25");
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

// Refused rebuilds are a client looping on the most expensive thing the player does, and nobody
// reading the player's console would otherwise know. One line, because the loop is many a second.
TEST_CASE("a burst of refused library rebuilds writes one error line") {
    BuildLog log;
    Library library;
    fill(library);
    const TestServer server = serving(&library, building(&log));
    clearLog();

    constexpr int kAttempts = 8;
    std::vector<int> statuses;

    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        const auto response = refresh(server);
        statuses.push_back(response ? response->status : 0);
    }

    REQUIRE(refusals(statuses) > refusalBursts(statuses));
    CHECK(errorLinesContaining("refusing library rebuilds") == refusalBursts(statuses));
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
    Settings settings = servingSettings();
    settings.allowedOrigins = {kOrigin};
    const TestServer server(settings, Player{}, &library);

    auto client = server.client();
    const auto refusal = pollPastTheBudget(client, withOrigin(kOrigin));
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
// socket serves both stacks here, so the two clients arrive on two addresses over a real
// connection.
TEST_CASE("a client on another address polls on while one is being refused") {
    Library library;
    fill(library);
    const TestServer server = servingBothStacks(&library);
    REQUIRE(server.status().listening);

    auto elsewhere = overIpv6(server);

    INFO("the second address is ::1, reached through a dual-stack bind");
    const auto reachable = elsewhere.Get("/api/state");
    REQUIRE(reachable);
    REQUIRE(reachable->status == 200);

    auto looping = server.client();
    REQUIRE(pollPastTheBudget(looping).has_value());

    const auto unaffected = elsewhere.Get("/api/state");
    REQUIRE(unaffected);
    CHECK(unaffected->status == 200);

    const auto stillRefused = looping.Get("/api/state");
    REQUIRE(stillRefused);
    CHECK(stillRefused->status == 429);
}

// A client looping on the poll is invisible to the user who owns the player, since the browser
// shows nothing and the 429 is answered before anything reaches foobar2000. The line is how they
// find out, and the address in it is how they find which device.
TEST_CASE("a burst of refused polls writes one error line naming the address it came from") {
    Library library;
    fill(library);
    const TestServer server = serving(&library);
    clearLog();

    auto looping = server.client();
    std::vector<int> statuses;
    statuses.reserve(kPollBurst + kPollsPastTheBudget);
    for (int attempt = 0; attempt < kPollBurst + kPollsPastTheBudget; attempt++)
        statuses.push_back(pollStatus(looping));

    REQUIRE(refusals(statuses) > refusalBursts(statuses));
    CHECK(errorLinesContaining(TestServer::kClientHost) == refusalBursts(statuses));
}

TEST_CASE("an allowed poll starts a new burst for its own address and no other") {
    Library library;
    fill(library);
    const TestServer server = servingBothStacks(&library);
    REQUIRE(server.status().listening);
    clearLog();

    auto phone = server.client();
    auto laptop = overIpv6(server);
    std::vector<int> fromPhone;
    std::vector<int> fromLaptop;

    INFO("the laptop is ::1, reached through a dual-stack bind");
    fromLaptop.push_back(pollStatus(laptop));
    REQUIRE(fromLaptop.back() == 200);

    pollUntilRefused(phone, fromPhone);
    REQUIRE(fromPhone.back() == 429);

    fromLaptop.push_back(pollStatus(laptop));
    fromPhone.push_back(pollStatus(phone));
    CHECK(fromLaptop.back() == 200);
    CHECK(fromPhone.back() == 429);

    pollUntilRefused(laptop, fromLaptop);
    REQUIRE(fromLaptop.back() == 429);
    fromPhone.push_back(pollStatus(phone));
    CHECK(fromPhone.back() == 429);

    CHECK(errorLinesContaining("127.0.0.1") == refusalBursts(fromPhone));
    CHECK(errorLinesContaining("::1") == refusalBursts(fromLaptop));
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

    const auto document = client.Get("/api/state");
    REQUIRE(document);
    REQUIRE(document->status == 200);

    SUBCASE("the document") {
        CHECK(endsTheConnection(*document));
    }

    SUBCASE("the 304 that says nothing moved") {
        const httplib::Headers headers{{"If-None-Match", document->get_header_value("ETag")}};

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
    const auto response = client.Get(kExport);

    REQUIRE(response);
    REQUIRE(response->status == 200);
    CHECK_FALSE(endsTheConnection(*response));
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
TEST_CASE("no library or track route answers a status contract/openapi.yaml does not document") {
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

    const TestServer reading = serving(&library, readingOneTrack());

    note("GET /track/library", get(reading, oneTrackPath(kTrackTheLibraryHolds)));
    note("GET /track/library", get(reading, oneTrackPath(kTrackTheLibraryDoesNotHold)));
    note("GET /track/library", get(reading, oneTrackPath(kTrackTheJobRefuses)));
    note("GET /track/library", get(reading, oneTrackPath(kTrackTheJobIsTooSlowFor)));
    note("GET /track/library", get(reading, oneTrackPath(kTrackTheLibraryHolds) + "&subsong=two"));
    note("GET /track/library", get(reading, "/api/track/library?columns=%25title%25"));
    note("GET /track/library",
         get(reading, "/api/track/library?track=" + std::string(kTrackTheLibraryHolds)));
    note("GET /track/library", reading.client().Get(oneTrackPath(kTrackTheLibraryHolds)));
    note("GET /track/library", get(off, oneTrackPath(kTrackTheLibraryHolds)));

    const TestServer playing = serving(nullptr, readingThePlayingTrack());

    note("GET /track/playing", get(playing, playingTrackPath("%25title%25")));
    note("GET /track/playing", get(playing, playingTrackPath(kColumnAskedWithNothingPlaying)));
    note("GET /track/playing", get(playing, playingTrackPath(kColumnThePlayerRefuses)));
    note("GET /track/playing", get(playing, playingTrackPath(kColumnThePlayerIsTooSlowFor)));
    note("GET /track/playing", get(playing, "/api/track/playing"));
    note("GET /track/playing", get(playing, playingTrackPath("")));
    note("GET /track/playing",
         get(playing, playingTrackPath(std::string(kMaxColumnLength + 1, 'x'))));
    note("GET /track/playing", playing.client().Get(playingTrackPath("%25title%25")));
    note("GET /track/playing", get(off, playingTrackPath("%25title%25")));

    for (int attempt = 0; attempt < 8; ++attempt) {
        note("POST /library/refresh", refresh(server));
        note("GET /library/export",
             get(server, "/api/library/export?columns=%25genre" + std::to_string(attempt) + "%25"));
    }

    for (const auto& route : publishedRoutes()) {
        if (route.path.rfind("/library", 0) != 0 && route.path != "/state" &&
            route.path != "/track/library" && route.path != "/track/playing")
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

namespace {

uint64_t configGenerationOf(const httplib::Result& response) {
    REQUIRE(response);
    REQUIRE(response->status == 200);
    const auto body = json::parse(response->body);
    REQUIRE(body.contains("configGeneration"));
    REQUIRE(body["configGeneration"].is_number_unsigned());
    return body["configGeneration"].get<uint64_t>();
}

uint64_t configGenerationOf(const TestServer& server) {
    return configGenerationOf(get(server, "/api/state"));
}

}  // namespace

TEST_CASE("the poll's configGeneration moves each time a reload changes a switch") {
    TestServer server;

    const auto before = configGenerationOf(server);

    server.reload(R"({"controlPlayback": false})");
    const auto turnedOff = configGenerationOf(server);

    server.reload("{}");
    const auto turnedOn = configGenerationOf(server);

    CHECK(turnedOff > before);
    CHECK(turnedOn > turnedOff);
}

// A client polls this so it can skip asking for capabilities on every tick. A generation that
// moved on a save that changed nothing would send every client for capabilities anyway.
TEST_CASE("a reload that changes no switch leaves configGeneration where it was") {
    TestServer server;
    server.reload(R"({"controlPlayback": false})");
    const auto settled = configGenerationOf(server);

    SUBCASE("the same switches saved again") {
        server.reload(R"({"controlPlayback": false})");
    }

    SUBCASE("only a restart-only key moved") {
        server.reload(R"({"controlPlayback": false, "opusBitrate": 128000})");
    }

    SUBCASE("a file caught halfway through a save") {
        server.reload(R"({"controlPlayback": tr)");
    }

    CHECK(configGenerationOf(server) == settled);
}

TEST_CASE(
    "a conditional poll is a 200 once a reload changes a switch, and a 304 after one that did "
    "not") {
    TestServer server;

    const auto first = get(server, "/api/state");
    REQUIRE(first);
    REQUIRE(first->status == 200);
    const auto tag = first->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    server.reload(R"({"writePlaylists": false})");

    const auto changed = getHolding(server, "/api/state", tag);
    REQUIRE(changed);
    CHECK(changed->status == 200);
    const auto changedTag = changed->get_header_value("ETag");
    CHECK(changedTag != tag);

    server.reload(R"({"writePlaylists": false})");

    const auto unchanged = getHolding(server, "/api/state", changedTag);
    REQUIRE(unchanged);
    CHECK(unchanged->status == 304);
}
