// The playlist routes over a real socket, the autoplaylists and the two fills. playlists_test.cpp
// covers the decisions behind them; what these add is that a refused request never reaches the
// player at all, and what a route asked of the player when it did.

#include "third_party/doctest.h"

#include "core/library.h"
#include "support/log_capture.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <functional>
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

constexpr char kScratchPlaylistId[] = "11111111-1111-1111-1111-111111111111";
constexpr char kQueuePlaylistId[] = "22222222-2222-2222-2222-222222222222";

constexpr char kScratchTitle[] = "#Jean Scratch";
constexpr char kQueueTitle[] = "#Jean Queue";

constexpr char kScratchFill[] = "/api/playlists/own/scratch/items";
constexpr char kQueueFill[] = "/api/playlists/own/queue/items";

std::string userFill() {
    return std::string("/api/playlists/") + kPlaylistId + "/items";
}

std::string nameOf(OwnPlaylistRole role) {
    return role == OwnPlaylistRole::scratch ? "scratch" : "queue";
}

// What a role answers once its playlist has been destroyed and another made in its place.
// foobar2000 mints a GUID per playlist and reuses none, so the replacement is a different one.
constexpr char kRemadePlaylistId[] = "33333333-3333-3333-3333-333333333333";

struct FillLog {
    std::vector<std::string> roles;
    std::string title;

    int fills = 0;
    std::string filled;
    bool replace = false;

    int deletes = 0;

    std::vector<uint32_t> inserted;
    uint64_t structure = 1;
    std::map<std::string, size_t> held;
    std::map<std::string, std::string> titles;
    std::map<std::string, std::string> playlists{{"scratch", kScratchPlaylistId},
                                                 {"queue", kQueuePlaylistId}};
    std::string beefwebId = "p4";
    std::string listedTitle;

    const std::string& idFor(OwnPlaylistRole role) {
        auto& id = playlists[nameOf(role)];
        if (id.empty())
            id = kRemadePlaylistId;

        return id;
    }
};

// Stands in for fb2k/playlists.cpp: a role resolves to the playlist carrying its marker, and a
// set resolved against a generation the player has moved past is refused rather than inserted.
Player fillingPlayer(FillLog* log) {
    Player player;

    player.ownPlaylist = [log](OwnPlaylistRole role, const std::string& title) {
        log->roles.push_back(nameOf(role));
        log->title = title;

        PlaylistAnnotation playlist;
        playlist.id = log->idFor(role);
        playlist.beefwebId = log->beefwebId;

        // A playlist made for a role carries its title from the start, which is what keeps it out
        // of the sidebar for the poll that finds it. A role that already has one keeps whatever it
        // is called until a fill lands, so there is no window in which a title has moved and the
        // rows have not.
        auto& named = log->titles[playlist.id];
        if (named.empty())
            named = title;

        playlist.title = named;

        PlaylistResult result;
        result.playlist = playlist;
        return result;
    };

    player.emptyOwnPlaylist = [log](OwnPlaylistRole role) {
        PlaylistAnnotation playlist;
        playlist.id = log->idFor(role);
        playlist.beefwebId = log->beefwebId;

        log->held[playlist.id] = 0;

        PlaylistResult result;
        result.playlist = playlist;
        return result;
    };

    // The seam's one delete, and the only way anything in core/ can destroy a playlist. The fake
    // answers it rather than leaving it null, so a route that emptied a playlist by deleting it
    // is caught having done so instead of crashing on the way.
    player.removeAutoPlaylist = [log](const std::string& id) {
        log->deletes++;
        log->held.erase(id);

        for (auto& playlist : log->playlists)
            if (playlist.second == id)
                playlist.second.clear();

        PlaylistResult result;
        result.playlist.id = id;
        return result;
    };

    player.fill = [log](const std::string& playlistId, const std::string& title, uint64_t structure,
                        const std::vector<uint32_t>& ordinals, bool replace) {
        log->fills++;
        log->filled = playlistId;
        log->replace = replace;

        if (structure != log->structure)
            return FillResult{PlaylistOutcome::structureMoved, {}, ""};

        // An empty title is a user's playlist saying it is not Jean's to rename.
        if (!title.empty())
            log->titles[playlistId] = title;

        log->inserted.insert(log->inserted.end(), ordinals.begin(), ordinals.end());

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

constexpr size_t kHeldRows = 5;

FillLog holding(uint64_t structure) {
    FillLog log;
    log.structure = structure;

    for (const char* id : {kScratchPlaylistId, kQueuePlaylistId, kPlaylistId})
        log.held[id] = kHeldRows;

    return log;
}

constexpr size_t kLibraryTracks = 8;

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

struct Own {
    std::string name;
    std::string path;
    std::string title;
    std::string id;
};

std::vector<Own> ownRoles() {
    return {{"scratch", kScratchFill, kScratchTitle, kScratchPlaylistId},
            {"queue", kQueueFill, kQueueTitle, kQueuePlaylistId}};
}

// Whether an empty answers a document like a fill does or a bare 204 like DELETE /stream/hold is
// the contract's to settle. What a caller depends on either way is that the rows went.
bool accepted(const httplib::Result& response) {
    constexpr int kRedirected = 300;
    return response && response->status >= 200 && response->status < kRedirected;
}

Settings readOnlyPlaylists() {
    auto settings = servingSettings();
    settings.writePlaylists = false;
    return settings;
}

struct Write {
    std::string name;
    std::function<httplib::Result(const TestServer&)> send;
};

// kPlaylistId is reported as an autoplaylist this component made, so the update and the delete
// here are aimed at one of its own records rather than at a stranger's playlist. The setting
// still refuses them: what it exempts is the scratch and the queue's holding playlist, which
// hold no music of the user's, and an autoplaylist holds theirs.
std::vector<Write> playlistWrites(uint64_t structure) {
    return {
        {"creating an autoplaylist",
         [](const TestServer& server) { return post(server, "/api/autoplaylists", kCreate); }},
        {"updating an autoplaylist",
         [](const TestServer& server) {
             return post(server, std::string("/api/autoplaylists/") + kPlaylistId,
                         R"({"query": "%genre% IS Jazz"})");
         }},
        {"deleting an autoplaylist",
         [](const TestServer& server) {
             return server.client().Delete(std::string("/api/autoplaylists/") + kPlaylistId,
                                           TestServer::bearer());
         }},
        {"filling a playlist a user owns, which is what addTo does",
         [structure](const TestServer& server) {
             return post(server, userFill(), userBody(structure));
         }}};
}

Player writingPlayer(PlayerLog* log, FillLog* fills) {
    Player player = recordingPlayer(log);
    const Player filling = fillingPlayer(fills);

    player.ownPlaylist = filling.ownPlaylist;
    player.fill = filling.fill;
    return player;
}

Player fillingPlayerListing(FillLog* log) {
    auto player = fillingPlayer(log);

    player.listPlaylists = [log] {
        PlaylistAnnotation playlist;
        playlist.id = kPlaylistId;
        playlist.beefwebId = "p3";
        playlist.title = log->listedTitle;
        return PlaylistsResult{PlaylistOutcome::done, {playlist}};
    };

    return player;
}

// Reports the component's own playlists under the titles they currently carry, so a test can read
// one back the way any client does. Two things write a title: OwnPlaylistResolver, when it makes
// the playlist a role had none of, and PlaylistFiller, which renames the one it filled in the same
// main-thread work item that checks the generation.
Player namingPlayer(FillLog* log) {
    auto player = fillingPlayer(log);

    player.listPlaylists = [log] {
        std::vector<PlaylistAnnotation> playlists;
        std::transform(log->titles.begin(), log->titles.end(), std::back_inserter(playlists),
                       [](const std::pair<const std::string, std::string>& named) {
                           PlaylistAnnotation playlist;
                           playlist.id = named.first;
                           playlist.title = named.second;
                           return playlist;
                       });

        return PlaylistsResult{PlaylistOutcome::done, std::move(playlists)};
    };

    return player;
}

std::string titleOf(const TestServer& server, const std::string& id) {
    const auto response = server.client().Get("/api/playlists", TestServer::bearer());
    REQUIRE(response);

    const auto body = json::parse(response->body);
    const auto& playlists = body["playlists"];
    const auto found = std::find_if(playlists.begin(), playlists.end(),
                                    [&id](const json& playlist) { return playlist["id"] == id; });

    if (found == playlists.end())
        return {};

    return found->at("title").get<std::string>();
}

std::string withField(const std::string& body, const std::string& field, const json& value) {
    auto document = json::parse(body);
    document[field] = value;
    return document.dump();
}

std::string naming(const std::string& body, const json& set) {
    auto document = json::parse(body);
    document.erase("ordinals");
    document.update(set);
    return document.dump();
}

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

TEST_CASE("a fill resolved against a generation the library has moved past inserts nothing") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const auto& target : targets(exported)) {
        INFO("target: ", target.name);

        const auto response = post(server, target.path, target.body);

        REQUIRE(response);
        CHECK(response->status == 409);

        CHECK(json::parse(response->body)["error"] == describe(DeltaOutcome::structureChanged));
    }

    CHECK(log.inserted.empty());
}

// Jean titles the scratch after the view it is filling it with, and reads that title back off the
// playlist to say what is playing. So the title is a claim about the rows: a playlist retitled for
// a view it was then refused the rows for is a wrong answer to every reader of it, and a playlist
// left under the first view it ever held is a stale one. The title travels with the rows for that
// reason, and the two arrive in the same main-thread work item as the generation check.
TEST_CASE("the title a fill carries lands with its rows and never ahead of them") {
    Library library;
    buildLibrary(library);
    const uint64_t exported = library.state().structure;

    FillLog log;
    log.structure = exported;
    const TestServer server(servingSettings(), namingPlayer(&log), &library);

    const auto made = post(server, kScratchFill, ownBody("#Jean [all music]", exported));
    REQUIRE(made);
    REQUIRE(made->status == 200);
    REQUIRE(titleOf(server, kScratchPlaylistId) == "#Jean [all music]");

    SUBCASE("a second view retitles the playlist it filled") {
        const auto landed = post(server, kScratchFill, ownBody("#Jean Indie Rock", exported));

        REQUIRE(landed);
        REQUIRE(landed->status == 200);
        CHECK(titleOf(server, kScratchPlaylistId) == "#Jean Indie Rock");
    }

    SUBCASE("a view refused for a moved generation leaves the title where it was") {
        buildLibrary(library);
        log.structure = library.state().structure;

        const auto refused = post(server, kScratchFill, ownBody("#Jean Indie Rock", exported));

        REQUIRE(refused);
        REQUIRE(refused->status == 409);
        CHECK(titleOf(server, kScratchPlaylistId) == "#Jean [all music]");
    }
}

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

// FillOwnPlaylistRequest.title carries the same limit as an autoplaylist's: a line break in
// it would be a line break in a foobar2000 playlist tab, and 256 characters is the same cap
// parseAutoPlaylist holds a title to. Both routes take a title from the same check for
// exactly that reason.
TEST_CASE("a title on the component's own playlist is held to the limit an autoplaylist's is") {
    Library library;
    buildLibrary(library);

    FillLog log;
    log.structure = library.state().structure;
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    SUBCASE("a control character is refused rather than reaching the player") {
        const auto response = post(
            server, kScratchFill, withField(ownBody(kScratchTitle, log.structure), "title", "a\nb"));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "unacceptable title");
        CHECK(log.roles.empty());
        CHECK(log.fills == 0);
    }

    SUBCASE("longer than 256 characters is refused rather than truncated") {
        const auto response = post(server, kScratchFill,
                                   withField(ownBody(kScratchTitle, log.structure), "title",
                                             std::string(257, 'a')));

        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK(json::parse(response->body)["error"] == "unacceptable title");
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

TEST_CASE("with writePlaylists off, every write but the component's own is refused and never "
          "reaches the player") {
    Library library;
    buildLibrary(library);

    PlayerLog log;
    FillLog fills;
    fills.structure = library.state().structure;
    const TestServer server(readOnlyPlaylists(), writingPlayer(&log, &fills), &library);

    for (const auto& write : playlistWrites(fills.structure)) {
        INFO("write: ", write.name);

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == 403);

        CHECK(json::parse(response->body)["error"] == describe(PlaylistOutcome::writesDisabled));
    }

    CHECK(log.creates == 0);
    CHECK(log.updates == 0);
    CHECK(log.removals == 0);
    CHECK(fills.fills == 0);
    CHECK(fills.inserted.empty());
}

// One status, two causes, and a message that has to be true of the cause it was sent for. The
// setting is decided here before the player is asked; a playlist this component did not create
// is something only the player can report, and it is refused whatever the setting says. Naming
// the setting on both sends a player owner to config.json to turn on something already on.
TEST_CASE("a write refused by the setting and one refused for a playlist this component did not "
          "create say different things") {
    const auto update = [](const TestServer& server) {
        return post(server, std::string("/api/autoplaylists/") + kPlaylistId,
                    R"({"query": "%genre% IS Jazz"})");
    };

    PlayerLog gated;
    const TestServer refusing(readOnlyPlaylists(), recordingPlayer(&gated));

    const auto bySetting = update(refusing);
    REQUIRE(bySetting);
    REQUIRE(bySetting->status == 403);
    CHECK(gated.updates == 0);

    PlayerLog asked;
    asked.answer = PlaylistOutcome::notOurs;
    const TestServer writing(servingSettings(), recordingPlayer(&asked));

    const auto byOwnership = update(writing);
    REQUIRE(byOwnership);
    REQUIRE(byOwnership->status == 403);
    CHECK(asked.updates == 1);

    const std::string setting = json::parse(bySetting->body)["error"];
    const std::string ownership = json::parse(byOwnership->body)["error"];

    const auto names = [](const std::string& message, const std::string& what) {
        return message.find(what) != std::string::npos;
    };

    CHECK(names(setting, "writePlaylists"));
    CHECK(names(setting, "config.json"));

    CHECK_FALSE(names(ownership, "writePlaylists"));
    CHECK_FALSE(names(ownership, "config.json"));
    CHECK(ownership != setting);

    const auto published = publishedEnum("PlaylistFailed", "error");
    for (const auto& error : {setting, ownership}) {
        INFO("error: ", error);
        CHECK(std::find(published.begin(), published.end(), error) != published.end());
    }
}

// The setting protects the user's music, and neither of these holds any: they are how Jean
// plays a set and how it queues a track. A setting that stopped either is the setting doing the
// wrong thing, so both roles are driven in both states rather than only in the one that shipped.
TEST_CASE("the component's own two playlists fill whether writePlaylists is on or off") {
    Library library;
    buildLibrary(library);

    for (const bool writePlaylists : {true, false}) {
        for (const auto& role : ownRoles()) {
            INFO("writePlaylists: ", writePlaylists, ", role: ", role.name);

            FillLog fills;
            fills.structure = library.state().structure;
            const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                    fillingPlayer(&fills), &library);

            const auto response = post(server, role.path, ownBody(role.title, fills.structure));

            REQUIRE(response);
            CHECK(response->status == 200);
            CHECK(fills.filled == role.id);
            CHECK(fills.inserted == std::vector<uint32_t>{3, 1});
        }
    }
}

TEST_CASE("an install that never set writePlaylists permits every write the setting would "
          "refuse") {
    Library library;
    buildLibrary(library);

    PlayerLog log;
    FillLog fills;
    fills.structure = library.state().structure;
    const TestServer server(servingSettings(), writingPlayer(&log, &fills), &library);

    for (const auto& write : playlistWrites(fills.structure)) {
        INFO("write: ", write.name);

        const auto response = write.send(server);

        REQUIRE(response);
        CHECK(response->status == 200);
    }

    CHECK(log.creates == 1);
    CHECK(log.updates == 1);
    CHECK(log.removals == 1);
    CHECK(fills.fills == 1);
    CHECK(fills.inserted == std::vector<uint32_t>{3, 1});
}

TEST_CASE("what refuses a fill is the setting and never the playlist's title") {
    Library library;
    buildLibrary(library);

    for (const std::string& title : {std::string("#Jean Queue"), std::string("Road trip")}) {
        for (const bool writePlaylists : {true, false}) {
            INFO("title: ", title, ", writePlaylists: ", writePlaylists);

            FillLog fills;
            fills.structure = library.state().structure;
            fills.listedTitle = title;
            const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                    fillingPlayerListing(&fills), &library);

            const auto response = post(server, userFill(), userBody(fills.structure));

            REQUIRE(response);
            CHECK(response->status == (writePlaylists ? 200 : 403));
            CHECK(fills.fills == (writePlaylists ? 1 : 0));
        }
    }
}

// Deleting a playlist the play queue points into kills foobar2000, and the queue's holding
// playlist is the one the play queue always points into. So "it holds nothing afterwards" is
// half the promise: an empty that deleted the playlist and made another would satisfy that and
// take the player down with it.
TEST_CASE("emptying a role takes its playlist's rows and leaves the playlist itself standing") {
    Library library;
    buildLibrary(library);

    for (const auto& role : ownRoles()) {
        INFO("role: ", role.name);

        auto log = holding(library.state().structure);
        const TestServer server(servingSettings(), fillingPlayer(&log), &library);

        const auto response = server.client().Delete(role.path, TestServer::bearer());

        REQUIRE(response);
        INFO("status: ", response->status);
        CHECK(accepted(response));

        CHECK(log.held[role.id] == 0);
        CHECK(log.playlists[role.name] == role.id);
        CHECK(log.deletes == 0);

        // The other role's rows are not this request's to take. Jean empties the queue's holding
        // playlist the moment the play queue drains, and the scratch holds the view being played.
        for (const auto& other : ownRoles())
            if (other.name != role.name)
                CHECK(log.held[other.id] == kHeldRows);
    }
}

// Jean empties the queue's holding playlist whenever the play queue has drained, so a setting
// that refused this would leave that playlist growing for the life of the install. It holds no
// music of the user's: it is how Jean queues a track.
TEST_CASE("the component's own two playlists empty whether writePlaylists is on or off") {
    Library library;
    buildLibrary(library);

    for (const bool writePlaylists : {true, false}) {
        for (const auto& role : ownRoles()) {
            INFO("writePlaylists: ", writePlaylists, ", role: ", role.name);

            auto log = holding(library.state().structure);
            const TestServer server(writePlaylists ? servingSettings() : readOnlyPlaylists(),
                                    fillingPlayer(&log), &library);

            const auto response = server.client().Delete(role.path, TestServer::bearer());

            REQUIRE(response);
            INFO("status: ", response->status);
            CHECK(accepted(response));
            CHECK(log.held[role.id] == 0);
        }
    }
}

TEST_CASE("a role the contract does not name is refused on an empty exactly as it is on a fill") {
    Library library;
    buildLibrary(library);

    auto log = holding(library.state().structure);
    const TestServer server(servingSettings(), fillingPlayer(&log), &library);

    for (const std::string& role : {std::string("library"), std::string("Scratch"),
                                    std::string("queue2"), std::string(kPlaylistId)}) {
        INFO("role: ", role);
        const auto path = "/api/playlists/own/" + role + "/items";

        const auto emptied = server.client().Delete(path, TestServer::bearer());
        const auto filled = post(server, path, ownBody(kScratchTitle, log.structure));

        REQUIRE(emptied);
        REQUIRE(filled);

        CHECK(emptied->status == 400);
        CHECK(emptied->status == filled->status);
        CHECK(json::parse(emptied->body)["error"] == json::parse(filled->body)["error"]);
    }

    for (const auto& role : ownRoles())
        CHECK(log.held[role.id] == kHeldRows);

    CHECK(log.roles.empty());
    CHECK(log.fills == 0);
}

TEST_CASE("the contract publishes a 403 on exactly the writes the setting can refuse") {
    const auto published = publishedRoutes();

    const auto answers403 = [&published](const std::string& name) {
        const auto found =
            std::find_if(published.begin(), published.end(), [&name](const SpecRoute& route) {
                return route.method + " " + route.path == name;
            });

        REQUIRE_MESSAGE(found != published.end(), "contract/openapi.yaml publishes no ", name);
        return found->statuses.count(403) == 1;
    };

    for (const std::string& name :
         {std::string("POST /autoplaylists"), std::string("POST /autoplaylists/{id}"),
          std::string("DELETE /autoplaylists/{id}"), std::string("POST /playlists/{id}/items")}) {
        INFO("route: ", name);
        CHECK(answers403(name));
    }

    CHECK_FALSE(answers403("POST /playlists/own/{role}/items"));
    CHECK_FALSE(answers403("DELETE /playlists/own/{role}/items"));
}
