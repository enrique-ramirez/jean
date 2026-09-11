// A tripwire on the wire format: these pin the exact key set of every document this component
// publishes, so a field added, renamed or dropped without editing contract/openapi.yaml turns one
// red. The last case does the same for the statuses of the stream routes, by driving them and
// comparing what came back against what the specification says they answer. Anything about
// behaviour belongs in the other files.

#include "third_party/doctest.h"

#include "core/api.h"
#include "core/version.h"
#include "support/fixtures.h"
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

using Keys = std::set<std::string>;

Keys keysOf(const std::string& document) {
    const auto body = json::parse(document);
    const auto entries = body.items();

    Keys keys;
    std::transform(entries.begin(), entries.end(), std::inserter(keys, keys.end()),
                   [](const auto& entry) { return entry.key(); });
    return keys;
}

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

int statusAnswered(const std::string& error) {
    for (int raw = 0;; ++raw) {
        const auto outcome = static_cast<PlaylistOutcome>(raw);
        const auto described = describe(outcome);

        if (described == "unknown")
            return 0;
        if (described == error)
            return httpStatusFor(outcome);
    }
}

}  // namespace

TEST_CASE("GET /status is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);
    CHECK(keysOf(statusDocument()) == Keys{"name", "version", "apiVersion", "authRequired"});
}

TEST_CASE("GET /capabilities is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);
    CHECK(keysOf(capabilitiesDocument(servingSettings(), {"opus", "aac"}, true, true)) ==
          Keys{"apiVersion", "allowedFields", "canWrite", "canWritePlaylists", "maxAutoPlaylists",
               "canCreateAutoPlaylists", "canStream", "streamFormats", "canMuteWhileStreaming",
               "canReadLibrary"});
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

TEST_CASE("a pairing answer is the shape contract/openapi.yaml publishes") {
    // The one document carrying the token, read by a caller that has proved only its address.
    CHECK(keysOf(pairedDocument(std::string(kToken))) == Keys{"token", "apiVersion"});
}

TEST_CASE("a stream timeline is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    StreamMark mark;
    mark.at = 491.46;
    mark.path = R"(F:\Music\a.flac)";

    CHECK(keysOf(streamTimelineDocument(12.5, {mark})) == Keys{"streamTime", "marks"});

    // The client's own `anchor + currentTime` arithmetic reads exactly these four, so
    // renaming one of them is a client that silently stops following the audio.
    CHECK(keysOf(json::parse(streamTimelineDocument(12.5, {mark}))["marks"][0].dump()) ==
          Keys{"at", "path", "subsong", "position"});
}

TEST_CASE("a successful write is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    TagWrite write;
    write.track.path = R"(F:\a\b.mp3)";
    write.fields = {{"rating", "4"}};

    CHECK(keysOf(tagWrittenDocument(write)) == Keys{"written", "path", "subsong", "fields"});
}

TEST_CASE("a refusal is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    const auto refused =
        parseTagWrite(R"({"path": "F:\\a.mp3", "fields": {"artist": "x"}})", servingSettings());
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

TEST_CASE("the discovery record is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    CHECK(keysOf(discoveryDocument(servingSettings(), listeningStatus())) ==
          Keys{"name", "version", "apiVersion", "port", "authRequired", "listening"});

    ListenerStatus taken;
    taken.error = "could not bind";
    taken.portInUse = true;

    CHECK(keysOf(discoveryDocument(servingSettings(), taken)) ==
          Keys{"name", "version", "apiVersion", "port", "authRequired", "listening", "error",
               "portInUse"});
}

TEST_CASE("a playlist annotation is the shape contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    PlaylistAnnotation playlist;
    playlist.managed = AutoPlaylistSpec();

    const auto keys = Keys{"id", "beefwebId", "index", "title", "isAutoPlaylist", "managed"};
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
    CHECK(keysOf(managed.dump()) == Keys{"key", "query", "sort", "forceSort"});
}

TEST_CASE("the other playlist answers are the shapes contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    CHECK(keysOf(playlistRemovedDocument(kPlaylistId)) == Keys{"removed", "id"});

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
    CHECK(httpStatusFor(PlaylistOutcome::notOurs) == 403);
    CHECK(httpStatusFor(PlaylistOutcome::noSuchPlaylist) == 404);
    CHECK(httpStatusFor(PlaylistOutcome::keyInUse) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::tooMany) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::structureMoved) == 409);
    CHECK(httpStatusFor(PlaylistOutcome::playerRefused) == 500);
    CHECK(httpStatusFor(PlaylistOutcome::timedOut) == 504);
    CHECK(httpStatusFor(PlaylistOutcome::unavailable) == 503);
    CHECK(httpStatusFor(PlaylistOutcome::writesDisabled) == 403);
}

TEST_CASE("the library answers are the shapes contract/openapi.yaml publishes") {
    INFO(kUpdateSpec);

    Library::State state;
    state.ready = true;
    state.structure = 41;
    state.revision = 903;
    state.trackCount = 30441;
    state.columns = {"%title%"};

    CHECK(keysOf(libraryDocument(state)) ==
          Keys{"ready", "structure", "revision", "trackCount", "columns"});

    const auto refused = parseLibraryRequest({"%title%", "%title%"}, std::string());
    REQUIRE_FALSE(refused.ok());
    CHECK(keysOf(libraryRefusedDocument(refused)) == Keys{"error", "detail"});

    CHECK(keysOf(libraryFailedDocument(DeltaOutcome::structureChanged)) == Keys{"error", "detail"});
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
    CHECK(keysOf(header.dump()) ==
          Keys{"kind", "structure", "revision", "trackCount", "columns", "spine"});
    CHECK(header["kind"] == "snapshot");

    CHECK(keysOf(header["columns"][0].dump()) ==
          Keys{"name", "ids", "dict", "distinct", "hasUnresolved", "allUnresolved"});
    CHECK(keysOf(header["columns"][0]["ids"].dump()) == Keys{"offset", "count", "width"});
    CHECK(keysOf(header["columns"][0]["dict"].dump()) == Keys{"text", "ends"});
    CHECK(keysOf(header["spine"].dump()) == Keys{"directory", "filename", "subsong"});
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

    CHECK(keysOf(header.dump()) ==
          Keys{"kind", "structure", "revision", "since", "trackCount", "columns", "spine"});
    CHECK(header["kind"] == "delta");

    const auto& moved = header["columns"][0];
    CHECK(keysOf(moved.dump()) ==
          Keys{"name", "ids", "ordinals", "dict", "distinct", "hasUnresolved", "allUnresolved"});
    CHECK(keysOf(moved["ordinals"].dump()) == Keys{"offset", "count", "width"});
    CHECK(keysOf(moved["dict"].dump()) == Keys{"text", "ends", "base"});
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
    CHECK(describe(TagWriteRefusal::missingPath) == "missing path");
    CHECK(describe(TagWriteRefusal::unsafePath) == "unacceptable path");
    CHECK(describe(TagWriteRefusal::noFields) == "no fields to write");
    CHECK(describe(TagWriteRefusal::fieldNotAllowed) == "field not allowed");

    CHECK(describe(TagWriteOutcome::trackNotKnown) == "foobar2000 does not know that track");
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
    CHECK(describe(PlaylistOutcome::playerRefused) == "the player could not do that");
    CHECK(describe(PlaylistOutcome::timedOut) == "the player did not answer in time");
    CHECK(describe(PlaylistOutcome::unavailable) == "autoplaylists are not available");
    CHECK(describe(PlaylistOutcome::writesDisabled) ==
          "this install has playlist writes turned off; turn on writePlaylists in config.json to "
          "allow them");

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

    SUBCASE("PlaylistFailed") {
        INFO("the spec follows the component's wording: correct the value in "
             "contract/openapi.yaml, or add the enumerator to PlaylistOutcome in core/playlists.h");
        CHECK(unsendable("PlaylistFailed", everyDescribed<PlaylistOutcome>()) == std::string());
    }
}

TEST_CASE("a moved generation is refused with the 409 GET /library/changes already sends") {
    const auto moved = describe(DeltaOutcome::structureChanged);

    INFO("add an enumerator to PlaylistOutcome in core/playlists.h whose describe() is ", moved);
    CHECK(statusAnswered(moved) == 409);

    INFO("and publish that string as a PlaylistFailed.error in contract/openapi.yaml");
    const auto published = publishedEnum("PlaylistFailed", "error");
    CHECK(std::count(published.begin(), published.end(), moved) == 1);
}

TEST_CASE("the statuses contract/openapi.yaml documents are the ones we answer with") {
    INFO(kUpdateSpec);

    CHECK(httpStatusFor(TagWriteRefusal::malformedBody) == 400);
    CHECK(httpStatusFor(TagWriteRefusal::missingPath) == 400);
    CHECK(httpStatusFor(TagWriteRefusal::unsafePath) == 400);
    CHECK(httpStatusFor(TagWriteRefusal::noFields) == 400);
    CHECK(httpStatusFor(TagWriteRefusal::fieldNotAllowed) == 403);

    CHECK(httpStatusFor(TagWriteOutcome::written) == 200);
    CHECK(httpStatusFor(TagWriteOutcome::trackNotKnown) == 404);
    CHECK(httpStatusFor(TagWriteOutcome::writeFailed) == 500);
    CHECK(httpStatusFor(TagWriteOutcome::timedOut) == 504);
    CHECK(httpStatusFor(TagWriteOutcome::unavailable) == 503);
}

TEST_CASE("the versions contract/openapi.yaml states are the versions we report") {
    INFO(kUpdateSpec);
    CHECK(std::string(kVersion) == "0.3.0");
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
        const auto issued = server.client().Post("/api/stream/ticket", TestServer::bearer(), "",
                                                 "application/json");
        REQUIRE(issued);
        REQUIRE(issued->status == 200);
        return json::parse(issued->body)["ticket"].get<std::string>();
    };

    Statuses seen;

    note(seen, "POST /stream/ticket",
         serving.client().Post("/api/stream/ticket", TestServer::bearer(), "", "application/json"));
    note(seen, "POST /stream/ticket",
         serving.client().Post("/api/stream/ticket", "", "application/json"));
    note(seen, "POST /stream/ticket", post(serving, "/api/stream/ticket", "[]"));
    note(seen, "POST /stream/ticket",
         serving.client().Post("/api/stream/ticket", TestServer::bearer(), "x", "text/plain"));
    note(seen, "POST /stream/ticket",
         bare.client().Post("/api/stream/ticket", TestServer::bearer(), "", "application/json"));

    note(seen, "GET /stream", serving.client().Get("/api/stream?ticket=" + ticketFrom(serving)));
    note(seen, "GET /stream", serving.client().Get("/api/stream"));
    note(seen, "GET /stream",
         serving.client().Get("/api/stream?format=flac&ticket=" + ticketFrom(serving)));
    note(seen, "GET /stream", full.client().Get("/api/stream?ticket=" + ticketFrom(full)));

    note(seen, "GET /stream/listeners",
         serving.client().Get("/api/stream/listeners", TestServer::bearer()));
    note(seen, "GET /stream/listeners", serving.client().Get("/api/stream/listeners"));

    note(seen, "GET /stream/timeline",
         serving.client().Get("/api/stream/timeline", TestServer::bearer()));
    note(seen, "GET /stream/timeline", serving.client().Get("/api/stream/timeline"));
    note(seen, "GET /stream/timeline",
         bare.client().Get("/api/stream/timeline", TestServer::bearer()));

    note(seen, "DELETE /stream/hold",
         serving.client().Delete("/api/stream/hold", TestServer::bearer()));
    note(seen, "DELETE /stream/hold", serving.client().Delete("/api/stream/hold"));
    note(seen, "DELETE /stream/hold",
         bare.client().Delete("/api/stream/hold", TestServer::bearer()));

    note(seen, "POST /stream/leave", post(serving, "/api/stream/leave", R"({"deviceId":"a"})"));
    note(seen, "POST /stream/leave", post(serving, "/api/stream/leave", "[]"));
    note(seen, "POST /stream/leave",
         serving.client().Post("/api/stream/leave", R"({"deviceId":"a"})", "application/json"));
    note(seen, "POST /stream/leave",
         serving.client().Post("/api/stream/leave", TestServer::bearer(), "a", "text/plain"));

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
