#include "third_party/doctest.h"

#include "core/http_server.h"
#include "core/playlists.h"
#include "core/reload.h"
#include "core/settings.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <atomic>
#include <initializer_list>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

const std::vector<std::string> kLiveKeys{
    "allowedFields",  "allowedHosts",     "allowedOrigins",   "changeOutput",
    "controlPlayback", "maxAutoPlaylists", "streamingEnabled", "writePlaylists"};

const std::vector<std::string> kRestartKeys{
    "aacBitrate",  "bindAddress", "maxConcurrentStreams", "muteWhileStreaming",
    "opusBitrate", "port",        "streamTicketTtlSeconds"};

std::vector<std::string> sorted(std::vector<std::string> keys) {
    std::sort(keys.begin(), keys.end());
    return keys;
}

bool hasAll(const std::string& line, std::initializer_list<const char*> fragments) {
    return std::all_of(fragments.begin(), fragments.end(), [&line](const char* fragment) {
        return line.find(fragment) != std::string::npos;
    });
}

bool anyLineHasAll(const std::vector<std::string>& lines,
                   std::initializer_list<const char*> fragments) {
    return std::any_of(lines.begin(), lines.end(),
                       [fragments](const std::string& line) { return hasAll(line, fragments); });
}

size_t mentions(const std::vector<std::string>& lines, const std::string& key) {
    size_t count = 0;
    for (const auto& line : lines)
        for (auto at = line.find(key); at != std::string::npos; at = line.find(key, at + 1))
            ++count;
    return count;
}

// Every key away from its default, so keeping the running value and falling back to the default
// can never be mistaken for each other.
Settings runningAwayFromDefaults() {
    return parseSettings(R"({
        "port": 9100,
        "bindAddress": "192.168.1.10",
        "allowedOrigins": ["https://old.example"],
        "allowedHosts": ["old.example"],
        "allowedFields": ["rating", "title"],
        "maxAutoPlaylists": 5,
        "writePlaylists": false,
        "controlPlayback": false,
        "changeOutput": false,
        "opusBitrate": 320000,
        "aacBitrate": 128000,
        "streamingEnabled": false,
        "maxConcurrentStreams": 3,
        "streamTicketTtlSeconds": 300,
        "muteWhileStreaming": false
    })");
}

json fileOf(const Settings& settings) {
    return json::parse(serialiseSettings(settings));
}

}  // namespace

TEST_CASE("a reload applies every live key the file moves, and reports each as changed") {
    const auto decision = decideReload(Settings(), R"({
        "controlPlayback": false,
        "writePlaylists": false,
        "allowedFields": ["rating", "comment"],
        "changeOutput": false,
        "streamingEnabled": false,
        "maxAutoPlaylists": 37,
        "allowedHosts": ["jukebox.example"],
        "allowedOrigins": ["https://jean.example"]
    })");

    CHECK_FALSE(decision.next.controlPlayback);
    CHECK_FALSE(decision.next.writePlaylists);
    CHECK(decision.next.allowedFields == std::vector<std::string>{"rating", "comment"});
    CHECK_FALSE(decision.next.changeOutput);
    CHECK_FALSE(decision.next.streamingEnabled);
    CHECK(decision.next.maxAutoPlaylists == 37);
    CHECK(decision.next.allowedHosts == std::vector<std::string>{"jukebox.example"});
    CHECK(decision.next.allowedOrigins == std::vector<std::string>{"https://jean.example"});

    CHECK(sorted(decision.changedKeys) == kLiveKeys);
    CHECK(decision.restartKeys.empty());
}

TEST_CASE("a reload moving one switch reports that switch and no other") {
    const auto decision = decideReload(Settings(), R"({"controlPlayback": false})");

    CHECK_FALSE(decision.next.controlPlayback);
    CHECK(decision.changedKeys == std::vector<std::string>{"controlPlayback"});
    CHECK(decision.restartKeys.empty());
}

TEST_CASE("a reload keeps every restart-only key at its running value and reports each that differs") {
    const auto running = runningAwayFromDefaults();

    auto file = running;
    file.port = 9000;
    file.bindAddress = "127.0.0.1";
    file.opusBitrate = 128000;
    file.aacBitrate = 96000;
    file.maxConcurrentStreams = 2;
    file.streamTicketTtlSeconds = 60;
    file.muteWhileStreaming = true;

    const auto decision = decideReload(running, serialiseSettings(file));

    CHECK(decision.next == running);
    CHECK(decision.changedKeys.empty());
    CHECK(sorted(decision.restartKeys) == kRestartKeys);
}

// The preferences page says a restart is needed only while a restart-only key differs from what
// is running, so the report compares against the running value, never against the previous file.
TEST_CASE("a restart-only key is reported on every reload while it differs, and not once the file agrees") {
    const auto running = runningAwayFromDefaults();

    auto moved = running;
    moved.port = 9000;
    const auto first = decideReload(running, serialiseSettings(moved));
    const auto again = decideReload(first.next, serialiseSettings(moved));

    CHECK(first.restartKeys == std::vector<std::string>{"port"});
    CHECK(again.restartKeys == std::vector<std::string>{"port"});

    const auto agreed = decideReload(again.next, serialiseSettings(running));
    CHECK(agreed.restartKeys.empty());
}

TEST_CASE("a live key removed from the file returns to its default on a reload") {
    const auto running = runningAwayFromDefaults();

    auto expected = running;
    expected.writePlaylists = Settings().writePlaylists;
    auto file = fileOf(running);
    file.erase("writePlaylists");

    const auto decision = decideReload(running, file.dump());

    CHECK(decision.next == expected);
    CHECK(decision.changedKeys == std::vector<std::string>{"writePlaylists"});
}

// A file caught halfway through a save is truncated or empty. Falling back to defaults then would
// turn every switch on until the save finished.
TEST_CASE("a file that is not a JSON object keeps every running value and logs why") {
    const auto running = runningAwayFromDefaults();

    for (const auto* text : {R"({"writePlaylists": tr)", "", "   "}) {
        INFO("file: [" << text << "]");
        const auto decision = decideReload(running, text);

        CHECK(decision.next == running);
        CHECK(decision.changedKeys.empty());
        CHECK(decision.restartKeys.empty());
        CHECK(anyLineHasAll(decision.logLines, {"could not parse"}));
    }

    const auto array = decideReload(running, R"(["writePlaylists", true])");
    CHECK(array.next == running);
    CHECK(array.changedKeys.empty());
    CHECK(anyLineHasAll(array.logLines, {"expected a JSON object"}));
}

TEST_CASE("documentValid tells a watcher whether the file it just read is worth remembering") {
    const auto running = runningAwayFromDefaults();

    CHECK_FALSE(decideReload(running, R"({"writePlaylists": tr)").documentValid);
    CHECK_FALSE(decideReload(running, "").documentValid);
    CHECK_FALSE(decideReload(running, R"(["writePlaylists", true])").documentValid);
    CHECK(decideReload(running, fileOf(running).dump()).documentValid);
}

TEST_CASE("a malformed switch on a reload takes its default rather than the running value, and says so") {
    const auto running = runningAwayFromDefaults();
    REQUIRE_FALSE(running.writePlaylists);

    auto file = fileOf(running);
    file["writePlaylists"] = 0;

    const auto decision = decideReload(running, file.dump());

    CHECK(decision.next.writePlaylists);
    CHECK(decision.changedKeys == std::vector<std::string>{"writePlaylists"});
    CHECK(anyLineHasAll(decision.logLines, {"writePlaylists", "0", "true"}));
}

TEST_CASE("an out-of-range live key on a reload takes its default and names the refused value") {
    const auto running = runningAwayFromDefaults();
    REQUIRE(running.maxAutoPlaylists == 5);

    auto file = fileOf(running);
    file["maxAutoPlaylists"] = -7;

    const auto decision = decideReload(running, file.dump());

    CHECK(decision.next.maxAutoPlaylists == Settings().maxAutoPlaylists);
    CHECK(decision.changedKeys == std::vector<std::string>{"maxAutoPlaylists"});
    CHECK(anyLineHasAll(decision.logLines, {"maxAutoPlaylists", "-7", "100"}));
}

TEST_CASE("a reload that changes keys logs one line naming each once with its new value") {
    const auto decision = decideReload(Settings(), R"({
        "writePlaylists": false,
        "allowedHosts": ["jukebox.example"],
        "maxAutoPlaylists": 37
    })");

    const auto& lines = decision.logLines;
    const auto line = std::find_if(lines.begin(), lines.end(), [](const std::string& each) {
        return each.find("writePlaylists") != std::string::npos;
    });
    REQUIRE(line != lines.end());

    CHECK(hasAll(*line, {"writePlaylists", "false"}));
    CHECK(hasAll(*line, {"allowedHosts", "jukebox.example"}));
    CHECK(hasAll(*line, {"maxAutoPlaylists", "37"}));

    for (const auto* key : {"writePlaylists", "allowedHosts", "maxAutoPlaylists"}) {
        INFO(key);
        CHECK(mentions(lines, key) == 1);
    }

    for (const auto* key : {"controlPlayback", "changeOutput", "streamingEnabled", "allowedFields",
                            "allowedOrigins"}) {
        INFO(key);
        CHECK(mentions(lines, key) == 0);
    }
}

// T8's configGeneration moves only when a reload changed something, and an editor that rewrites
// the file with the same values in another layout is the everyday case of changing nothing.
TEST_CASE("a reload that changes nothing says so and names no key") {
    const auto running = runningAwayFromDefaults();

    for (const auto& text : {serialiseSettings(running),
                             std::string(R"({"muteWhileStreaming": false, "streamTicketTtlSeconds": 300,
                                 "maxConcurrentStreams": 3, "streamingEnabled": false,
                                 "aacBitrate": 128000, "opusBitrate": 320000,
                                 "changeOutput": false, "controlPlayback": false,
                                 "writePlaylists": false, "maxAutoPlaylists": 5,
                                 "allowedFields": ["rating", "title"],
                                 "allowedHosts": ["old.example"],
                                 "allowedOrigins": ["https://old.example"],
                                 "bindAddress": "192.168.1.10", "port": 9100})")}) {
        const auto decision = decideReload(running, text);

        CHECK(decision.next == running);
        CHECK(decision.changedKeys.empty());
        CHECK(decision.restartKeys.empty());
        CHECK_FALSE(decision.logLines.empty());

        for (const auto& key : kLiveKeys) {
            INFO(key);
            CHECK(mentions(decision.logLines, key) == 0);
        }
    }
}

namespace {

constexpr char kPlayPause[] = "/api/playback/play-pause";

Player countingTransport(std::atomic<size_t>* sent) {
    Player player = servingPlayer();
    player.commandTransport = [sent](Transport) {
        ++*sent;
        return PlaylistOutcome::done;
    };
    return player;
}

Player countingCreates(std::atomic<size_t>* created) {
    Player player = servingPlayer();
    player.createPlaylist = [created](const std::string& title, const NewPlaylistRows&) {
        ++*created;
        PlaylistResult made;
        made.playlist.id = "6f1c0b8a-2d4e-4f7a-9c31-0ab5e8d24f60";
        made.playlist.title = title;
        return made;
    };
    return player;
}

json capabilitiesOf(const TestServer& server) {
    const auto response = get(server, "/api/capabilities");
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

std::string errorOf(const httplib::Response& response) {
    const auto body = json::parse(response.body, nullptr, false);
    return body.is_object() ? body.value("error", "") : "";
}

httplib::Result statusNamed(const TestServer& server, const std::string& host) {
    return server.client().Get("/api/status",
                               httplib::Headers{{"Host", host + ":" + std::to_string(server.port())}});
}

httplib::Result statusFrom(const TestServer& server, const std::string& origin) {
    return server.client().Get("/api/status", httplib::Headers{{"Origin", origin}});
}

}  // namespace

TEST_CASE("a reload turning controlPlayback off refuses the next playback command, and capabilities says so") {
    std::atomic<size_t> sent{0};
    TestServer server(servingSettings(), countingTransport(&sent));

    const auto before = post(server, kPlayPause, "");
    REQUIRE(before);
    REQUIRE(before->status == 204);
    REQUIRE(capabilitiesOf(server)["canControlPlayback"] == true);

    server.reload(R"({"controlPlayback": false})");

    const auto refused = post(server, kPlayPause, "");
    REQUIRE(refused);
    CHECK(refused->status == 403);
    CHECK(errorOf(*refused) == describe(PlaylistOutcome::playbackDisabled));
    CHECK(sent == 1);
    CHECK(capabilitiesOf(server)["canControlPlayback"] == false);

    server.reload("{}");

    const auto restored = post(server, kPlayPause, "");
    REQUIRE(restored);
    CHECK(restored->status == 204);
    CHECK(sent == 2);
    CHECK(capabilitiesOf(server)["canControlPlayback"] == true);
}

TEST_CASE("a reload turning writePlaylists off refuses the next playlist write, and capabilities says so") {
    std::atomic<size_t> created{0};
    TestServer server(servingSettings(), countingCreates(&created));

    const auto before = post(server, "/api/playlists", R"({"title": "Evening"})");
    REQUIRE(before);
    REQUIRE(before->status == 200);
    REQUIRE(capabilitiesOf(server)["canWritePlaylists"] == true);

    server.reload(R"({"writePlaylists": false})");

    const auto refused = post(server, "/api/playlists", R"({"title": "Evening"})");
    REQUIRE(refused);
    CHECK(refused->status == 403);
    CHECK(errorOf(*refused) == describe(PlaylistOutcome::writesDisabled));
    CHECK(created == 1);
    CHECK(capabilitiesOf(server)["canWritePlaylists"] == false);
}

TEST_CASE("a name added to allowedHosts by a reload is admitted on the next request, and refused once removed") {
    TestServer server;

    const auto before = statusNamed(server, "jukebox.example");
    REQUIRE(before);
    REQUIRE(before->status == 403);

    server.reload(R"({"allowedHosts": ["jukebox.example"]})");

    const auto admitted = statusNamed(server, "jukebox.example");
    REQUIRE(admitted);
    CHECK(admitted->status == 200);

    server.reload("{}");

    const auto removed = statusNamed(server, "jukebox.example");
    REQUIRE(removed);
    CHECK(removed->status == 403);
}

TEST_CASE("an origin added to allowedOrigins by a reload is reflected on the next request, and not once removed") {
    TestServer server;

    const auto before = statusFrom(server, "https://jean.example");
    REQUIRE(before);
    REQUIRE_FALSE(before->has_header("Access-Control-Allow-Origin"));

    server.reload(R"({"allowedOrigins": ["https://jean.example"]})");

    const auto listed = statusFrom(server, "https://jean.example");
    REQUIRE(listed);
    CHECK(listed->get_header_value("Access-Control-Allow-Origin") == "https://jean.example");

    server.reload("{}");

    const auto removed = statusFrom(server, "https://jean.example");
    REQUIRE(removed);
    CHECK_FALSE(removed->has_header("Access-Control-Allow-Origin"));
}

TEST_CASE("capabilities after a reload describes every live switch as the file now has it") {
    TestServer server;

    server.reload(R"({
        "allowedFields": [],
        "changeOutput": false,
        "maxAutoPlaylists": 0
    })");

    const auto body = capabilitiesOf(server);
    CHECK(body["allowedFields"] == json::array());
    CHECK(body["canWrite"] == false);
    CHECK(body["canChangeOutput"] == false);
    CHECK(body["maxAutoPlaylists"] == 0);
    CHECK(body["canCreateAutoPlaylists"] == false);
}

// A handler that read the switches twice could answer from two reloads at once. Both switches
// flip together here, so an answer carrying one old and one new is a torn read.
TEST_CASE("requests in flight on several threads each see one whole set of switches while reloads swap them") {
    constexpr int kClients = 4;
    constexpr int kRequestsEach = 40;

    std::atomic<size_t> sent{0};
    TestServer server(servingSettings(), countingTransport(&sent));

    std::vector<httplib::Client> clients;
    for (int each = 0; each < kClients; ++each)
        clients.push_back(server.client());

    std::atomic<bool> finished{false};
    std::atomic<size_t> reloads{0};
    std::thread reloader([&server, &finished, &reloads] {
        while (!finished) {
            server.reload(reloads % 2 == 0 ? R"({"controlPlayback": false, "writePlaylists": false})"
                                           : "{}");
            ++reloads;
        }
    });

    std::atomic<int> torn{0};
    std::atomic<int> unexpected{0};
    std::vector<std::thread> requesters;
    for (auto& client : clients) {
        requesters.emplace_back([&client, &torn, &unexpected] {
            for (int request = 0; request < kRequestsEach; ++request) {
                const auto capabilities = client.Get("/api/capabilities");
                if (!capabilities || capabilities->status != 200) {
                    ++unexpected;
                    continue;
                }

                const auto body = json::parse(capabilities->body);
                if (body["canControlPlayback"] != body["canWritePlaylists"])
                    ++torn;

                const auto command = client.Post(kPlayPause, "", "application/json");
                if (!command || (command->status != 204 && command->status != 403))
                    ++unexpected;
            }
        });
    }

    for (auto& requester : requesters)
        requester.join();
    finished = true;
    reloader.join();

    CHECK(torn == 0);
    CHECK(unexpected == 0);
    CHECK(reloads > 1);
}
