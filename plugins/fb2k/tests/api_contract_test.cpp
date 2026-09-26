// A tripwire on the wire format: these pin the exact key set of every document this component
// publishes, so a field added, renamed or dropped without editing contract/openapi.yaml turns one
// red. The last case does the same for the statuses of the stream routes, by driving them and
// comparing what came back against what the specification says they answer. Anything about
// behaviour belongs in the other files.

#include "third_party/doctest.h"

#include "core/api.h"
#include "core/outputs.h"
#include "core/version.h"
#include "support/fixtures.h"
#include "support/keys.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <iterator>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kUpdateSpec[] = "shape changed -- update contract/openapi.yaml to match";

// One byte, once, so a stream ends by itself rather than holding a thread.
class OneChunk : public StreamSession {
public:
    bool next(std::vector<std::uint8_t>& out) override {
        if (sent_)
            return false;

        sent_ = true;
        out = {'o'};
        return true;
    }

private:
    bool sent_ = false;
};

Player wiredUp() {
    auto player = TestServer::streaming([](const std::string&) -> OpenedStream {
        return {"audio/ogg", std::make_unique<OneChunk>()};
    });

    player.readTimeline = [] { return streamTimelineDocument(0, {}); };
    player.outputHeld = [] { return true; };
    player.releaseOutput = [] {};
    return player;
}

using Statuses = std::map<std::string, std::set<int>>;

void note(Statuses& seen, const std::string& route, const httplib::Result& response) {
    REQUIRE_MESSAGE(response, "no answer from ", route);
    seen[route].insert(response->status);
}

std::string listed(const std::set<int>& statuses) {
    std::string text;
    for (const int status : statuses)
        text += (text.empty() ? "" : " ") + std::to_string(status);

    return text;
}

std::string listed(const std::vector<std::string>& values) {
    std::string text;
    for (const auto& value : values)
        text += (text.empty() ? "" : ", ") + value;

    return text;
}

template <typename Enum>
std::set<std::string> everyDescribed() {
    std::set<std::string> described;

    for (int raw = 0;; ++raw) {
        auto text = describe(static_cast<Enum>(raw));
        if (text == "unknown")
            return described;

        described.insert(std::move(text));
    }
}

std::string unsendable(const std::string& schema, const std::set<std::string>& described) {
    std::vector<std::string> missing;
    for (const auto& published : publishedEnum(schema, "error"))
        if (described.count(published) == 0)
            missing.push_back(published);

    return listed(missing);
}

template <typename Enum>
int statusAnswered(const std::string& error) {
    for (int raw = 0;; ++raw) {
        const auto outcome = static_cast<Enum>(raw);
        const auto described = describe(outcome);

        if (described == "unknown")
            return 0;
        if (described == error)
            return httpStatusFor(outcome);
    }
}

// What a client acts on is the sentence, so a refusal two routes both make has to be one
// sentence however many enumerations carry it.
template <typename Enum>
std::vector<std::string> errorsSaying(const std::string& sense) {
    std::vector<std::string> found;
    for (const auto& described : everyDescribed<Enum>())
        if (described.find(sense) != std::string::npos)
            found.push_back(described);

    return found;
}

// contract/openapi.yaml quotes a value wherever YAML needs it to and publishedEnum hands back
// the line as written, so a comparison against the sentence the component sends drops them.
std::string unquoted(const std::string& value) {
    const bool quoted = value.size() >= 2 && value.front() == '"' && value.back() == '"';
    return quoted ? value.substr(1, value.size() - 2) : value;
}

bool publishesError(const std::string& schema, const std::string& error) {
    const auto values = publishedEnum(schema, "error");
    return std::count_if(values.begin(), values.end(), [&error](const std::string& published) {
               return unquoted(published) == error;
           }) == 1;
}

bool publishes(const std::string& method, const std::string& path, int status) {
    const auto routes = publishedRoutes();
    const auto route = std::find_if(routes.begin(), routes.end(), [&](const SpecRoute& published) {
        return published.method == method && published.path == path;
    });

    return route != routes.end() && route->statuses.count(status) != 0;
}

}  // namespace

TEST_CASE("GET /status is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);
    CHECK(keysOf(statusDocument()) == Keys{"name", "version", "apiVersion"});
}

TEST_CASE("GET /capabilities is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);
    CHECK(keysOf(capabilitiesDocument(servingSettings(), {"opus", "aac"}, true, true, "foobar2000",
                                      "2.25.3", -100, 0, "db", {"Default"})) ==
          Keys{"apiVersion", "allowedFields", "canWrite", "canWritePlaylists", "canControlPlayback",
               "canChangeOutput", "maxAutoPlaylists", "canCreateAutoPlaylists", "canStream",
               "streamFormats", "canMuteWhileStreaming", "canReadLibrary", "playerName",
               "playerVersion", "volumeMin", "volumeMax", "volumeUnit", "playbackModes"});
}

TEST_CASE("a client is told what it may write") {
    const TestServer server(servingSettingsAllowing({"rating", "comment"}));
    const auto response = server.client().Get("/api/capabilities");

    REQUIRE(response);
    REQUIRE(response->status == 200);

    const auto body = json::parse(response->body);
    CHECK(body["canWrite"] == true);
    CHECK(body["allowedFields"] == json::array({"rating", "comment"}));
}

TEST_CASE("an empty allowlist reports that nothing may be written") {
    const TestServer server(servingSettingsAllowing({}));
    const auto response = server.client().Get("/api/capabilities");

    REQUIRE(response);
    const auto body = json::parse(response->body);
    CHECK(body["canWrite"] == false);
    CHECK(body["allowedFields"].empty());
}

TEST_CASE("a listener roster is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    AudienceMember member;
    member.deviceId = "device-1";
    member.name = "Android phone";
    member.format = "opus";
    member.connections = 2;
    member.listeningForSeconds = 412;

    CHECK(keysOf(streamListenersDocument({member}, 2, 8, true)) ==
          Keys{"devices", "connections", "maxConnections", "playerMuted"});
}

TEST_CASE("a stream ticket is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);
    CHECK(keysOf(streamTicketDocument("ticket-1", 120)) == Keys{"ticket", "expiresIn"});
}

TEST_CASE("a stream timeline is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    StreamMark mark;
    mark.at = 491.46;
    mark.path = R"(F:\Music\a.flac)";

    CHECK(keysOf(streamTimelineDocument(12.5, {mark})) == Keys{"streamTime", "marks"});

    // The client's own `anchor + currentTime` arithmetic reads exactly these four, so
    // renaming one of them is a client that silently stops following the audio.
    CHECK(keysOf(json::parse(streamTimelineDocument(12.5, {mark}))["marks"][0]) ==
          Keys{"at", "path", "subsong", "position"});
}

// One shape per address form. `structure` is never echoed, being a precondition on the write
// rather than part of the address, so a client gets back no field it did not send.
TEST_CASE("a successful write is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    TagWrite write;
    write.fields = {{"rating", "4"}};

    write.track.library = LibraryTrackRef{kTrackAddress, 0};
    CHECK(keysOf(tagWrittenDocument(write)) == Keys{"written", "track", "subsong", "fields"});

    write.track.library.reset();
    write.track.playlist = PlaylistTrackRef{kPlaylistId, 3, kWriteStructure};
    CHECK(keysOf(tagWrittenDocument(write)) == Keys{"written", "playlist", "index", "fields"});
}

TEST_CASE("a refusal is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    const auto refused = parseTagWrite(R"({"track": "a/b.flac", "fields": {"artist": "x"}})",
                                       servingSettings());
    REQUIRE_FALSE(refused.ok());

    // `field` is present only for a rejected field, which is the difference a client branches on.
    CHECK(keysOf(tagRefusedDocument(refused)) == Keys{"written", "error", "detail", "field"});

    const auto malformed = parseTagWrite("not json", servingSettings());
    CHECK(keysOf(tagRefusedDocument(malformed)) == Keys{"written", "error", "detail"});
}

TEST_CASE("a failure is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);
    CHECK(keysOf(tagFailedDocument(TagWriteOutcome::trackNotKnown)) == Keys{"written", "error"});
}

TEST_CASE("a playlist annotation is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    PlaylistAnnotation playlist;
    playlist.managed = AutoPlaylistSpec();

    const auto keys = Keys{"id",   "index",     "title",    "itemCount", "isAutoPlaylist",
                           "role", "structure", "revision", "managed"};
    CHECK(keysOf(playlistDocument(playlist)) == keys);

    // Absence is expressed as null rather than omission, so a client reads one shape.
    playlist.managed.reset();
    CHECK(keysOf(playlistDocument(playlist)) == keys);

    CHECK(keysOf(playlistsDocument({playlist})) == Keys{"playlists"});
}

TEST_CASE("what foo_jean stored about a playlist is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    PlaylistAnnotation playlist;
    playlist.managed = AutoPlaylistSpec();

    const auto managed = json::parse(playlistDocument(playlist))["managed"];
    CHECK(keysOf(managed) == Keys{"key", "query", "sort", "forceSort"});
}

TEST_CASE("a page of playlist rows is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    PlaylistRowsRead read;
    read.rows.emplace_back();

    CHECK(keysOf(playlistRowsDocument(read)) ==
          Keys{"structure", "revision", "totalCount", "items"});

    // A row the media library does not hold carries libraryPath as null rather than leaving it
    // out, so a client reads one shape. The subsong is there whether the library holds the row or
    // not, being a property of the handle.
    const auto row = json::parse(playlistRowsDocument(read))["items"][0];
    CHECK(keysOf(row) == Keys{"columns", "libraryPath", "subsong"});
}

TEST_CASE("a delta of playlist rows is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    PlaylistChangesRead read;
    ChangedPlaylistRow changed;
    changed.row.columns = {"value"};
    read.rows.push_back(changed);

    CHECK(keysOf(playlistChangesDocument(read)) == Keys{"revision", "columns", "items"});

    const auto document = json::parse(playlistChangesDocument(read));

    const auto row = document["items"][0];
    CHECK(keysOf(row) == Keys{"position", "libraryPath", "subsong"});

    const auto column = document["columns"][0];
    CHECK(keysOf(column) == Keys{"text", "ids"});
}

// A playlist's structure generation and its content revision are 64-bit counters, seeded so that
// neither repeats across a restart of this component, and a JSON number is an IEEE 754 double,
// exact only to 2^53. So the type is the contract rather than a detail of how a document is
// built: contract/openapi.yaml types both `string` with pattern `^[0-9]+$`, and a document that
// carries either as a number carries a value the client that reads it cannot get back.
TEST_CASE("every document carrying a playlist's counters carries them as strings of digits") {
    INFO(kUpdateSpec);

    // The neighbouring value is 9204739866101318924, and both of them, along with every value
    // within five hundred of either, parse to 9204739866101318656 as a double.
    constexpr uint64_t kSeeded = 9204739866101318923ULL;

    // Each field's JSON text rather than its value, so a failure names the type it arrived as:
    // a number prints bare where a run of digits prints in quotes.
    const std::string digits = R"("9204739866101318923")";

    PlaylistAnnotation playlist;
    playlist.structure = kSeeded;
    playlist.revision = kSeeded;

    const auto annotation = json::parse(playlistDocument(playlist));
    CHECK(annotation.at("structure").dump() == digits);
    CHECK(annotation.at("revision").dump() == digits);

    PlaylistRowsRead page;
    page.structure = kSeeded;
    page.revision = kSeeded;

    const auto rows = json::parse(playlistRowsDocument(page));
    CHECK(rows.at("structure").dump() == digits);
    CHECK(rows.at("revision").dump() == digits);

    PlaylistChangesRead changes;
    changes.revision = kSeeded;
    CHECK(json::parse(playlistChangesDocument(changes)).at("revision").dump() == digits);

    CHECK(json::parse(copiedRowsDocument(kSeeded, {})).at("structure").dump() == digits);
    CHECK(json::parse(removedRowsDocument(kSeeded)).at("structure").dump() == digits);
    CHECK(json::parse(fillResultDocument(kPlaylistId, kSeeded, {})).at("structure").dump() ==
          digits);
}

TEST_CASE("the other playlist answers are the shapes contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    CHECK(keysOf(playlistRemovedDocument(kPlaylistId)) == Keys{"removed", "id"});
    CHECK(keysOf(fillResultDocument(kPlaylistId, 0, {})) ==
          Keys{"playlistId", "structure", "positions"});

    const auto refused = parseAutoPlaylist("not json", Need::required);
    REQUIRE_FALSE(refused.ok());
    CHECK(keysOf(playlistRefusedDocument(refused)) == Keys{"error", "detail"});

    PlaylistResult failed;
    failed.outcome = PlaylistOutcome::queryInvalid;
    CHECK(keysOf(playlistFailedDocument(failed)) == Keys{"error", "detail"});

    CHECK(keysOf(queryPreviewDocument(PreviewResult())) ==
          Keys{"valid", "error", "matches", "libraryEnabled"});
}

TEST_CASE("the playlist statuses contract/openapi.yaml documents are the ones we answer with") {
    INFO(kUpdateSpec);

    CHECK(httpStatusFor(PlaylistRefusal::malformedBody) == 400);
    CHECK(httpStatusFor(PlaylistRefusal::badTitle) == 400);
    CHECK(httpStatusFor(PlaylistRefusal::badKey) == 400);
    CHECK(httpStatusFor(PlaylistRefusal::badQuery) == 400);
    CHECK(httpStatusFor(PlaylistRefusal::badSort) == 400);
    CHECK(httpStatusFor(PlaylistRefusal::badId) == 400);
    CHECK(httpStatusFor(PlaylistRefusal::badOrdinals) == 400);
    CHECK(httpStatusFor(PlaylistRefusal::tooFast) == 429);

    CHECK(httpStatusFor(PlaylistOutcome::done) == 200);
    CHECK(httpStatusFor(PlaylistOutcome::queryInvalid) == 400);
    CHECK(httpStatusFor(PlaylistOutcome::positionPastEnd) == 400);
    CHECK(httpStatusFor(PlaylistOutcome::notOurs) == 403);
    CHECK(httpStatusFor(PlaylistOutcome::noSuchPlaylist) == 404);
    CHECK(httpStatusFor(PlaylistOutcome::keyInUse) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::tooMany) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::structureMoved) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::queueMoved) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::rowsMoved) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::playlistLocked) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::rowsRevisionTooOld) == 410);
    CHECK(httpStatusFor(PlaylistOutcome::playerRefused) == 500);
    CHECK(httpStatusFor(PlaylistOutcome::timedOut) == 504);
    CHECK(httpStatusFor(PlaylistOutcome::unavailable) == 503);
    CHECK(httpStatusFor(PlaylistOutcome::writesDisabled) == 403);
    CHECK(httpStatusFor(PlaylistOutcome::ownPlaylist) == 403);
}

TEST_CASE("the library answers are the shapes contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    Library::State state;
    state.ready = true;
    state.structure = 41;
    state.revision = 903;
    state.trackCount = 30441;
    state.columns = {"%title%"};

    // `build` is required and nullable, so a library nobody is building still sends the key.
    const auto idle = json::parse(libraryDocument(state));
    CHECK(keysOf(idle) == Keys{"ready", "structure", "revision", "trackCount", "columns", "build"});
    CHECK((idle.contains("build") && idle.at("build").is_null()));

    const auto refused = parseLibraryRequest({"%title%", "%title%"}, std::string());
    REQUIRE_FALSE(refused.ok());
    CHECK(keysOf(libraryRefusedDocument(refused)) == Keys{"error", "detail"});

    CHECK(keysOf(libraryFailedDocument(DeltaOutcome::structureChanged)) == Keys{"error", "detail"});

    // No libraryPath: the caller supplied the address, so the answer carries only what it did
    // not already have.
    CHECK(keysOf(libraryTrackDocument({"Imaginary Track", "Fictional Artist"})) == Keys{"columns"});
}

TEST_CASE("a library being built carries its progress in the shape LibraryBuild publishes") {
    INFO(kUpdateSpec);

    Library::State state;
    state.build = BuildProgress{BuildPhase::formatting, 16384, 30441};

    const auto library = json::parse(libraryDocument(state));
    CHECK(keysOf(library) ==
          Keys{"ready", "structure", "revision", "trackCount", "columns", "build"});

    REQUIRE(library.contains("build"));
    const auto& build = library.at("build");
    REQUIRE(build.is_object());
    CHECK(keysOf(build) == Keys{"phase", "formatted", "total"});
    CHECK(build["phase"] == "formatting");
    CHECK(build["formatted"] == 16384);
    CHECK(build["total"] == 30441);
}

TEST_CASE("every build phase is written as a name contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    std::set<std::string> written;
    for (const auto phase : {BuildPhase::listing, BuildPhase::ordering, BuildPhase::formatting}) {
        Library::State state;
        state.build = BuildProgress{phase, 0, 0};

        const auto name = json::parse(libraryDocument(state))["build"]["phase"];
        REQUIRE(name.is_string());
        written.insert(name.get<std::string>());
    }

    CHECK(written == std::set<std::string>{"listing", "ordering", "formatting"});

    const auto published = publishedEnum("LibraryBuild", "phase");
    CHECK(written == std::set<std::string>(published.begin(), published.end()));
}

// PlayingTrackColumns. The caller named no track, so the answer says which one it was read from,
// and nothing past that: libraryPath is already the poll's to carry.
TEST_CASE("the playing track's columns are the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    CHECK(keysOf(playingTrackDocument(R"(C:\Music\Fictional Artist\Imaginary Album\01 Track.flac)",
                                      0, {"Imaginary Track", "Fictional Artist"})) ==
          Keys{"path", "subsong", "columns"});
}

TEST_CASE("GET /outputs is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    OutputsRead read;
    read.devices = {
        {"{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{0E1D3C47-5A7B-4F21-9C3D-2B8E6F4A1D90}",
         "Speakers (Fictional Audio)"}};
    read.active = read.devices.front().id;

    const auto listed = json::parse(outputsDocument(read));
    CHECK(keysOf(listed) == Keys{"devices", "active"});
    REQUIRE(listed["devices"].size() == 1);
    CHECK(keysOf(listed["devices"][0]) == Keys{"id", "name"});

    // `active` is required and nullable, so a player paired with no listed device still sends it.
    read.active.reset();
    CHECK(keysOf(outputsDocument(read)) == Keys{"devices", "active"});
}

// api_contract_test.cpp's other cases compare an emitted document with a key set written by
// hand; this one is the check nothing else here makes, that the specification's own examples
// agree with the schema they illustrate. `PlayerState` is `additionalProperties: false`, so
// this same key set is both the whole of what MUST be present and the whole of what MAY be.
TEST_CASE("GET /state's documented examples are the shape PlayerState declares") {
    INFO(kUpdateSpec);

    const auto required =
        Keys{"playback",          "path",              "subsong",           "libraryPath",
             "position",          "duration",          "volume",            "muted",
             "title",             "artist",            "album",             "albumArtist",
             "playbackMode",      "outputDeviceId",    "playingLocation",   "currentPlaylistId",
             "queueRevision",     "playlistsRevision", "timelineRevision"};

    PlayerState playing;
    playing.playback = PlaybackState::playing;
    playing.path = R"(C:\Music\Fictional Artist\Imaginary Album\01 Track.flac)";
    playing.position.seconds = 83.4;
    playing.duration = 214.0;
    playing.volume = -8.5;
    playing.playbackMode = "inOrder";
    playing.outputDeviceId =
        "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{0E1D3C47-5A7B-4F21-9C3D-2B8E6F4A1D90}";
    playing.title = "Imaginary Track";
    playing.artist = "Fictional Artist";
    playing.album = "Imaginary Album";
    playing.albumArtist = "Various Fictional Artists";
    playing.playingLocation = PlayingLocation{"45837d74-fa4f-415c-bba9-bf2db8f0dc04", 3};
    playing.currentPlaylistId = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";

    CHECK(keysOf(json::parse(stateDocument({}, playing, {}))["player"]) == required);

    INFO("contract/openapi.yaml's GET /state examples do not match PlayerState.required");
    CHECK(publishedStatePlayerExample("built") == required);
    CHECK(publishedStatePlayerExample("building") == required);
}

// The one document a client reads without JSON.parse. Everything a TypeScript client needs to
// find the header at all is here: any of these three moving is a client reading garbage.
TEST_CASE("the snapshot is framed the way contract/openapi.yaml describes") {
    INFO(kUpdateSpec);

    LibraryBuilder builder({"%title%"}, 1);
    builder.sink().row(0, {"Music/", "a.flac", "0", "A title"});

    Library library;
    library.replace(builder.finish());

    const auto snapshot = library.exported();
    REQUIRE(snapshot.size() > 8);

    CHECK(snapshot.substr(0, 4) == "JLIB");

    const auto byteAt = [&snapshot](size_t at) {
        return static_cast<uint32_t>(static_cast<unsigned char>(snapshot[at]));
    };

    const auto headerLength = static_cast<size_t>(byteAt(4) | (byteAt(5) << 8U) |
                                                  (byteAt(6) << 16U) | (byteAt(7) << 24U));

    CHECK((8 + headerLength) % 4 == 0);

    const auto header = json::parse(snapshot.substr(8, headerLength));
    CHECK(keysOf(header) ==
          Keys{"kind", "structure", "revision", "trackCount", "columns", "spine"});
    CHECK(header["kind"] == "snapshot");

    CHECK(keysOf(header["columns"][0]) ==
          Keys{"name", "ids", "dict", "distinct", "hasUnresolved", "allUnresolved"});
    CHECK(keysOf(header["columns"][0]["ids"]) == Keys{"offset", "count", "width"});
    CHECK(keysOf(header["columns"][0]["dict"]) == Keys{"text", "ends"});
    CHECK(keysOf(header["spine"]) == Keys{"directory", "filename", "subsong"});
}

// A delta is framed like a snapshot and carries three keys a snapshot does not: `since` on the
// header, `ordinals` on a column, and `base` on its dictionary. A client generating types from
// the spec cannot decode one the spec does not declare all three of.
TEST_CASE("a delta is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    LibraryBuilder builder({"%title%", "%play_count%"}, 1);
    builder.sink().row(0, {"Music/", "a.flac", "0", "A title", "1"});

    Library library;
    library.replace(builder.finish());

    const uint64_t before = library.state().revision;
    REQUIRE(library.apply({{0, {"Music/", "a.flac", "0", "A title", "2"}}}) > before);

    const auto changes = library.changes(before);
    REQUIRE(changes.outcome == DeltaOutcome::ok);

    const auto header = decode(serialiseDelta(changes.delta)).header;

    CHECK(keysOf(header) ==
          Keys{"kind", "structure", "revision", "since", "trackCount", "columns", "spine"});
    CHECK(header["kind"] == "delta");

    const auto& moved = header["columns"][0];
    CHECK(keysOf(moved) ==
          Keys{"name", "ids", "ordinals", "dict", "distinct", "hasUnresolved", "allUnresolved"});
    CHECK(keysOf(moved["ordinals"]) == Keys{"offset", "count", "width"});
    CHECK(keysOf(moved["dict"]) == Keys{"text", "ends", "base"});
}

TEST_CASE("the library statuses contract/openapi.yaml documents are the ones we answer with") {
    INFO(kUpdateSpec);

    CHECK(httpStatusFor(LibraryRefusal::tooManyColumns) == 400);
    CHECK(httpStatusFor(LibraryRefusal::badColumn) == 400);
    CHECK(httpStatusFor(LibraryRefusal::duplicateColumn) == 400);
    CHECK(httpStatusFor(LibraryRefusal::badSince) == 400);

    CHECK(httpStatusFor(DeltaOutcome::ok) == 200);
    CHECK(httpStatusFor(DeltaOutcome::structureChanged) == 409);
    CHECK(httpStatusFor(DeltaOutcome::revisionTooOld) == 410);
    CHECK(httpStatusFor(DeltaOutcome::revisionUnknown) == 410);
    CHECK(httpStatusFor(DeltaOutcome::notBuilt) == 503);
}

// The spec enumerates these, so a client may switch on them: renaming one moves kApiVersion.
TEST_CASE("the error strings contract/openapi.yaml enumerates are the ones we send") {
    INFO(kUpdateSpec);

    CHECK(describe(TagWriteRefusal::malformedBody) == "malformed request");
    CHECK(describe(TagWriteRefusal::badAddress) == "unacceptable address");
    CHECK(describe(TagWriteRefusal::noFields) == "no fields to write");
    CHECK(describe(TagWriteRefusal::fieldNotAllowed) == "field not allowed");

    CHECK(describe(TagWriteOutcome::trackNotKnown) == "foobar2000 does not know that track");
    CHECK(describe(TagWriteOutcome::rowsMoved) ==
          "the playlist's rows were added, removed or reordered; read them again");
    CHECK(describe(TagWriteOutcome::writeFailed) == "the player could not write the tags");
    CHECK(describe(TagWriteOutcome::timedOut) == "the player did not answer in time");
    CHECK(describe(TagWriteOutcome::unavailable) == "tag writing is not available");

    CHECK(describe(PlaylistRefusal::malformedBody) == "malformed request");
    CHECK(describe(PlaylistRefusal::badTitle) == "unacceptable title");
    CHECK(describe(PlaylistRefusal::badKey) == "unacceptable key");
    CHECK(describe(PlaylistRefusal::badQuery) == "unacceptable query");
    CHECK(describe(PlaylistRefusal::badSort) == "unacceptable sort");
    CHECK(describe(PlaylistRefusal::badId) == "unacceptable playlist id");
    CHECK(describe(PlaylistRefusal::badOrdinals) == "unacceptable ordinal set");
    CHECK(describe(PlaylistRefusal::tooFast) == "too many requests");

    CHECK(describe(PlaylistOutcome::queryInvalid) == "foobar2000 could not read that query");
    CHECK(describe(PlaylistOutcome::noSuchPlaylist) == "no such playlist");
    CHECK(describe(PlaylistOutcome::notOurs) == "that playlist was not created by foo_jean");
    CHECK(describe(PlaylistOutcome::keyInUse) == "another playlist already has that key");
    CHECK(describe(PlaylistOutcome::tooMany) == "this install's autoplaylist limit is reached");
    CHECK(describe(PlaylistOutcome::structureMoved) ==
          "tracks were added or removed; export the library again");
    CHECK(describe(PlaylistOutcome::rowsMoved) ==
          "the playlist's rows were added, removed or reordered; read them again");
    CHECK(describe(PlaylistOutcome::rowsRevisionTooOld) ==
          "that revision is not one this playlist can catch up from; read its rows again");
    CHECK(describe(PlaylistOutcome::playerRefused) == "the player could not do that");
    CHECK(describe(PlaylistOutcome::timedOut) == "the player did not answer in time");
    CHECK(describe(PlaylistOutcome::unavailable) == "autoplaylists are not available");
    CHECK(describe(PlaylistOutcome::writesDisabled) ==
          "this install has playlist writes turned off; turn on writePlaylists in config.json to "
          "allow them");
    CHECK(describe(PlaylistOutcome::ownPlaylist) ==
          "that playlist is foo_jean's own; address it by its role rather than by its id");

    CHECK(describe(LibraryRefusal::tooManyColumns) == "too many columns");
    CHECK(describe(LibraryRefusal::badColumn) == "unacceptable column");
    CHECK(describe(LibraryRefusal::duplicateColumn) == "duplicate column");
    CHECK(describe(LibraryRefusal::badSince) == "unacceptable revision");

    CHECK(describe(DeltaOutcome::notBuilt) == "the library snapshot has not been built yet");
    CHECK(describe(DeltaOutcome::structureChanged) ==
          "tracks were added or removed; export the library again");
    CHECK(describe(DeltaOutcome::revisionTooOld) ==
          "that revision is older than the retained window; export the library again");
    CHECK(describe(DeltaOutcome::revisionUnknown) == "no such revision");
}

TEST_CASE("every playlist error contract/openapi.yaml publishes is one this component can send") {
    SUBCASE("PlaylistRefusal") {
        INFO("add the value to PlaylistRefusal in core/playlists.h, or take it out of the spec");
        CHECK(unsendable("PlaylistRefusal", everyDescribed<PlaylistRefusal>()) == std::string());
    }

    // POST /outputs/active answers its refusals in this same document, from OutputOutcome.
    SUBCASE("PlaylistFailed") {
        INFO(
            "the spec follows the component's wording: correct the value in "
            "contract/openapi.yaml, or add the enumerator to PlaylistOutcome in core/playlists.h "
            "or to OutputOutcome in core/outputs.h");
        auto described = everyDescribed<PlaylistOutcome>();
        const auto fromOutputs = everyDescribed<OutputOutcome>();
        described.insert(fromOutputs.begin(), fromOutputs.end());

        CHECK(unsendable("PlaylistFailed", described) == std::string());
    }
}

TEST_CASE("every refusal POST /outputs/active answers is published, under the status it is sent "
          "with") {
    INFO(kUpdateSpec);

    for (const auto outcome : {OutputOutcome::changeDisabled, OutputOutcome::notListed,
                               OutputOutcome::playerRefused, OutputOutcome::timedOut}) {
        const auto sentence = describe(outcome);
        INFO("error: ", sentence);
        CHECK(publishesError("PlaylistFailed", sentence));
        CHECK(publishes("POST", "/outputs/active", httpStatusFor(outcome)));
    }
}

TEST_CASE("a moved generation is refused with the 409 GET /library/changes already sends") {
    const auto moved = describe(DeltaOutcome::structureChanged);

    INFO("add an enumerator to PlaylistOutcome in core/playlists.h whose describe() is ", moved);
    CHECK(statusAnswered<PlaylistOutcome>(moved) == 409);

    INFO("and publish that string as a PlaylistFailed.error in contract/openapi.yaml");
    const auto published = publishedEnum("PlaylistFailed", "error");
    CHECK(std::count(published.begin(), published.end(), moved) == 1);
}

// Distinct from the structure-moved 409 above: a client naming a stale revision to a move, a
// remove or a positioned queue has a different remedy, re-reading the queue rather than
// exporting the library again, and needs a string of its own to tell the two apart.
TEST_CASE("a stale queue revision is refused with a 409 distinct from a moved structure") {
    const auto moved = describe(PlaylistOutcome::queueMoved);

    CHECK(moved != describe(DeltaOutcome::structureChanged));

    INFO("add an enumerator to PlaylistOutcome in core/playlists.h whose describe() is ", moved);
    CHECK(statusAnswered<PlaylistOutcome>(moved) == 409);

    INFO("and publish that string as a PlaylistFailed.error in contract/openapi.yaml");
    const auto published = publishedEnum("PlaylistFailed", "error");
    CHECK(std::count(published.begin(), published.end(), moved) == 1);
}

// Two media library roots can hold one library-relative path, so a library address can name a
// track under each. A client retries once with a precise address on this reason and on no
// other, and it reaches that client from two routes answering out of two enumerations, so one
// sentence has to come back from both or the client cannot tell it from anything else.
TEST_CASE("an address naming more than one track is one 409 both library routes send") {
    constexpr char kNamesMoreThanOneTrack[] = "more than one track";

    const auto fromTags = errorsSaying<TagWriteOutcome>(kNamesMoreThanOneTrack);
    const auto fromColumns = errorsSaying<PlaylistOutcome>(kNamesMoreThanOneTrack);

    INFO("add one enumerator to TagWriteOutcome and one to PlaylistOutcome, saying it");
    REQUIRE(fromTags.size() == 1);
    REQUIRE(fromColumns.size() == 1);
    CHECK(fromTags.front() == fromColumns.front());

    CHECK(statusAnswered<TagWriteOutcome>(fromTags.front()) == 409);
    CHECK(statusAnswered<PlaylistOutcome>(fromColumns.front()) == 409);

    INFO(kUpdateSpec);
    CHECK(publishesError("TagFailed", fromTags.front()));
    CHECK(publishesError("PlaylistFailed", fromColumns.front()));

    CHECK(publishes("POST", "/tags", 409));
    CHECK(publishes("GET", "/track/library", 409));
}

// Both generations are a 409 and the remedies differ. The playlist sentence tells a client to
// read a playlist's rows again, and a client whose library generation moved has no playlist to
// read: a true status carrying an instruction it cannot follow.
TEST_CASE("a write against a rebuilt library is a 409 distinct from a moved playlist") {
    constexpr char kLibraryWasRebuilt[] = "media library was rebuilt";

    const auto rebuilt = errorsSaying<TagWriteOutcome>(kLibraryWasRebuilt);

    INFO("add an enumerator to TagWriteOutcome in core/tag_write.h whose describe() says so");
    REQUIRE(rebuilt.size() == 1);
    CHECK(rebuilt.front() != describe(TagWriteOutcome::rowsMoved));
    CHECK(statusAnswered<TagWriteOutcome>(rebuilt.front()) == 409);

    INFO(kUpdateSpec);
    CHECK(publishesError("TagFailed", rebuilt.front()));
}

TEST_CASE("the statuses contract/openapi.yaml documents are the ones we answer with") {
    INFO(kUpdateSpec);

    CHECK(httpStatusFor(TagWriteRefusal::malformedBody) == 400);
    CHECK(httpStatusFor(TagWriteRefusal::badAddress) == 400);
    CHECK(httpStatusFor(TagWriteRefusal::noFields) == 400);
    CHECK(httpStatusFor(TagWriteRefusal::fieldNotAllowed) == 403);

    CHECK(httpStatusFor(TagWriteOutcome::written) == 200);
    CHECK(httpStatusFor(TagWriteOutcome::trackNotKnown) == 404);
    CHECK(httpStatusFor(TagWriteOutcome::rowsMoved) == 409);
    CHECK(httpStatusFor(TagWriteOutcome::writeFailed) == 500);
    CHECK(httpStatusFor(TagWriteOutcome::timedOut) == 504);
    CHECK(httpStatusFor(TagWriteOutcome::unavailable) == 503);
}

TEST_CASE("the versions contract/openapi.yaml states are the versions we report") {
    INFO(kUpdateSpec);
    CHECK(std::string(kVersion) == "0.4.0");
    CHECK(kApiVersion == 1);
}

// api_contract_test.cpp pins documents; nothing pins statuses per route, and the stream routes
// are where the two drifted apart. Every refusal each of them can make is driven here and the
// answer compared with what the specification publishes, so the code and the spec are compared
// by something other than a reader.
TEST_CASE("no stream route answers a status contract/openapi.yaml does not document") {
    INFO(kUpdateSpec);

    const TestServer serving(servingSettings(), wiredUp());

    // The same component with nothing wired up behind it, which is every 503 these routes have.
    const TestServer bare;

    auto capped = servingSettings();
    capped.maxConcurrentStreams = 0;
    const TestServer full(capped, wiredUp());

    const auto ticketFrom = [](const TestServer& server) {
        const auto issued = server.client().Post("/api/stream/ticket", "", "application/json");
        REQUIRE(issued);
        REQUIRE(issued->status == 200);
        return json::parse(issued->body)["ticket"].get<std::string>();
    };

    Statuses seen;

    note(seen, "POST /stream/ticket",
         serving.client().Post("/api/stream/ticket", "", "application/json"));
    note(seen, "POST /stream/ticket", post(serving, "/api/stream/ticket", "[]"));
    note(seen, "POST /stream/ticket",
         serving.client().Post("/api/stream/ticket", "x", "text/plain"));
    note(seen, "POST /stream/ticket",
         bare.client().Post("/api/stream/ticket", "", "application/json"));

    note(seen, "GET /stream", serving.client().Get("/api/stream?ticket=" + ticketFrom(serving)));
    note(seen, "GET /stream", serving.client().Get("/api/stream"));
    note(seen, "GET /stream",
         serving.client().Get("/api/stream?format=flac&ticket=" + ticketFrom(serving)));
    note(seen, "GET /stream", full.client().Get("/api/stream?ticket=" + ticketFrom(full)));

    note(seen, "GET /stream/listeners", serving.client().Get("/api/stream/listeners"));

    note(seen, "GET /stream/timeline", serving.client().Get("/api/stream/timeline"));
    note(seen, "GET /stream/timeline",
         bare.client().Get("/api/stream/timeline"));

    note(seen, "DELETE /stream/hold", serving.client().Delete("/api/stream/hold"));
    note(seen, "DELETE /stream/hold",
         bare.client().Delete("/api/stream/hold"));

    note(seen, "POST /stream/leave", post(serving, "/api/stream/leave", R"({"deviceId":"a"})"));
    note(seen, "POST /stream/leave", post(serving, "/api/stream/leave", "[]"));
    note(seen, "POST /stream/leave",
         serving.client().Post("/api/stream/leave", "a", "text/plain"));

    for (const auto& route : publishedRoutes()) {
        if (route.path.rfind("/stream", 0) != 0)
            continue;

        const auto name = route.method + " " + route.path;
        INFO("route: ", name);

        REQUIRE_FALSE(seen[name].empty());

        std::set<int> undocumented;
        std::set_difference(seen[name].begin(), seen[name].end(), route.statuses.begin(),
                            route.statuses.end(), std::inserter(undocumented, undocumented.end()));

        CHECK(listed(undocumented) == std::string());
    }
}

// Every other case here compares the spec with a document or a status table, and each passes
// just as happily for an operation that was published and never given a handler. What the router
// answers for a path nothing serves is learned rather than restated, so rewording it cannot turn
// this into a check that never fires.
TEST_CASE("every operation contract/openapi.yaml publishes has a route behind it") {
    const TestServer server;

    const auto ask = [&server](const std::string& method, const std::string& path) {
        auto client = server.client();
        if (method == "GET")
            return client.Get(path);
        if (method == "DELETE")
            return client.Delete(path);

        return client.Post(path, "{}", "application/json");
    };

    const auto dialable = [](const std::string& path) {
        std::string filled = "/api" + path;
        for (auto open = filled.find('{'); open != std::string::npos; open = filled.find('{')) {
            const auto close = filled.find('}', open);
            const auto name = filled.substr(open, close - open + 1);
            filled.replace(open, name.size(), name == "{id}" ? kPlaylistId : "0");
        }
        return filled;
    };

    for (const auto& route : publishedRoutes()) {
        const auto name = route.method + " " + route.path;
        INFO("route: ", name);

        const auto unrouted = ask(route.method, "/api/no-route-is-published-here");
        const auto answered = ask(route.method, dialable(route.path));

        REQUIRE(unrouted);
        REQUIRE(answered);
        CHECK_FALSE((answered->status == unrouted->status && answered->body == unrouted->body));
    }
}

TEST_CASE("capabilities carries canControlPlayback, on by default and off with the key") {
    const auto capabilities = [](const char* config) {
        const TestServer server(parseSettings(config));
        const auto response = server.client().Get("/api/capabilities");
        REQUIRE(response);
        REQUIRE(response->status == 200);
        return json::parse(response->body);
    };

    const auto absent = capabilities("{}");
    REQUIRE(absent.contains("canControlPlayback"));
    CHECK(absent["canControlPlayback"] == true);

    const auto off = capabilities(R"({"controlPlayback": false})");
    CHECK(off["canControlPlayback"] == false);
    CHECK(off["canWritePlaylists"] == true);
    CHECK(off["canChangeOutput"] == true);

    CHECK(capabilities(R"({"writePlaylists": false})")["canControlPlayback"] == true);
}

TEST_CASE("the playback refusal is a sentence contract/openapi.yaml publishes as PlaylistFailed") {
    INFO(kUpdateSpec);

    Player player = servingPlayer();
    player.commandTransport = [](Transport) { return PlaylistOutcome::done; };
    const TestServer server(parseSettings(R"({"controlPlayback": false})"), player);

    const auto response = server.client().Post("/api/playback/next", "", "application/json");

    REQUIRE(response);
    REQUIRE(response->status == 403);

    const auto error = json::parse(response->body, nullptr, false).value("error", json());
    REQUIRE(error.is_string());
    CHECK(publishesError("PlaylistFailed", error.get<std::string>()));
}

TEST_CASE("contract/openapi.yaml publishes a 403 on every route controlPlayback refuses") {
    INFO(kUpdateSpec);

    std::vector<std::string> guarded;
    for (const auto& route : publishedRoutes()) {
        const auto name = route.method + " " + route.path;
        const bool playback = route.method == "POST" &&
                              (route.path.rfind("/playback/", 0) == 0 || route.path == "/volume");
        const bool queueWrite = route.method != "GET" && route.path.rfind("/queue", 0) == 0;
        const bool named = name == "POST /playlists/{id}/items/{index}/play" ||
                           name == "POST /playlists/own/{role}/items" ||
                           name == "DELETE /playlists/own/{role}/items";

        if (playback || queueWrite || named)
            guarded.push_back(name);
    }

    REQUIRE(guarded.size() >= 14);

    for (const auto& name : guarded) {
        INFO("route: ", name);
        CHECK(publishes(name.substr(0, name.find(' ')), name.substr(name.find(' ') + 1), 403));
    }
}
