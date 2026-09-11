// The playlist routes over a real socket, the autoplaylists and the two fills. playlists_test.cpp
// covers the decisions behind them; what these add is that a refused request never reaches the
// player at all, and what a route asked of the player when it did.

#include "third_party/doctest.h"

#include "core/library.h"
#include "support/log_capture.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <iterator>
#include <map>
#include <numeric>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kCreate[] = R"({"title": "#Jean Rock", "query": "%genre% IS Rock"})";

PlaylistAnnotation rock() {
    AutoPlaylistSpec spec;
    spec.key = "folder:genre:Rock";
    spec.query = "%genre% IS Rock";

    PlaylistAnnotation playlist;
    playlist.id = kPlaylistId;
    playlist.beefwebId = "p3";
    playlist.index = 2;
    playlist.title = "#Jean Rock";
    playlist.isAutoPlaylist = true;
    playlist.managed = spec;
    return playlist;
}

struct PlayerLog {
    int creates = 0;
    int updates = 0;
    int removals = 0;
    AutoPlaylistSpec lastSpec;
    std::string lastId;
    PlaylistOutcome answer = PlaylistOutcome::done;
};

PlaylistResult answering(const PlayerLog* log) {
    PlaylistResult result;
    result.outcome = log->answer;
    result.playlist = rock();
    return result;
}

Player recordingPlayer(PlayerLog* log) {
    Player player;

    player.listPlaylists = [] { return PlaylistsResult{PlaylistOutcome::done, {rock()}}; };

    player.createAutoPlaylist = [log](const AutoPlaylistSpec& spec) {
        log->creates++;
        log->lastSpec = spec;
        return answering(log);
    };

    player.updateAutoPlaylist = [log](const std::string& id, const AutoPlaylistSpec& spec) {
        log->updates++;
        log->lastId = id;
        log->lastSpec = spec;
        return answering(log);
    };

    player.removeAutoPlaylist = [log](const std::string& id) {
        log->removals++;
        log->lastId = id;
        return answering(log);
    };

    player.previewQuery = [](const std::string& query) {
        PreviewResult preview;
        preview.valid = query != "bad";
        preview.error = preview.valid ? "" : "Query syntax error";
        preview.matches = preview.valid ? 412 : 0;
        preview.libraryEnabled = true;
        return preview;
    };

    return player;
}

json capabilitiesOf(const Settings& settings) {
    const TestServer server(settings);
    const auto response = server.client().Get("/api/capabilities", TestServer::bearer());

    REQUIRE(response);
    return json::parse(response->body);
}

// One id per role, so a test can say which of the component's own playlists a fill landed in.
constexpr char kScratchPlaylistId[] = "11111111-1111-1111-1111-111111111111";
constexpr char kQueuePlaylistId[] = "22222222-2222-2222-2222-222222222222";

constexpr char kScratchTitle[] = "#Jean Scratch";
constexpr char kQueueTitle[] = "#Jean Queue";

constexpr char kScratchFill[] = "/api/playlists/own/scratch/items";
constexpr char kQueueFill[] = "/api/playlists/own/queue/items";

std::string userFill() {
    return std::string("/api/playlists/") + kPlaylistId + "/items";
}

// Named rather than kept as the enum, so a failure names the playlist that was asked for.
std::string nameOf(OwnPlaylistRole role) {
    return role == OwnPlaylistRole::scratch ? "scratch" : "queue";
}

struct FillLog {
    // The roles the routes resolved, in order, and the title they handed over for the last one.
    std::vector<std::string> roles;
    std::string title;

    int fills = 0;
    std::string filled;
    bool replace = false;

    // The rows that landed, which stays empty when the filler refused the set.
    std::vector<uint32_t> inserted;

    // The generation of the snapshot the filler resolves ordinals against.
    uint64_t structure = 1;

    // How many rows each playlist holds before a fill reaches it. Seed it, and a position
    // answered for an append is a number no part of the request carries.
    std::map<std::string, size_t> held;

    // beefweb's id for a playlist a role resolved to, empty while beefweb has yet to see it.
    std::string beefwebId = "p4";
};

// Stands in for fb2k/playlists.cpp: a role resolves to the playlist carrying its marker, and a
// set resolved against a generation the player has moved past is refused rather than inserted.
Player fillingPlayer(FillLog* log) {
    Player player;

    player.ownPlaylist = [log](OwnPlaylistRole role, const std::string& title) {
        log->roles.push_back(nameOf(role));
        log->title = title;

        PlaylistAnnotation playlist;
        playlist.id = role == OwnPlaylistRole::scratch ? kScratchPlaylistId : kQueuePlaylistId;
        playlist.beefwebId = log->beefwebId;
        playlist.title = title;

        PlaylistResult result;
        result.playlist = playlist;
        return result;
    };

    player.fill = [log](const std::string& playlistId, uint64_t structure,
                        const std::vector<uint32_t>& ordinals, bool replace) {
        log->fills++;
        log->filled = playlistId;
        log->replace = replace;

        if (structure != log->structure)
            return FillResult{PlaylistOutcome::structureMoved, {}, ""};

        log->inserted.insert(log->inserted.end(), ordinals.begin(), ordinals.end());

        // A replace empties the playlist and an append leaves it alone, so a row lands after
        // whatever the playlist still holds. That is the shape of insert_items, and it is why
        // the positions a fill answers are not derivable from the request.
        auto& held = log->held[playlistId];
        if (replace)
            held = 0;

        std::vector<size_t> positions(ordinals.size());
        std::iota(positions.begin(), positions.end(), held);
        held += ordinals.size();

        return FillResult{PlaylistOutcome::done, std::move(positions), ""};
    };

    return player;
}

// Rows every target already holds before a fill reaches it. No request carries this number, so
// an append that answers a position past it answered something it learned from the player.
constexpr size_t kHeldRows = 5;

FillLog holding(uint64_t structure) {
    FillLog log;
    log.structure = structure;

    for (const char* id : {kScratchPlaylistId, kQueuePlaylistId, kPlaylistId})
        log.held[id] = kHeldRows;

    return log;
}

constexpr size_t kLibraryTracks = 8;

// What the ordinals in a fill are resolved against. The rows do not matter here: the size is
// what bounds an ordinal, and the generation is what a fill is checked against.
void buildLibrary(Library& library) {
    LibraryBuilder builder({"%title%"}, kLibraryTracks);
    auto& sink = builder.sink();

    for (size_t index = 0; index < kLibraryTracks; ++index) {
        const auto ordinal = std::to_string(index);
        sink.row(index, {"Artist/Album/", ordinal + ".flac", "0", "Track " + ordinal});
    }

    library.replace(builder.finish());
}

std::string ownBody(const std::string& title, uint64_t structure) {
    return R"({"title": ")" + title + R"(", "structure": )" + std::to_string(structure) +
           R"(, "ordinals": [3, 1]})";
}

std::string userBody(uint64_t structure) {
    return R"({"structure": )" + std::to_string(structure) + R"(, "ordinals": [3, 1]})";
}

// The three things a fill can be aimed at: both of the component's own, and a user's own.
// `replaces` is what the target alone decides, since no request form can carry it, and `id` is
// the playlist each one lands in: resolved from the role for the first two, taken from the path
// for the third.
struct Target {
    std::string name;
    std::string path;
    std::string body;
    bool replaces;
    std::string id;
};

std::vector<Target> targets(uint64_t structure) {
    return {
        {"the scratch role", kScratchFill, ownBody(kScratchTitle, structure), true,
         kScratchPlaylistId},
        {"the queue role", kQueueFill, ownBody(kQueueTitle, structure), false, kQueuePlaylistId},
        {"a user's playlist", userFill(), userBody(structure), false, kPlaylistId}};
}

std::string withField(const std::string& body, const std::string& field, const json& value) {
    auto document = json::parse(body);
    document[field] = value;
    return document.dump();
}

// Swaps the set a body names for another. A request carries exactly one of `runs`, `bitset` and
// `ordinals`, so the one already there goes before the new one arrives.
std::string naming(const std::string& body, const json& set) {
    auto document = json::parse(body);
    document.erase("ordinals");
    document.update(set);
    return document.dump();
}

// The two targets a fill appends to, which are the ones whose positions start where the playlist
// already ended rather than at zero.
std::vector<Target> appendTargets(uint64_t structure, const json& set) {
    auto all = targets(structure);

    all.erase(std::remove_if(all.begin(), all.end(),
                             [](const Target& target) { return target.replaces; }),
              all.end());

    for (auto& target : all)
        target.body = naming(target.body, set);

    return all;
}

}  // namespace

TEST_CASE("the playlist annotation is what beefweb cannot answer") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    const auto response = server.client().Get("/api/playlists", TestServer::bearer());

    REQUIRE(response);
    CHECK(response->status == 200);

    const auto body = json::parse(response->body);
    REQUIRE(body["playlists"].size() == 1);

    const auto& playlist = body["playlists"][0];
    CHECK(playlist["id"] == kPlaylistId);
    CHECK(playlist["beefwebId"] == "p3");
    CHECK(playlist["isAutoPlaylist"] == true);
    CHECK(playlist["managed"]["key"] == "folder:genre:Rock");
}

// Null rather than blank, so a client can tell "beefweb has not named this yet" and "foo_jean
// did not create this" from a value that happens to be empty.
TEST_CASE("what we do not know is null rather than an empty string") {
    const TestServer server(servingSettings(), TestServer::listing([] {
                                PlaylistAnnotation plain;
                                plain.title = "Ordinary playlist";
                                return PlaylistsResult{PlaylistOutcome::done, {plain}};
                            }));

    const auto response = server.client().Get("/api/playlists", TestServer::bearer());

    REQUIRE(response);
    const auto body = json::parse(response->body);
    const auto& playlist = body["playlists"][0];
    CHECK(playlist["beefwebId"].is_null());
    CHECK(playlist["managed"].is_null());
    CHECK(playlist["isAutoPlaylist"] == false);
}

TEST_CASE("every playlist route needs the token") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    CHECK(server.client().Get("/api/playlists")->status == 401);
    CHECK(server.client().Post("/api/autoplaylists", kCreate, "application/json")->status == 401);
    CHECK(server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId)->status == 401);

    CHECK(log.creates == 0);
    CHECK(log.removals == 0);
}

TEST_CASE("creating passes the whole request through to the player") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    const auto response = post(server, "/api/autoplaylists",
                               R"({"title": "#Jean Rock", "key": "folder:genre:Rock",
                                   "query": "%genre% IS Rock", "forceSort": true})");

    REQUIRE(response);
    CHECK(response->status == 200);
    CHECK(json::parse(response->body)["id"] == kPlaylistId);

    REQUIRE(log.creates == 1);
    CHECK(log.lastSpec.title == "#Jean Rock");
    CHECK(log.lastSpec.key == "folder:genre:Rock");
    CHECK(log.lastSpec.query == "%genre% IS Rock");
    CHECK(log.lastSpec.forceSort);
}

TEST_CASE("a request the component can judge for itself never reaches the player") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    for (const char* body : {"not json", R"({"query": "%genre% IS Rock"})",
                             R"({"title": "#Jean Rock"})", R"({"title": "", "query": "a"})"}) {
        INFO("body: ", body);
        const auto response = post(server, "/api/autoplaylists", body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"].is_string());
    }

    CHECK(log.creates == 0);
}

TEST_CASE("what the player says about a playlist maps onto a status a client can act on") {
    struct Case {
        PlaylistOutcome outcome;
        int status;
    };

    for (const auto& expected :
         {Case{PlaylistOutcome::queryInvalid, 400}, Case{PlaylistOutcome::notOurs, 403},
          Case{PlaylistOutcome::noSuchPlaylist, 404}, Case{PlaylistOutcome::keyInUse, 409},
          Case{PlaylistOutcome::tooMany, 409}, Case{PlaylistOutcome::playerRefused, 500},
          Case{PlaylistOutcome::timedOut, 504}, Case{PlaylistOutcome::unavailable, 503}}) {
        PlayerLog log;
        log.answer = expected.outcome;
        const TestServer server(servingSettings(), recordingPlayer(&log));

        const auto response = post(server, "/api/autoplaylists", kCreate);

        INFO("outcome: ", describe(expected.outcome));
        REQUIRE(response);
        CHECK(response->status == expected.status);
    }
}

TEST_CASE("a component with no player refuses honestly rather than pretending it did the work") {
    const TestServer server;

    CHECK(server.client().Get("/api/playlists", TestServer::bearer())->status == 503);
    CHECK(post(server, "/api/autoplaylists", kCreate)->status == 503);
    CHECK(post(server, "/api/autoplaylists/preview", R"({"query": "a"})")->status == 503);
    CHECK(server.client()
              .Delete(std::string("/api/autoplaylists/") + kPlaylistId, TestServer::bearer())
              ->status == 503);
}

TEST_CASE("updating and removing address one playlist by its id") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    const auto updated = post(server, std::string("/api/autoplaylists/") + kPlaylistId,
                              R"({"query": "%genre% IS Jazz"})");

    REQUIRE(updated);
    CHECK(updated->status == 200);
    CHECK(log.updates == 1);
    CHECK(log.lastId == kPlaylistId);
    CHECK(log.lastSpec.query == "%genre% IS Jazz");

    const auto removed = server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId,
                                                TestServer::bearer());

    REQUIRE(removed);
    CHECK(removed->status == 200);
    CHECK(json::parse(removed->body)["removed"] == true);
    CHECK(json::parse(removed->body)["id"] == kPlaylistId);
    CHECK(log.removals == 1);
}

// pfc::GUID_from_text reads an unknown character as zero and never reports failure, so a
// nonsense id would otherwise become a well-formed GUID that matches something one day.
TEST_CASE("an id that is not one we issued never reaches the player") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    // Wrong shape entirely, so the router has no route for them at all.
    for (const char* id : {"nonsense", "45837D74-FA4F-415C-BBA9-BF2DB8F0DC04", "../../etc"}) {
        INFO("id: ", id);
        const auto response =
            server.client().Delete(std::string("/api/autoplaylists/") + id, TestServer::bearer());
        REQUIRE(response);
        CHECK(response->status == 404);
    }

    // Right length and right alphabet, so this one reaches our own check and is refused by
    // name rather than as a missing route.
    const auto response = server.client().Delete(
        "/api/autoplaylists/------------------------------------", TestServer::bearer());

    REQUIRE(response);
    CHECK(response->status == 400);

    CHECK(log.removals == 0);
}

// A client calls this while somebody is still typing.
TEST_CASE("previewing a query answers 200 whether or not the query parses") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    const auto good = post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock"})");

    REQUIRE(good);
    CHECK(good->status == 200);
    CHECK(json::parse(good->body)["valid"] == true);
    CHECK(json::parse(good->body)["matches"] == 412);
    CHECK(json::parse(good->body)["libraryEnabled"] == true);

    const auto bad = post(server, "/api/autoplaylists/preview", R"({"query": "bad"})");

    REQUIRE(bad);
    CHECK(bad->status == 200);
    CHECK(json::parse(bad->body)["valid"] == false);
    CHECK(json::parse(bad->body)["error"] == "Query syntax error");
}

// "preview" cannot match the id pattern, so this holds whatever order the routes are in.
TEST_CASE("previewing is not mistaken for a playlist id") {
    PlayerLog log;
    const TestServer server(servingSettings(), recordingPlayer(&log));

    post(server, "/api/autoplaylists/preview", R"({"query": "%genre% IS Rock"})");

    CHECK(log.updates == 0);
}

TEST_CASE("a client stuck in a loop is slowed down rather than obeyed") {
    PlayerLog log;
    clearLog();
    const TestServer server(servingSettings(), recordingPlayer(&log));

    std::vector<httplib::Result> replies;
    std::generate_n(std::back_inserter(replies), 60,
                    [&server] { return post(server, "/api/autoplaylists", kCreate); });

    const auto refused =
        std::count_if(replies.begin(), replies.end(),
                      [](const httplib::Result& r) { return r && r->status == 429; });

    // The limit refuses work; it does not drop callers.
    CHECK(std::all_of(replies.begin(), replies.end(),
                      [](const httplib::Result& r) { return static_cast<bool>(r); }));
    CHECK(refused > 0);
    CHECK(log.creates < 60);

    const auto first429 =
        std::find_if(replies.begin(), replies.end(),
                     [](const httplib::Result& r) { return r && r->status == 429; });
    REQUIRE(first429 != replies.end());
    CHECK((*first429)->get_header_value("Retry-After") == "1");
    CHECK(json::parse((*first429)->body)["error"].is_string());

    // A line for the burst rather than one per refusal, which would be the same flood written
    // to a disk. Not pinned to exactly one: a slow machine can earn a token back mid-burst.
    const auto lines = loggedLines();
    const auto complaints = std::count_if(lines.begin(), lines.end(), [](const std::string& line) {
        return line.find("refusing playlist changes") != std::string::npos;
    });

    CHECK(complaints >= 1);
    CHECK(complaints < refused);

    // Reading changes nothing, so it is not limited and a different route cannot spend it.
    CHECK(server.client().Get("/api/playlists", TestServer::bearer())->status == 200);
}

TEST_CASE("an install that allows no autoplaylists says so before a client offers to make one") {
    SUBCASE("the default install can create, and says how many") {
        const TestServer server(servingSettings());
        const auto body =
            json::parse(server.client().Get("/api/capabilities", TestServer::bearer())->body);

        CHECK(body["canCreateAutoPlaylists"] == true);
        CHECK(body["maxAutoPlaylists"] == Settings().maxAutoPlaylists);
    }

    SUBCASE("a cap of zero reads as off rather than as a limit of zero to discover") {
        auto settings = servingSettings();
        settings.maxAutoPlaylists = 0;

        const TestServer server(settings);
        const auto body =
            json::parse(server.client().Get("/api/capabilities", TestServer::bearer())->body);

        CHECK(body["canCreateAutoPlaylists"] == false);
        CHECK(body["maxAutoPlaylists"] == 0);
    }
}

TEST_CASE("creating an autoplaylist needs both a cap to spend and writable playlists") {
    const auto offered = [](bool writePlaylists, int maxAutoPlaylists) {
        auto settings = servingSettings();
        settings.writePlaylists = writePlaylists;
        settings.maxAutoPlaylists = maxAutoPlaylists;

        return capabilitiesOf(settings)["canCreateAutoPlaylists"];
    };

    CHECK(offered(true, 4) == true);
    CHECK(offered(false, 4) == false);
    CHECK(offered(true, 0) == false);
    CHECK(offered(false, 0) == false);
}

TEST_CASE("GET /api/capabilities says whether this install permits playlist writes") {
    SUBCASE("a config nobody narrowed permits them") {
        CHECK(capabilitiesOf(servingSettings())["canWritePlaylists"] == true);
    }

    SUBCASE("read-only is published, rather than left for a client to learn from a refusal") {
        auto settings = servingSettings();
        settings.writePlaylists = false;

        CHECK(capabilitiesOf(settings)["canWritePlaylists"] == false);
    }
}

// An ordinal is a position, so a rebuild moves every one of them: a set resolved against a
// generation the library has left names different tracks rather than stale ones, and inserting
// it would play music nobody asked for. Both fill operations, because the check being written
// into one of them and not the other is how this breaks.
TEST_CASE("a fill resolved against a generation the library has moved past inserts nothing") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    // Tracks added or removed, which is the rebuild every ordinal shifts under.
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const auto& target : targets(exported)) {
        INFO("target: ", target.name);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);

        // The same words GET /api/library/changes answers with, because the remedy is the same
        // one: export the library again, then ask again.
        CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    }

    CHECK(log.inserted.empty());
}

// Two operations split by who owns the playlist. The component's own are addressed by a role it
// resolves through its own marker; a user's is addressed by the GUID in the path and resolves
// nothing, which is what keeps a title out of the decision about who owns what.
TEST_CASE("each fill operation addresses its own kind of playlist") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    SUBCASE("the scratch role fills the playlist that role resolved to") {
        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, log.structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(log.roles == std::vector<std::string>{"scratch"});
        CHECK(log.title == kScratchTitle);
        CHECK(log.filled == kScratchPlaylistId);
        CHECK(log.inserted == std::vector<uint32_t>{3, 1});
    }

    SUBCASE("the queue role fills the other one") {
        const auto response = post(server, kQueueFill, ownBody(kQueueTitle, log.structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(log.roles == std::vector<std::string>{"queue"});
        CHECK(log.title == kQueueTitle);
        CHECK(log.filled == kQueuePlaylistId);
    }

    SUBCASE("a user's playlist is filled by the GUID it was asked for, resolving no role") {
        const auto response = post(server, userFill(), userBody(log.structure));

        REQUIRE(response);
        CHECK(response->status == 200);
        CHECK(log.roles.empty());
        CHECK(log.filled == kPlaylistId);
    }
}

// The role is a closed enum, so a client cannot name a third playlist of its own invention. This
// is the case that fails if a role is ever resolved from a free string.
TEST_CASE("a role the contract does not name is refused rather than made") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const std::string& role : {std::string("library"), std::string("Scratch"),
                                    std::string("queue2"), std::string(kPlaylistId)}) {
        INFO("role: ", role);

        const auto response = post(server, "/api/playlists/own/" + role + "/items",
                                   ownBody(kScratchTitle, log.structure));

        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
}

// Whether a fill empties the playlist first follows from the target, so there is no field in any
// of the three request forms that could say otherwise, and no default to get wrong. What the
// playlist then holds is the player's, and fb2k/playlists.cpp is where it is decided.
TEST_CASE("the scratch playlist is emptied before a fill and every other target is appended to") {
    Library library;
    buildLibrary(library);

    for (const auto& target : targets(library.state().structure)) {
        INFO("target: ", target.name);

        FillLog log;
        log.structure = library.state().structure;
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 200);
        REQUIRE(log.fills == 1);
        CHECK(log.replace == target.replaces);
    }
}

// Both fill schemas publish `additionalProperties: false`, and `replace` is the field that costs:
// a fill empties the playlist or appends to it according to the target, so a client sending it
// would be told nothing while the component appended. `items` is what beefweb's own
// add-from-library names its rows, and it is here because the rule is every field the contract
// does not declare rather than `replace` in particular.
TEST_CASE("a field neither fill schema declares is refused, and nothing is inserted") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    const std::vector<std::pair<std::string, json>> undeclared{
        {"replace", true}, {"items", json::array({"Artist/Album/1.flac"})}};

    for (const auto& target : targets(log.structure)) {
        for (const auto& field : undeclared) {
            INFO("target: ", target.name, ", field: ", field.first);

            const auto response =
                post(server, target.path, withField(target.body, field.first, field.second));

            REQUIRE(response);
            CHECK(response->status == 400);

            // The envelope was wrong rather than the set, which is the other refusal a client
            // switches on here: it would send a caller looking at ordinals it sent correctly.
            CHECK(json::parse(response->body)["error"] == "malformed request");
        }
    }

    // Resolving a role makes the playlist if it is not there, so a refusal that reaches the player
    // leaves a `#Jean` playlist behind for a request that was never acceptable.
    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
}

// `title` is a field of FillOwnPlaylistRequest and of no other body. A client says what to call a
// playlist the component makes for a role; a playlist a user already has keeps the name the user
// gave it, so the same field on that route is a client meaning something this component will not
// do.
TEST_CASE("a title is declared on the component's own playlists and undeclared on a user's") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    SUBCASE("both of the component's own roles take one") {
        const auto scratch = post(server, kScratchFill, ownBody(kScratchTitle, log.structure));
        REQUIRE(scratch);
        CHECK(scratch->status == 200);

        const auto queue = post(server, kQueueFill, ownBody(kQueueTitle, log.structure));
        REQUIRE(queue);
        CHECK(queue->status == 200);

        CHECK(log.fills == 2);
    }

    SUBCASE("a user's playlist is refused rather than retitled") {
        const auto response =
            post(server, userFill(), withField(userBody(log.structure), "title", "#Jean Scratch"));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "malformed request");
        CHECK(log.fills == 0);
    }
}

// What the answer is for: a client that has queued a set learns where its rows went instead of
// reading the playlist back and matching rows to refs, which is the linear re-match Jean does
// today. Filling a playlist that already holds rows is what tells a real position apart from the
// ordinals handed back, or from a count that always starts at zero.
TEST_CASE("a fill answers the positions the rows landed at rather than the ordinals it was given") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    SUBCASE("an append lands after the rows the playlist already held") {
        for (const auto& target :
             appendTargets(structure, json{{"ordinals", json::array({3, 1, 6})}})) {
            INFO("target: ", target.name);

            auto log = holding(structure);
            const TestServer server(servingSettings(), fillingPlayer(&log), &library);

            const auto response = post(server, target.path, target.body);

            REQUIRE(response);
            REQUIRE(response->status == 200);
            CHECK(json::parse(response->body)["positions"] == json::array({5, 6, 7}));
        }
    }

    SUBCASE("a replace lands at zero, because the scratch is emptied before it is filled") {
        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["positions"] == json::array({0, 1}));
    }

    // `runs` names no row one at a time, so neither the positions nor how many there are can be
    // read off the request at all.
    SUBCASE("a set given as runs answers one position per row the runs expand to") {
        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto body =
            naming(ownBody(kQueueTitle, structure),
                   json{{"runs", json::array({json::array({0, 2}), json::array({5, 1})})}});

        const auto response = post(server, kQueueFill, body);

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["positions"] == json::array({5, 6, 7}));
    }
}

// One field, two sources. The `own` route answers the id the role resolved to, which the client
// never named and has no other way to learn, and the `{id}` route answers the id the request
// carried. A client addresses a queue entry as a playlist and an index, so the positions are
// worth nothing beside the wrong playlist.
TEST_CASE("a fill answers the id of the playlist the rows landed in") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    for (const auto& target : targets(structure)) {
        INFO("target: ", target.name);

        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["playlistId"] == target.id);
    }
}

// A client joins this answer to beefweb's playlist list, and beefweb rebuilds its map on its own
// schedule, so there is not always an id to give. Absent and null read differently: the field is
// answered every time, and null says ask beefweb again rather than that anything went wrong.
TEST_CASE("a fill answers beefweb's id for that playlist, or null where beefweb has none yet") {
    Library library;
    buildLibrary(library);
    const uint64_t structure = library.state().structure;

    SUBCASE("a playlist beefweb has already mapped is answered by the id it reported") {
        auto log = holding(structure);
        log.beefwebId = "p7";
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, kQueueFill, ownBody(kQueueTitle, structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);
        CHECK(json::parse(response->body)["beefwebId"] == "p7");
    }

    SUBCASE("one beefweb has not seen yet is null rather than blank or missing") {
        auto log = holding(structure);
        log.beefwebId = "";
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, kScratchFill, ownBody(kScratchTitle, structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);

        auto body = json::parse(response->body);
        CHECK(body.contains("beefwebId"));
        CHECK(body["beefwebId"].is_null());
    }

    // The fill this fake answers carries no beefweb id, so the field comes back null here.
    // Either answer is legal on a real install: whether beefweb has named a playlist yet
    // depends on when it last rebuilt its map.
    SUBCASE("a user's playlist answers the field as well") {
        auto log = holding(structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = post(server, userFill(), userBody(structure));

        REQUIRE(response);
        REQUIRE(response->status == 200);

        auto body = json::parse(response->body);
        CHECK(body.contains("beefwebId"));
        CHECK((body["beefwebId"].is_null() || body["beefwebId"].is_string()));
    }
}
