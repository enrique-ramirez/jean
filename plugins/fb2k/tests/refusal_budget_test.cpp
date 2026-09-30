// Every route that spends a budget refuses in one order: what the request says, then whether the
// player can serve it at all, then the budget. A request the player cannot serve is answered 503
// before it spends a token, so an install that switched a feature off never teaches a client to
// back off from the features it kept. Each case sends one request more than the budget holds to a
// route with nothing behind it: had the budget been spent first, the last answer would be 429.

#include "third_party/doctest.h"

#include "support/fixtures.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <functional>
#include <set>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

// The budget playlist, queue and autoplaylist edits share, and the two of their own the tag
// writes and the query previews each have, in core/http_server.cpp, core/routes_library.cpp and
// core/routes_autoplaylists.cpp.
constexpr int kPlaylistBurst = 30;
constexpr int kTagWriteBurst = 200;
constexpr int kPreviewBurst = 30;

constexpr char kSourcePlaylistId[] = "9b1c2e30-7d4a-4f6e-8a21-3c5d6e7f8091";

struct Edit {
    const char* name;
    std::function<httplib::Result(const TestServer&)> send;
};

std::set<int> statusesOf(const TestServer& server, const Edit& edit, int times) {
    std::set<int> statuses;
    for (int sent = 0; sent < times; ++sent) {
        const auto response = edit.send(server);
        REQUIRE(response);
        statuses.insert(response->status);
    }
    return statuses;
}

httplib::Result remove(const TestServer& server, const std::string& path) {
    return server.client().Delete(path);
}

std::vector<Edit> sharedBudgetEdits(uint64_t structure) {
    const std::string playlist = std::string("/api/playlists/") + kPlaylistId;
    const std::string autoPlaylist = std::string("/api/autoplaylists/") + kPlaylistId;
    const auto fill = json{{"structure", structure}, {"ordinals", json::array({3, 1})}};
    const auto ownFill =
        json{{"title", "Everything"}, {"structure", structure}, {"ordinals", json::array({3})}};

    return {
        {"creating a playlist",
         [](const TestServer& server) {
             return post(server, "/api/playlists", R"({"title": "Road trip"})");
         }},
        {"renaming a playlist",
         [playlist](const TestServer& server) {
             return post(server, playlist, R"({"title": "Road trip"})");
         }},
        {"deleting a playlist",
         [playlist](const TestServer& server) { return remove(server, playlist); }},
        {"moving a playlist",
         [playlist](const TestServer& server) {
             return post(server, playlist + "/move", R"({"index": 0})");
         }},
        {"filling a playlist",
         [playlist, fill](const TestServer& server) {
             return post(server, playlist + "/items", fill.dump());
         }},
        {"copying rows into a playlist",
         [playlist](const TestServer& server) {
             return post(
                 server, playlist + "/items/copy",
                 json{{"source", kSourcePlaylistId}, {"runs", json::array({json::array({0, 1})})}}
                     .dump());
         }},
        {"removing rows from a playlist",
         [playlist](const TestServer& server) {
             return post(
                 server, playlist + "/items/remove",
                 json{{"structure", "1"}, {"runs", json::array({json::array({0, 1})})}}.dump());
         }},
        {"moving rows within a playlist",
         [playlist](const TestServer& server) {
             return post(
                 server, playlist + "/items/move",
                 json{{"structure", "1"}, {"runs", json::array({json::array({0, 1})})}, {"to", 1}}
                     .dump());
         }},
        {"sorting a playlist",
         [playlist](const TestServer& server) {
             return post(server, playlist + "/items/sort",
                         json{{"structure", "1"}, {"pattern", "%title%"}}.dump());
         }},
        {"filling the scratch",
         [ownFill](const TestServer& server) {
             return post(server, "/api/playlists/own/scratch/items", ownFill.dump());
         }},
        {"emptying the scratch",
         [](const TestServer& server) {
             return remove(server, "/api/playlists/own/scratch/items");
         }},
        {"queueing playlist rows",
         [](const TestServer& server) {
             return post(server, "/api/queue",
                         json{{"playlistId", kPlaylistId}, {"positions", json::array({0})}}.dump());
         }},
        {"queueing library tracks",
         [structure](const TestServer& server) {
             return post(server, "/api/queue",
                         json{{"structure", structure}, {"ordinals", json::array({1})}}.dump());
         }},
        {"moving a queue entry",
         [](const TestServer& server) {
             return post(server, "/api/queue/move", R"({"from": 1, "to": 0, "revision": 0})");
         }},
        {"removing a queue entry",
         [](const TestServer& server) { return remove(server, "/api/queue/0?revision=0"); }},
        {"creating an autoplaylist",
         [](const TestServer& server) {
             return post(server, "/api/autoplaylists",
                         R"({"title": "#Jean Rock", "query": "%genre% IS Rock"})");
         }},
        {"changing an autoplaylist",
         [autoPlaylist](const TestServer& server) {
             return post(server, autoPlaylist, R"({"query": "%genre% IS Jazz"})");
         }},
        {"deleting an autoplaylist",
         [autoPlaylist](const TestServer& server) { return remove(server, autoPlaylist); }},
    };
}

}  // namespace

TEST_CASE("a playlist or queue edit the player cannot make spends none of the budget they share") {
    Library library;
    buildLibrary(library);

    Player player = servingPlayer();
    player.queue.clear = [] { return PlayerOutcome::done; };
    const TestServer server(servingSettings(), player, &library);

    for (const auto& edit : sharedBudgetEdits(library.state().structure)) {
        INFO("edit: ", edit.name);
        CHECK(statusesOf(server, edit, kPlaylistBurst + 1) == std::set<int>{503});
    }

    const auto cleared = remove(server, "/api/queue");
    REQUIRE(cleared);
    CHECK(cleared->status == 204);
}

TEST_CASE("a tag write the player cannot make spends none of the tag write budget") {
    const TestServer server;

    const Edit write{"writing a rating", [](const TestServer& serving) {
                         return post(serving, "/api/tags", ratingWrite(kTrackAddress));
                     }};

    CHECK(statusesOf(server, write, kTagWriteBurst + 1) == std::set<int>{503});
}

TEST_CASE("a query preview the player cannot run spends none of the preview budget") {
    const TestServer server;

    const Edit preview{"previewing a query", [](const TestServer& serving) {
                           return post(serving, "/api/autoplaylists/preview",
                                       R"({"query": "%genre% IS Rock"})");
                       }};

    CHECK(statusesOf(server, preview, kPreviewBurst + 1) == std::set<int>{503});
}
