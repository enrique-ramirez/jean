// Every route that spends a budget refuses in one order: what the request says, then whether the
// player can serve it at all, then the budget. A request the player cannot serve is answered 503
// before it spends a token, so an install that switched a feature off never teaches a client to
// back off from the features it kept. Each case sends one request more than the budget holds to a
// route with nothing behind it: had the budget been spent first, the last answer would be 429.

#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "support/fake_player.h"
#include "support/fixtures.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <atomic>
#include <chrono>
#include <cstddef>
#include <functional>
#include <set>
#include <string>
#include <utility>
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

constexpr int kSummaryBurst = 200;

constexpr char kSummary[] = "/api/library/summary?title=%25title%25";
constexpr char kSummaryOfNoRole[] = "/api/library/summary?colour=%25title%25";

constexpr int kQuestionBurst = 200;

constexpr char kAlbumQuestion[] = "/api/library/album?name=Jessico&by=Someone&title=%25title%25";
constexpr char kSearch[] =
    "/api/library/search?query=a&limit=8&entityLimit=3&splitsCredits=true&title=%25title%25";
constexpr char kCredits[] =
    "/api/library/credits?splitsCredits=true&structure=0&ordinal=0&title=%25title%25";
constexpr char kValues[] = "/api/library/values?field=artist&prefix=mo&limit=8&title=%25title%25";

constexpr auto kQuestionRefill = std::chrono::milliseconds(50);

const std::vector<std::string>& pageQuestions() {
    static const std::vector<std::string> questions{
        kAlbumQuestion,
        "/api/library/artist?name=Alpha&splitsCredits=true&title=%25title%25",
        "/api/library/genre?name=Rock&title=%25title%25",
        kSearch,
        kCredits,
        kValues,
    };
    return questions;
}

struct RefusedQuestion {
    std::string path;
    json body;
};

const std::vector<RefusedQuestion>& refusedQuestions() {
    static const std::vector<RefusedQuestion> refused{
        {"/api/library/genre?name=Rock&colour=%25title%25",
         {{"error", "unacceptable role"}, {"detail", "'colour' is not a role"}}},
        {"/api/library/album?title=%25title%25",
         {{"error", "unacceptable question"}, {"detail", "'name' is required"}}},
        {"/api/library/artist?name=Alpha&title=%25title%25",
         {{"error", "unacceptable question"}, {"detail", "'splitsCredits' is required"}}},
        {"/api/library/artist?name=Alpha&splitsCredits=yes",
         {{"error", "unacceptable question"}, {"detail", "'splitsCredits' must be true or false"}}},
        {"/api/library/genre?name=Rock&name=Jazz",
         {{"error", "duplicate question"}, {"detail", "'name' is named twice"}}},
        {"/api/library/search?limit=8&entityLimit=3&splitsCredits=true",
         {{"error", "unacceptable question"}, {"detail", "'query' is required"}}},
        {"/api/library/search?query=" + std::string(1025, 'a') +
             "&limit=8&entityLimit=3&splitsCredits=true",
         {{"error", "unacceptable question"}, {"detail", "'query' must be at most 1024 bytes"}}},
        {"/api/library/search?query=a&limit=-1&entityLimit=3&splitsCredits=true",
         {{"error", "unacceptable question"},
          {"detail", "'limit' must be a whole number of 0 or more"}}},
        {"/api/library/credits?splitsCredits=true&ordinal=0&title=%25title%25",
         {{"error", "unacceptable question"}, {"detail", "'structure' is required"}}},
        {"/api/library/credits?splitsCredits=true&structure=1&ordinal=-1",
         {{"error", "unacceptable question"},
          {"detail", "'ordinal' must be a whole number of 0 or more"}}},
        {"/api/library/values?prefix=mo&limit=8&title=%25title%25",
         {{"error", "unacceptable question"}, {"detail", "'field' is required"}}},
        {"/api/library/values?field=artist&prefix=" + std::string(1025, 'm') + "&limit=8",
         {{"error", "unacceptable question"}, {"detail", "'prefix' must be at most 1024 bytes"}}},
        {"/api/library/values?field=artist&prefix=mo&limit=x",
         {{"error", "unacceptable question"},
          {"detail", "'limit' must be a whole number of 0 or more"}}},
    };
    return refused;
}

template <typename Expected>
size_t unexpectedAnswers(const TestServer& server, const std::vector<std::string>& paths, int times,
                         Expected expected) {
    size_t unexpected = 0;
    for (int sent = 0; sent < times; ++sent) {
        const auto& path = paths[static_cast<size_t>(sent) % paths.size()];
        const auto response = get(server, path);
        REQUIRE(response);
        if (!expected(static_cast<size_t>(sent) % paths.size(), *response)) {
            if (unexpected == 0)
                MESSAGE("first unexpected answer: ", path, " ", response->status, " ",
                        response->body);
            ++unexpected;
        }
    }
    return unexpected;
}

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

TEST_CASE("a summary refused for its roles spends none of the summary budget") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const Edit noRole{"a summary of a role that is none",
                      [](const TestServer& serving) { return get(serving, kSummaryOfNoRole); }};
    CHECK(statusesOf(server, noRole, kSummaryBurst + 1) == std::set<int>{400});

    const auto asked = get(server, kSummary);
    REQUIRE(asked);
    CHECK(asked->status == 202);
}

TEST_CASE("a summary the component cannot serve spends none of the summary budget") {
    const TestServer server;

    const Edit summary{"a summary with no media library",
                       [](const TestServer& serving) { return get(serving, kSummary); }};
    CHECK(statusesOf(server, summary, kSummaryBurst + 1) == std::set<int>{503});

    const auto noRole = get(server, kSummaryOfNoRole);
    REQUIRE(noRole);
    CHECK(noRole->status == 400);
}

TEST_CASE("summaries past their own budget are refused with a 429 that says how long to wait") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const Edit summary{"a summary before the snapshot is built",
                       [](const TestServer& serving) { return get(serving, kSummary); }};
    CHECK(statusesOf(server, summary, kSummaryBurst) == std::set<int>{202});

    const auto refused = get(server, kSummary);
    REQUIRE(refused);
    CHECK(refused->status == 429);
    CHECK(errorOf(*refused) == "too many library summary reads");
    const auto wait = refused->get_header_value("Retry-After");
    CHECK_FALSE(wait.empty());
    CHECK(wait.find_first_not_of("0123456789") == std::string::npos);
}

TEST_CASE("a question refused for what it asks spends none of the question budget") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    std::vector<std::string> paths;
    for (const auto& refused : refusedQuestions())
        paths.push_back(refused.path);
    CHECK(unexpectedAnswers(
              server, paths, kQuestionBurst + 1, [](size_t at, const httplib::Response& response) {
                  return response.status == 400 &&
                         json::parse(response.body, nullptr, false) == refusedQuestions()[at].body;
              }) == 0);

    for (const auto& path : pageQuestions()) {
        INFO("question: ", path);
        const auto asked = get(server, path);
        REQUIRE(asked);
        CHECK(asked->status == 202);
    }
}

TEST_CASE("a question the component cannot serve spends none of the question budget") {
    const TestServer server;

    CHECK(unexpectedAnswers(server, pageQuestions(), kQuestionBurst + 1,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 503 && errorOf(response) == kNoLibrary;
                            }) == 0);

    for (const auto& refused : refusedQuestions()) {
        INFO("refused: ", refused.path);
        const auto asked = get(server, refused.path);
        REQUIRE(asked);
        CHECK(asked->status == 400);
        CHECK(json::parse(asked->body, nullptr, false) == refused.body);
    }
}

TEST_CASE("questions past the budget they share are refused with a 429 saying how long to wait") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    CHECK(unexpectedAnswers(server, pageQuestions(), kQuestionBurst,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 202;
                            }) == 0);

    for (const auto& path : pageQuestions()) {
        INFO("question: ", path);
        const auto refused = get(server, path);
        REQUIRE(refused);
        CHECK(refused->status == 429);
        CHECK(json::parse(refused->body, nullptr, false) ==
              json{{"error", "too many library questions"}});
        const auto wait = refused->get_header_value("Retry-After");
        CHECK_FALSE(wait.empty());
        CHECK(wait.find_first_not_of("0123456789") == std::string::npos);
    }

    const auto summary = get(server, kSummary);
    REQUIRE(summary);
    CHECK(summary->status == 202);
}

TEST_CASE("a question naming a column nobody declared spends the budget before its 409") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);

    const auto answered = get(server, pageQuestions().front());
    REQUIRE(answered);
    REQUIRE(answered->status == 200);

    const std::vector<std::string> undeclared{
        "/api/library/album?name=Jessico&title=%25comment%25",
        "/api/library/artist?name=Alpha&splitsCredits=false&title=%25comment%25",
        "/api/library/genre?name=Rock&title=%25comment%25",
        "/api/library/search?query=a&limit=8&entityLimit=3&splitsCredits=true&title=%25comment%25",
        "/api/library/credits?splitsCredits=true&structure=0&ordinal=0&title=%25comment%25",
        "/api/library/values?field=artist&prefix=mo&limit=8&title=%25comment%25",
    };
    CHECK(unexpectedAnswers(server, undeclared, kQuestionBurst - 1,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 409;
                            }) == 0);

    const auto refused = get(server, pageQuestions().back());
    REQUIRE(refused);
    CHECK(refused->status == 429);
}

TEST_CASE("a search past the budget spent on album questions is refused, and the other way round") {
    const std::vector<std::pair<std::string, std::string>> spentThenAsked{
        {kAlbumQuestion, kSearch}, {kSearch, kAlbumQuestion}, {kAlbumQuestion, kCredits},
        {kCredits, kValues},       {kValues, kAlbumQuestion},
    };

    for (const auto& [spent, asked] : spentThenAsked) {
        INFO("spent on: ", spent);
        Library library;
        const TestServer server(servingSettings(), Player{}, &library);

        CHECK(unexpectedAnswers(server, {spent}, kQuestionBurst,
                                [](size_t /*at*/, const httplib::Response& response) {
                                    return response.status == 202;
                                }) == 0);

        const auto refused = get(server, asked);
        REQUIRE(refused);
        CHECK(refused->status == 429);
        CHECK(json::parse(refused->body, nullptr, false) ==
              json{{"error", "too many library questions"}});
    }
}

namespace {

constexpr int kRowsBurst = 30;
constexpr auto kRowsRefill = std::chrono::milliseconds(100);

constexpr char kRows[] = "/api/library/rows";

json rowsAsked(const std::vector<std::string>& columns, uint64_t structure) {
    return json{{"columns", columns},
                {"structure", std::to_string(structure)},
                {"ordinals", json::array({1, 0})}};
}

httplib::Result askRows(const TestServer& server, const json& body) {
    return post(server, kRows, body.dump());
}

const std::vector<std::pair<const char*, json>>& refusedRowRequests() {
    static const std::vector<std::pair<const char*, json>> refused{
        {"both set forms",
         {{"columns", {"%title%"}}, {"structure", "1"}, {"ordinals", {0}}, {"runs", {{0, 1}}}}},
        {"no set form", {{"columns", {"%title%"}}, {"structure", "1"}}},
        {"too many rows",
         {{"columns", {"%title%"}}, {"structure", "1"}, {"ordinals", std::vector<int>(4097, 0)}}},
        {"a malformed structure",
         {{"columns", {"%title%"}}, {"structure", "x"}, {"ordinals", {0}}}},
    };
    return refused;
}

Edit rowsEdit(const char* name, json body) {
    return {name,
            [body = std::move(body)](const TestServer& serving) { return askRows(serving, body); }};
}

struct RefreshLog {
    std::atomic<int> calls{0};
};

Player buildingOnRefresh(RefreshLog* log, Library* library) {
    Player player;
    player.library.refresh = [log, library](const std::vector<std::string>& /*columns*/,
                                            RebuildReason /*why*/) {
        ++log->calls;
        library->reportBuild(BuildProgress{});
    };
    return player;
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

void checkTooManyRowReads(const httplib::Result& refused) {
    REQUIRE(refused);
    CHECK(refused->status == 429);
    CHECK(json::parse(refused->body, nullptr, false) ==
          json{{"error", "too many library row reads"}});
    const auto wait = refused->get_header_value("Retry-After");
    CHECK_FALSE(wait.empty());
    CHECK(wait.find_first_not_of("0123456789") == std::string::npos);
}

}  // namespace

TEST_CASE("a rows request refused for what it says spends none of the rows budget") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);

    for (const auto& [name, body] : refusedRowRequests()) {
        INFO("refused: ", name);
        CHECK(statusesOf(server, rowsEdit(name, body), kRowsBurst + 1) == std::set<int>{400});
    }

    const auto asked = askRows(server, rowsAsked({"%title%"}, library.state().structure));
    REQUIRE(asked);
    CHECK(asked->status == 200);
}

TEST_CASE("a rows request the component cannot serve spends none of the rows budget") {
    const TestServer server;

    const Edit rows = rowsEdit("rows with no media library", rowsAsked({"%title%"}, 1));
    for (int sent = 0; sent <= kRowsBurst; ++sent) {
        const auto response = rows.send(server);
        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(errorOf(*response) == kNoLibrary);
    }

    for (const auto& [name, body] : refusedRowRequests()) {
        INFO("refused: ", name);
        const auto response = askRows(server, body);
        REQUIRE(response);
        CHECK(response->status == 400);
    }
}

TEST_CASE("rows past their own budget are refused with a 429 that says how long to wait") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);
    const auto asked = rowsAsked({"%title%"}, library.state().structure);

    CHECK(statusesOf(server, rowsEdit("rows of the held snapshot", asked), kRowsBurst) ==
          std::set<int>{200});
    checkTooManyRowReads(askRows(server, asked));

    const auto malformed = askRows(server, refusedRowRequests().front().second);
    REQUIRE(malformed);
    CHECK(malformed->status == 400);

    const auto summary = get(server, kSummary);
    REQUIRE(summary);
    CHECK(summary->status != 429);
}

TEST_CASE("a rows request refused for its budget never reaches the player for a build") {
    RefreshLog log;
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), buildingOnRefresh(&log, &library), &library);
    const auto structure = library.state().structure;

    const auto first = askRows(server, rowsAsked({"%genre%"}, structure));
    REQUIRE(first);
    REQUIRE(first->status == 202);
    REQUIRE(log.calls == 1);

    CHECK(statusesOf(server,
                     rowsEdit("a build already asked for", rowsAsked({"%genre%"}, structure)),
                     kRowsBurst - 1) == std::set<int>{202});

    checkTooManyRowReads(askRows(server, rowsAsked({"%artist%"}, structure)));
    CHECK(log.calls == 1);
}

TEST_CASE("rows at a stale structure spend the rows budget before their 409") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);
    const auto stale = rowsAsked({"%title%"}, library.state().structure + 1);

    CHECK(statusesOf(server, rowsEdit("a stale structure", stale), kRowsBurst) ==
          std::set<int>{409});
    checkTooManyRowReads(askRows(server, stale));
}

// A phone left looping in a pocket must not stop the laptop in the next room from reading the
// library. One socket serves both stacks here, so the two clients arrive on two addresses over a
// real connection.
TEST_CASE("a client on another address reads rows on while one is being refused") {
    Library library;
    buildLibrary(library);
    const TestServer server = servingBothStacks(&library);
    REQUIRE(server.status().listening);
    const std::string body = rowsAsked({"%title%"}, library.state().structure).dump();

    auto elsewhere = overIpv6(server);
    auto looping = server.client();
    for (int sent = 0; sent < kRowsBurst; ++sent) {
        const auto response = looping.Post(kRows, body, "application/json");
        REQUIRE(response);
        REQUIRE(response->status == 200);
    }
    checkTooManyRowReads(looping.Post(kRows, body, "application/json"));

    INFO("the second address is ::1, reached through a dual-stack bind");
    const auto unaffected = elsewhere.Post(kRows, body, "application/json");
    REQUIRE(unaffected);
    CHECK(unaffected->status == 200);
}

TEST_CASE("the rows budget earns one request back every 100 ms") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);
    const auto asked = rowsAsked({"%title%"}, library.state().structure);

    CHECK(statusesOf(server, rowsEdit("rows of the held snapshot", asked), kRowsBurst) ==
          std::set<int>{200});
    checkTooManyRowReads(askRows(server, asked));

    server.advanceClock(kRowsRefill - std::chrono::milliseconds(1));
    checkTooManyRowReads(askRows(server, asked));

    server.advanceClock(std::chrono::milliseconds(1));
    const auto earned = askRows(server, asked);
    REQUIRE(earned);
    CHECK(earned->status == 200);
    checkTooManyRowReads(askRows(server, asked));
}

constexpr int kRunsBurst = 200;

constexpr char kRuns[] = "/api/library/runs?title=%25title%25";
constexpr char kRunsOfNoRole[] = "/api/library/runs?colour=%25title%25";

TEST_CASE("library runs refused for their roles spend none of the runs budget") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const Edit noRole{"runs of a role that is none",
                      [](const TestServer& serving) { return get(serving, kRunsOfNoRole); }};
    CHECK(statusesOf(server, noRole, kRunsBurst + 1) == std::set<int>{400});

    const auto asked = get(server, kRuns);
    REQUIRE(asked);
    CHECK(asked->status == 202);
}

TEST_CASE("library runs the component cannot serve spend none of the runs budget") {
    const TestServer server;

    const Edit runs{"runs with no media library",
                    [](const TestServer& serving) { return get(serving, kRuns); }};
    CHECK(statusesOf(server, runs, kRunsBurst + 1) == std::set<int>{503});

    const auto noRole = get(server, kRunsOfNoRole);
    REQUIRE(noRole);
    CHECK(noRole->status == 400);
}

TEST_CASE("library runs past their own budget are refused with a 429 that says how long to wait") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const Edit runs{"runs before the snapshot is built",
                    [](const TestServer& serving) { return get(serving, kRuns); }};
    CHECK(statusesOf(server, runs, kRunsBurst) == std::set<int>{202});

    const auto refused = get(server, kRuns);
    REQUIRE(refused);
    CHECK(refused->status == 429);
    CHECK(json::parse(refused->body, nullptr, false) ==
          json{{"error", "too many library run reads"}});
    const auto wait = refused->get_header_value("Retry-After");
    CHECK_FALSE(wait.empty());
    CHECK(wait.find_first_not_of("0123456789") == std::string::npos);

    const auto summary = get(server, kSummary);
    REQUIRE(summary);
    CHECK(summary->status == 202);

    const auto question = get(server, kAlbumQuestion);
    REQUIRE(question);
    CHECK(question->status == 202);
}

TEST_CASE("summaries past their own budget leave the runs budget whole") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const Edit summary{"a summary before the snapshot is built",
                       [](const TestServer& serving) { return get(serving, kSummary); }};
    CHECK(statusesOf(server, summary, kSummaryBurst + 1) == std::set<int>{202, 429});

    const auto runs = get(server, kRuns);
    REQUIRE(runs);
    CHECK(runs->status == 202);
}

TEST_CASE("library runs naming a column nobody declared spend the budget before their 409") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);

    const auto answered = get(server, kRuns);
    REQUIRE(answered);
    REQUIRE(answered->status == 200);

    const Edit undeclared{"runs of a column nobody declared", [](const TestServer& serving) {
                              return get(serving, "/api/library/runs?title=%25comment%25");
                          }};
    CHECK(statusesOf(server, undeclared, kRunsBurst - 1) == std::set<int>{409});

    const auto refused = get(server, kRuns);
    REQUIRE(refused);
    CHECK(refused->status == 429);
}

namespace {

std::string creditsAt(const uint64_t structure, const uint64_t ordinal) {
    return "/api/library/credits?splitsCredits=true&structure=" + std::to_string(structure) +
           "&ordinal=" + std::to_string(ordinal) + "&title=%25title%25";
}

void checkTooManyQuestions(const httplib::Result& refused) {
    REQUIRE(refused);
    CHECK(refused->status == 429);
    CHECK(json::parse(refused->body, nullptr, false) ==
          json{{"error", "too many library questions"}});
}

}  // namespace

TEST_CASE("credits at a stale structure spend the question budget before their 409") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);
    const auto stale = creditsAt(library.state().structure + 1, 0);

    CHECK(unexpectedAnswers(server, {stale}, kQuestionBurst,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 409;
                            }) == 0);
    checkTooManyQuestions(get(server, stale));
}

TEST_CASE("credits past the last track spend the question budget before their 400") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);
    const auto pastTheEnd = creditsAt(library.state().structure, library.state().trackCount);

    CHECK(unexpectedAnswers(server, {pastTheEnd}, kQuestionBurst,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 400;
                            }) == 0);
    checkTooManyQuestions(get(server, pastTheEnd));
}

TEST_CASE("the question budget earns credit and values questions back one every 50 ms") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);
    const auto credits = creditsAt(library.state().structure, 0);

    CHECK(unexpectedAnswers(server, {kAlbumQuestion}, kQuestionBurst,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 200;
                            }) == 0);
    checkTooManyQuestions(get(server, credits));
    checkTooManyQuestions(get(server, kValues));

    server.advanceClock(kQuestionRefill - std::chrono::milliseconds(1));
    checkTooManyQuestions(get(server, credits));

    server.advanceClock(std::chrono::milliseconds(1));
    const auto earned = get(server, credits);
    REQUIRE(earned);
    CHECK(earned->status == 200);
    checkTooManyQuestions(get(server, kValues));

    server.advanceClock(kQuestionRefill);
    const auto earnedAgain = get(server, kValues);
    REQUIRE(earnedAgain);
    CHECK(earnedAgain->status == 200);
}

namespace {

constexpr int kPlaylistRunsBurst = 200;
constexpr auto kPlaylistRunsRefill = std::chrono::milliseconds(50);
constexpr int kPlaylistRowsBurst = 30;

std::string playlistRunsPath(uint64_t structure, const char* roles = "title=%25title%25") {
    return "/api/playlists/" + std::string(kPlaylistId) +
           "/runs?structure=" + std::to_string(structure) + "&" + roles;
}

constexpr uint64_t kPlaylistStructure = 9204739866101318923ULL;

std::string playlistRunsPath() {
    return playlistRunsPath(kPlaylistStructure);
}

std::string playlistRunsOfNoRole() {
    return playlistRunsPath(kPlaylistStructure, "colour=%25title%25");
}

std::string playlistPagePath() {
    return "/api/playlists/" + std::string(kPlaylistId) +
           "/items?offset=0&count=2&columns=%25title%25";
}

PlaylistAnnotation roadTrip() {
    PlaylistAnnotation playlist;
    playlist.id = kPlaylistId;
    playlist.title = "Road trip";
    playlist.structure = kPlaylistStructure;
    playlist.revision = kPlaylistStructure;
    return playlist;
}

void holdingLibraryRows(FakePlayer& foobar) {
    foobar.add(roadTrip(), {libraryTrack(0), libraryTrack(1), titled("Dragged in")});
}

Edit getting(const char* name, std::string path) {
    return {name,
            [path = std::move(path)](const TestServer& serving) { return get(serving, path); }};
}

void checkTooManyPlaylistRunReads(const httplib::Result& refused) {
    REQUIRE(refused);
    CHECK(refused->status == 429);
    CHECK(json::parse(refused->body, nullptr, false) ==
          json{{"error", "too many playlist run reads"}});
    const auto wait = refused->get_header_value("Retry-After");
    CHECK_FALSE(wait.empty());
    CHECK(wait.find_first_not_of("0123456789") == std::string::npos);
}

TestServer servingBothStacks(const Player& player) {
    Settings settings = servingSettings();
    settings.bindAddress = "::";
    return TestServer(std::move(settings), player);
}

}  // namespace

TEST_CASE("playlist runs refused for their roles spend none of the playlist runs budget") {
    Library library;
    buildLibrary(library);
    FakePlayer foobar(&library);
    holdingLibraryRows(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    CHECK(statusesOf(server, getting("runs of a role that is none", playlistRunsOfNoRole()),
                     kPlaylistRunsBurst + 1) == std::set<int>{400});
    CHECK(foobar.total() == 0);

    const auto asked = get(server, playlistRunsPath());
    REQUIRE(asked);
    CHECK(asked->status == 200);
}

TEST_CASE("playlist runs the component cannot serve spend none of the playlist runs budget") {
    FakePlayer foobar;
    holdingLibraryRows(foobar);
    const TestServer server(servingSettings(), foobar.player());

    CHECK(statusesOf(server, getting("playlist runs with no media library", playlistRunsPath()),
                     kPlaylistRunsBurst + 1) == std::set<int>{503});

    const auto noRole = get(server, playlistRunsOfNoRole());
    REQUIRE(noRole);
    CHECK(noRole->status == 400);
    CHECK(foobar.total() == 0);
}

TEST_CASE("playlist runs past their own budget are refused with a 429 that says how long to wait") {
    Library library;
    FakePlayer foobar(&library);
    holdingLibraryRows(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    CHECK(statusesOf(server,
                     getting("playlist runs before the snapshot is built", playlistRunsPath()),
                     kPlaylistRunsBurst) == std::set<int>{202});
    checkTooManyPlaylistRunReads(get(server, playlistRunsPath()));

    const auto libraryRuns = get(server, kRuns);
    REQUIRE(libraryRuns);
    CHECK(libraryRuns->status == 202);

    const auto summary = get(server, kSummary);
    REQUIRE(summary);
    CHECK(summary->status == 202);
}

TEST_CASE("library runs past their own budget leave the playlist runs budget whole") {
    Library library;
    FakePlayer foobar(&library);
    holdingLibraryRows(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    CHECK(statusesOf(server, getting("library runs before the snapshot is built", kRuns),
                     kRunsBurst + 1) == std::set<int>{202, 429});

    const auto playlistRuns = get(server, playlistRunsPath());
    REQUIRE(playlistRuns);
    CHECK(playlistRuns->status == 202);
}

TEST_CASE("playlist runs at a stale structure spend the budget before their 409") {
    Library library;
    buildLibrary(library);
    FakePlayer foobar(&library);
    holdingLibraryRows(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);
    const std::string stale = playlistRunsPath(kPlaylistStructure + 1);

    CHECK(statusesOf(server, getting("a stale structure", stale), kPlaylistRunsBurst) ==
          std::set<int>{409});
    checkTooManyPlaylistRunReads(get(server, stale));
    CHECK(foobar.count(Call::readTracks) == kPlaylistRunsBurst);
}

TEST_CASE("playlist runs naming a column nobody declared spend the budget before their 409") {
    Library library;
    buildLibrary(library);
    FakePlayer foobar(&library);
    holdingLibraryRows(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    CHECK(statusesOf(server,
                     getting("runs of a column nobody declared",
                             playlistRunsPath(kPlaylistStructure, "title=%25comment%25")),
                     kPlaylistRunsBurst) == std::set<int>{409});
    checkTooManyPlaylistRunReads(get(server, playlistRunsPath()));
    CHECK(foobar.total() == 0);
}

TEST_CASE("the playlist runs budget earns one read back every 50 ms") {
    Library library;
    buildLibrary(library);
    FakePlayer foobar(&library);
    holdingLibraryRows(foobar);
    const TestServer server(servingSettings(), foobar.player(), &library);

    CHECK(statusesOf(server, getting("playlist runs", playlistRunsPath()), kPlaylistRunsBurst) ==
          std::set<int>{200});
    checkTooManyPlaylistRunReads(get(server, playlistRunsPath()));

    server.advanceClock(kPlaylistRunsRefill - std::chrono::milliseconds(1));
    checkTooManyPlaylistRunReads(get(server, playlistRunsPath()));

    server.advanceClock(std::chrono::milliseconds(1));
    const auto earned = get(server, playlistRunsPath());
    REQUIRE(earned);
    CHECK(earned->status == 200);
    checkTooManyPlaylistRunReads(get(server, playlistRunsPath()));
}

TEST_CASE("a playlist's runs and its pages draw on two budgets") {
    Library library;
    buildLibrary(library);
    FakePlayer foobar(&library);
    holdingLibraryRows(foobar);

    SUBCASE("pages past their budget leave the runs theirs") {
        const TestServer server(servingSettings(), foobar.player(), &library);
        CHECK(statusesOf(server, getting("pages", playlistPagePath()), kPlaylistRowsBurst + 1) ==
              std::set<int>{200, 429});

        const auto runs = get(server, playlistRunsPath());
        REQUIRE(runs);
        CHECK(runs->status == 200);
    }

    SUBCASE("runs past their budget leave the pages theirs") {
        const TestServer server(servingSettings(), foobar.player(), &library);
        CHECK(statusesOf(server, getting("playlist runs", playlistRunsPath()),
                         kPlaylistRunsBurst + 1) == std::set<int>{200, 429});

        const auto page = get(server, playlistPagePath());
        REQUIRE(page);
        CHECK(page->status == 200);
    }
}

// A phone left looping in a pocket must not stop the laptop in the next room from scrolling a
// playlist. One socket serves both stacks, so the two clients arrive on two addresses over a real
// connection.
TEST_CASE("a client on another address reads a playlist's rows on while one is being refused") {
    FakePlayer foobar;
    holdingLibraryRows(foobar);
    const TestServer server = servingBothStacks(foobar.player());
    REQUIRE(server.status().listening);

    auto elsewhere = overIpv6(server);
    auto looping = server.client();
    for (int sent = 0; sent < kPlaylistRowsBurst; ++sent) {
        const auto response = looping.Get(playlistPagePath());
        REQUIRE(response);
        REQUIRE(response->status == 200);
    }
    const auto refused = looping.Get(playlistPagePath());
    REQUIRE(refused);
    CHECK(refused->status == 429);

    INFO("the second address is ::1, reached through a dual-stack bind");
    const auto unaffected = elsewhere.Get(playlistPagePath());
    REQUIRE(unaffected);
    CHECK(unaffected->status == 200);
}

namespace {

constexpr int kFindBurst = 200;
constexpr auto kFindRefill = std::chrono::milliseconds(50);

const std::string& findPath() {
    static const std::string path = std::string("/api/playlists/") + kPlaylistId +
                                    "/find?query=a&structure=1&title=%25title%25";
    return path;
}

const std::vector<RefusedQuestion>& refusedFinds() {
    static const std::vector<RefusedQuestion> refused{
        {std::string("/api/playlists/") + kPlaylistId +
             "/find?query=a&structure=1&colour=%25title%25",
         {{"error", "unacceptable role"}, {"detail", "'colour' is not a role"}}},
        {std::string("/api/playlists/") + kPlaylistId + "/find?structure=1&title=%25title%25",
         {{"error", "unacceptable question"}, {"detail", "'query' is required"}}},
        {std::string("/api/playlists/") + kPlaylistId + "/find?query=" + std::string(1025, 'a') +
             "&structure=1&title=%25title%25",
         {{"error", "unacceptable question"}, {"detail", "'query' must be at most 1024 bytes"}}},
    };
    return refused;
}

void checkTooManyFinds(const httplib::Result& refused) {
    REQUIRE(refused);
    CHECK(refused->status == 429);
    CHECK(json::parse(refused->body, nullptr, false) ==
          json{{"error", "too many playlist searches"}});
    const auto wait = refused->get_header_value("Retry-After");
    CHECK_FALSE(wait.empty());
    CHECK(wait.find_first_not_of("0123456789") == std::string::npos);
}

}  // namespace

TEST_CASE("a find refused for what it asks spends none of the find budget") {
    Library library;
    FakePlayer foobar(&library);
    const TestServer server(servingSettings(), foobar.player(), &library);

    std::vector<std::string> paths;
    for (const auto& refused : refusedFinds())
        paths.push_back(refused.path);
    CHECK(unexpectedAnswers(
              server, paths, kFindBurst + 1, [](size_t at, const httplib::Response& response) {
                  return response.status == 400 &&
                         json::parse(response.body, nullptr, false) == refusedFinds()[at].body;
              }) == 0);

    const auto asked = get(server, findPath());
    REQUIRE(asked);
    CHECK(asked->status == 202);
    CHECK(foobar.total() == 0);
}

TEST_CASE("a find the component cannot serve spends none of the find budget") {
    FakePlayer foobar;
    const TestServer server(servingSettings(), foobar.player());

    CHECK(unexpectedAnswers(server, {findPath()}, kFindBurst + 1,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 503 && errorOf(response) == kNoLibrary;
                            }) == 0);

    const auto refused = get(server, refusedFinds().front().path);
    REQUIRE(refused);
    CHECK(refused->status == 400);
    CHECK(foobar.total() == 0);
}

TEST_CASE("finds past their own budget are refused with a 429, and earn one back every 50 ms") {
    Library library;
    FakePlayer foobar(&library);
    const TestServer server(servingSettings(), foobar.player(), &library);

    CHECK(unexpectedAnswers(server, {findPath()}, kFindBurst,
                            [](size_t /*at*/, const httplib::Response& response) {
                                return response.status == 202;
                            }) == 0);
    checkTooManyFinds(get(server, findPath()));

    server.advanceClock(kFindRefill - std::chrono::milliseconds(1));
    checkTooManyFinds(get(server, findPath()));

    server.advanceClock(std::chrono::milliseconds(1));
    const auto earned = get(server, findPath());
    REQUIRE(earned);
    CHECK(earned->status == 202);
    checkTooManyFinds(get(server, findPath()));

    const auto refused = get(server, refusedFinds().front().path);
    REQUIRE(refused);
    CHECK(refused->status == 400);
    CHECK(foobar.total() == 0);
}

TEST_CASE("finds and questions each spend a budget of their own") {
    SUBCASE("finds spent leave the questions whole") {
        Library library;
        FakePlayer foobar(&library);
        const TestServer server(servingSettings(), foobar.player(), &library);
        CHECK(unexpectedAnswers(server, {findPath()}, kFindBurst,
                                [](size_t /*at*/, const httplib::Response& response) {
                                    return response.status == 202;
                                }) == 0);
        checkTooManyFinds(get(server, findPath()));

        for (const std::string path : {kAlbumQuestion, kSearch}) {
            INFO("question: ", path);
            const auto asked = get(server, path);
            REQUIRE(asked);
            CHECK(asked->status == 202);
        }
    }

    SUBCASE("questions spent leave the finds whole") {
        Library library;
        FakePlayer foobar(&library);
        const TestServer server(servingSettings(), foobar.player(), &library);
        CHECK(unexpectedAnswers(server, {kSearch}, kQuestionBurst,
                                [](size_t /*at*/, const httplib::Response& response) {
                                    return response.status == 202;
                                }) == 0);
        const auto question = get(server, kSearch);
        REQUIRE(question);
        REQUIRE(question->status == 429);

        const auto asked = get(server, findPath());
        REQUIRE(asked);
        CHECK(asked->status == 202);
    }
}

// What follows the budget in the Admission order: the roles judged against the declaration, then
// the player. Each spends a token, so a client looping on a stale structure is slowed like any.
TEST_CASE("a find refused by the declaration or the player spends the budget first") {
    Library library;
    buildLibrary(library);
    FakePlayer foobar(&library);
    PlaylistAnnotation playlist;
    playlist.id = kPlaylistId;
    playlist.title = "Road trip";
    playlist.structure = 2;
    playlist.revision = 2;
    foobar.add(playlist, titledRows({"a"}));
    const TestServer server(servingSettings(), foobar.player(), &library);

    const auto prefix = std::string("/api/playlists/");
    const std::vector<std::pair<std::string, int>> refusals{
        {prefix + kPlaylistId + "/find?query=a&structure=2&title=%25comment%25", 409},
        {prefix + kPlaylistId + "/find?query=a&structure=1&title=%25title%25", 409},
        {prefix + "0f0f0f0f-0000-4000-8000-000000000001/find?query=a&structure=2&title=%25title%25",
         404},
    };
    std::vector<std::string> paths;
    paths.reserve(refusals.size());
    for (const auto& refusal : refusals)
        paths.push_back(refusal.first);
    CHECK(unexpectedAnswers(server, paths, kFindBurst,
                            [&refusals](size_t at, const httplib::Response& response) {
                                return response.status == refusals[at].second;
                            }) == 0);

    checkTooManyFinds(
        get(server, prefix + kPlaylistId + "/find?query=a&structure=2&title=%25title%25"));
}

constexpr auto kSummaryRefill = std::chrono::milliseconds(50);

TEST_CASE("the summary budget earns one read back every 50 ms") {
    Library library;
    const TestServer server(servingSettings(), Player{}, &library);

    const Edit summary{"a summary before the snapshot is built",
                       [](const TestServer& serving) { return get(serving, kSummary); }};
    const auto summaryStatus = [&server] {
        const auto answered = get(server, kSummary);
        REQUIRE(answered);
        return answered->status;
    };
    REQUIRE(statusesOf(server, summary, kSummaryBurst) == std::set<int>{202});
    REQUIRE(summaryStatus() == 429);

    server.advanceClock(kSummaryRefill - std::chrono::milliseconds(1));
    CHECK(summaryStatus() == 429);

    server.advanceClock(std::chrono::milliseconds(1));
    CHECK(summaryStatus() == 202);
    CHECK(summaryStatus() == 429);
}
