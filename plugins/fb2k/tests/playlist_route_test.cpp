// The autoplaylist routes over a real socket. playlists_test.cpp covers the decisions behind
// them; what these add is that a refused request never reaches the player at all.

#include "third_party/doctest.h"

#include "support/log_capture.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <iterator>
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
