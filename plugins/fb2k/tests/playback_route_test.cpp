// POST /api/playback/... and POST /api/volume over a real socket: the player's own commands,
// each handed to the seam src/fb2k/ fills and answered before the player has done anything.
// What playback_control does with a command is reviewed on the player rather than tested here.

#include "third_party/doctest.h"

#include "support/fixtures.h"
#include "support/spec.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace doctest {
template <>
struct StringMaker<jean::Transport> {
    static String convert(jean::Transport command) {
        switch (command) {
            case jean::Transport::playPause:
                return "playPause";
            case jean::Transport::next:
                return "next";
            case jean::Transport::previous:
                return "previous";
            case jean::Transport::stop:
                return "stop";
        }
        return "a Transport with no name";
    }
};

template <>
struct StringMaker<jean::VolumeStep> {
    static String convert(jean::VolumeStep step) {
        switch (step) {
            case jean::VolumeStep::up:
                return "up";
            case jean::VolumeStep::down:
                return "down";
        }
        return "a VolumeStep with no name";
    }
};
}  // namespace doctest

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kPlayPause[] = "/api/playback/play-pause";
constexpr char kNext[] = "/api/playback/next";
constexpr char kPrevious[] = "/api/playback/previous";
constexpr char kStop[] = "/api/playback/stop";
constexpr char kSeek[] = "/api/playback/seek";
constexpr char kMode[] = "/api/playback/mode";
constexpr char kVolume[] = "/api/volume";

struct TransportRoute {
    const char* path;
    Transport sent;
};

constexpr std::array<TransportRoute, 4> kTransportRoutes{{{kPlayPause, Transport::playPause},
                                                          {kNext, Transport::next},
                                                          {kPrevious, Transport::previous},
                                                          {kStop, Transport::stop}}};

struct Command {
    const char* path;
    const char* body;
};

// One well-formed request to each of the seven, every one of which the stock player can meet.
constexpr std::array<Command, 7> kOneOfEach{{{kPlayPause, ""},
                                             {kNext, ""},
                                             {kPrevious, ""},
                                             {kStop, ""},
                                             {kSeek, R"({"seconds": 30})"},
                                             {kMode, R"({"mode": "random"})"},
                                             {kVolume, R"({"step": "up"})"}}};

constexpr std::array<Command, 9> kEveryForm{{{kPlayPause, ""},
                                             {kNext, ""},
                                             {kPrevious, ""},
                                             {kStop, ""},
                                             {kSeek, R"({"seconds": 30})"},
                                             {kMode, R"({"mode": "random"})"},
                                             {kVolume, R"({"value": -30})"},
                                             {kVolume, R"({"step": "up"})"},
                                             {kVolume, R"({"muted": true})"}}};

constexpr std::array<const char*, 3> kRoutesWithABody{{kSeek, kMode, kVolume}};

struct StockMode {
    const char* mode;
    size_t index;
};

// Where a stock foobar2000 2.25.3 lists each order, by the Jean name for it. The display strings
// behind these are pinned in tests/playback_modes_test.cpp.
constexpr std::array<StockMode, 7> kStockModes{{{"inOrder", 0},
                                                {"repeatAll", 1},
                                                {"repeatOne", 2},
                                                {"random", 3},
                                                {"shuffleTracks", 4},
                                                {"shuffleAlbums", 5},
                                                {"shuffleFolders", 6}}};

const std::vector<std::string>& stockOrders() {
    static const std::vector<std::string> orders{
        "Default",          "Repeat (playlist)", "Repeat (track)",   "Random",
        "Shuffle (tracks)", "Shuffle (albums)",  "Shuffle (folders)"};
    return orders;
}

// An install offering only these two, which moves Random from where a stock player lists it.
const std::vector<std::string>& twoOrders() {
    static const std::vector<std::string> orders{"Default", "Random"};
    return orders;
}

// No stock foobar2000 has this order, and it is shaped like one a component would plausibly add.
constexpr char kAddedByAComponent[] = "Shuffle (artists)";

struct Seek {
    double seconds = 0;
    bool relative = false;
};

struct Commands {
    std::vector<Transport> transports;
    std::vector<Seek> seeks;
    std::vector<size_t> orders;
    std::vector<double> levels;
    std::vector<VolumeStep> steps;
    std::vector<bool> mutes;

    PlayerOutcome answer = PlayerOutcome::done;

    size_t count() const {
        return transports.size() + seeks.size() + orders.size() + levels.size() + steps.size() +
               mutes.size();
    }
};

// Stands in for src/fb2k/playback_commands.cpp, which needs the foobar2000 SDK and never
// compiles here. The pointer must outlive the server.
Player commanding(Commands* commands,
                  const std::vector<std::string>& playbackOrders = stockOrders()) {
    Player player = servingPlayer();
    player.report.playbackOrders = playbackOrders;

    player.playback.commandTransport = [commands](Transport command) {
        commands->transports.push_back(command);
        return commands->answer;
    };
    player.playback.seek = [commands](double seconds, bool relative) {
        commands->seeks.push_back({seconds, relative});
        return commands->answer;
    };
    player.playback.setOrder = [commands](size_t index) {
        commands->orders.push_back(index);
        return commands->answer;
    };
    player.playback.setVolume = [commands](double level) {
        commands->levels.push_back(level);
        return commands->answer;
    };
    player.playback.stepVolume = [commands](VolumeStep step) {
        commands->steps.push_back(step);
        return commands->answer;
    };
    player.playback.setMuted = [commands](bool muted) {
        commands->mutes.push_back(muted);
        return commands->answer;
    };

    return player;
}

void checkAnswered(const httplib::Result& response) {
    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(response->body.empty());
}

std::string checkRefused(const TestServer& server, const Commands& commands,
                         const std::string& path, const std::string& body, int status) {
    const auto before = commands.count();
    const auto response = post(server, path, body);

    INFO("POST ", path, " ", body);
    REQUIRE(response);
    CHECK(response->status == status);
    const auto error = errorOf(*response);
    CHECK_FALSE(error.empty());
    CHECK(commands.count() == before);
    return error;
}

void checkUnfinished(const TestServer& server, const Commands& commands, const Command& command,
                     int status, const std::string& error) {
    const auto before = commands.count();
    const auto response = post(server, command.path, command.body);

    INFO("POST ", command.path, " ", command.body);
    REQUIRE(response);
    CHECK(response->status == status);
    CHECK(errorOf(*response) == error);
    CHECK(commands.count() == before + 1);
}

}  // namespace

TEST_CASE("each transport command is a 204 with no body, and reaches the player as that command") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const auto& route : kTransportRoutes) {
        INFO("POST ", route.path);
        checkAnswered(post(server, route.path, ""));

        REQUIRE_FALSE(commands.transports.empty());
        CHECK(commands.transports.back() == route.sent);
    }

    CHECK(commands.transports.size() == kTransportRoutes.size());
    CHECK(commands.count() == kTransportRoutes.size());
}

TEST_CASE(
    "a body sent to a transport command is ignored, and the player is asked for that command "
    "alone") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const auto& route : kTransportRoutes) {
        INFO("POST ", route.path);
        const auto before = commands.count();
        checkAnswered(post(server, route.path, R"({"seconds": 5})"));

        REQUIRE_FALSE(commands.transports.empty());
        CHECK(commands.transports.back() == route.sent);
        CHECK(commands.count() == before + 1);
    }

    CHECK(commands.transports.size() == kTransportRoutes.size());
    CHECK(commands.seeks.empty());
}

TEST_CASE("a seek reaches the player as the seconds it named, and says whether they are relative") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkAnswered(post(server, kSeek, R"({"seconds": 90})"));
    checkAnswered(post(server, kSeek, R"({"relativeSeconds": -10})"));
    checkAnswered(post(server, kSeek, R"({"relativeSeconds": 15})"));

    REQUIRE(commands.seeks.size() == 3);
    CHECK(commands.seeks[0].seconds == 90);
    CHECK_FALSE(commands.seeks[0].relative);
    CHECK(commands.seeks[1].seconds == -10);
    CHECK(commands.seeks[1].relative);
    CHECK(commands.seeks[2].seconds == 15);
    CHECK(commands.seeks[2].relative);
    CHECK(commands.count() == 3);
}

// Which form a seek takes is read off the field that is there, never off what it holds. A check
// written against truthiness refuses the start of the track, which is where a restart lands.
TEST_CASE("a seek to 0 seconds, absolute or relative, is a seek like any other") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkAnswered(post(server, kSeek, R"({"seconds": 0})"));
    checkAnswered(post(server, kSeek, R"({"relativeSeconds": 0})"));

    REQUIRE(commands.seeks.size() == 2);
    CHECK(commands.seeks[0].seconds == 0);
    CHECK_FALSE(commands.seeks[0].relative);
    CHECK(commands.seeks[1].seconds == 0);
    CHECK(commands.seeks[1].relative);
}

// Each pair below holds a zero, so a route counting truthy fields would see one and obey it.
TEST_CASE("a seek naming both forms, or neither, is a 400 and never reaches the player") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* body :
         {R"({"seconds": 0, "relativeSeconds": 5})", R"({"seconds": 30, "relativeSeconds": 0})",
          R"({"seconds": 30, "relativeSeconds": -5})", "{}"})
        checkRefused(server, commands, kSeek, body, 400);

    CHECK(commands.count() == 0);
}

TEST_CASE(
    "a seek to a negative position is a 400 while a seek to 0 or a relative seek backward "
    "lands") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    CHECK(checkRefused(server, commands, kSeek, R"({"seconds": -1})", 400) == "unacceptable seek");
    CHECK(commands.count() == 0);

    checkAnswered(post(server, kSeek, R"({"seconds": 0})"));
    checkAnswered(post(server, kSeek, R"({"relativeSeconds": -10})"));

    CHECK(commands.seeks.size() == 2);
}

TEST_CASE("a seek or a volume level too large to be a finite number is a 400") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkRefused(server, commands, kSeek, R"({"seconds": 1e999})", 400);
    checkRefused(server, commands, kSeek, R"({"relativeSeconds": -1e999})", 400);
    checkRefused(server, commands, kVolume, R"({"value": 1e999})", 400);

    CHECK(commands.count() == 0);
}

TEST_CASE("a volume level at either end of the player's own range is a 204") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkAnswered(post(server, kVolume, R"({"value": -100})"));
    checkAnswered(post(server, kVolume, R"({"value": 0})"));

    CHECK(commands.levels == std::vector<double>{-100, 0});
}

TEST_CASE("a volume level past either end of the player's own range is a 400") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* body : {R"({"value": -100.5})", R"({"value": 0.5})"})
        CHECK(checkRefused(server, commands, kVolume, body, 400) == "unacceptable volume");

    CHECK(commands.count() == 0);
}

TEST_CASE("a volume level is judged against the range this player publishes, not a fixed one") {
    Commands commands;
    Player player = commanding(&commands);
    player.report.volumeMin = -50;
    const TestServer server(servingSettings(), player);

    REQUIRE(capabilitiesOf(server)["volumeMin"] == -50);

    CHECK(checkRefused(server, commands, kVolume, R"({"value": -60})", 400) ==
          "unacceptable volume");
    checkAnswered(post(server, kVolume, R"({"value": -50})"));

    CHECK(commands.levels == std::vector<double>{-50});
}

TEST_CASE("a volume level of 0 and an unmute are 204, and reach the player as those values") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkAnswered(post(server, kVolume, R"({"value": 0})"));
    checkAnswered(post(server, kVolume, R"({"value": -30})"));
    checkAnswered(post(server, kVolume, R"({"muted": false})"));

    CHECK(commands.levels == std::vector<double>{0, -30});
    CHECK(commands.mutes == std::vector<bool>{false});
    CHECK(commands.count() == 3);
}

// As on seek, every pair holds a value a truthiness check would read as absent.
TEST_CASE("a volume write naming more than one of value, step and muted, or none, is a 400") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* body : {R"({"value": 0, "step": "up"})", R"({"value": -30, "muted": false})",
                             R"({"step": "down", "muted": false})",
                             R"({"value": 0, "step": "up", "muted": true})", "{}"})
        checkRefused(server, commands, kVolume, body, 400);

    CHECK(commands.count() == 0);
}

TEST_CASE("a volume step is spelled up or down, and reaches the player as that direction") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkAnswered(post(server, kVolume, R"({"step": "up"})"));
    checkAnswered(post(server, kVolume, R"({"step": "down"})"));

    REQUIRE(commands.steps.size() == 2);
    CHECK(commands.steps[0] == VolumeStep::up);
    CHECK(commands.steps[1] == VolumeStep::down);
    CHECK(commands.count() == 2);
}

// How far one step moves is foobar2000's to say, so a number here would be a client choosing it.
TEST_CASE("a volume step given as a number, or as any other word, is a 400") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* body : {R"({"step": 1})", R"({"step": -1})", R"({"step": "louder"})"})
        checkRefused(server, commands, kVolume, body, 400);

    CHECK(commands.count() == 0);
}

// A client sends the value it computed, so the same request twice has to land in the same place.
// A route that toggled would unmute on the second.
TEST_CASE("muting twice asks the player for muted twice rather than toggling back") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkAnswered(post(server, kVolume, R"({"muted": true})"));
    checkAnswered(post(server, kVolume, R"({"muted": true})"));

    CHECK(commands.mutes == std::vector<bool>{true, true});
}

TEST_CASE("a body that is not a JSON object is a 400 on every route that reads one") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* path : kRoutesWithABody)
        for (const char* body : {"", "{", "[]", "null", "42", R"("up")"})
            checkRefused(server, commands, path, body, 400);

    CHECK(commands.count() == 0);
}

TEST_CASE("a field the route does not publish is a 400") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    checkRefused(server, commands, kSeek, R"({"seconds": 30, "by": 1})", 400);
    checkRefused(server, commands, kSeek, R"({"position": 30})", 400);
    checkRefused(server, commands, kSeek, R"({"relativePosition": 5})", 400);
    checkRefused(server, commands, kMode, R"({"mode": "random", "relative": true})", 400);
    checkRefused(server, commands, kMode, R"({"playbackOrder": 3})", 400);
    checkRefused(server, commands, kVolume, R"({"step": "up", "by": 2})", 400);
    checkRefused(server, commands, kVolume, R"({"volume": -30})", 400);
    checkRefused(server, commands, kVolume, R"({"relativeVolume": 2})", 400);
    checkRefused(server, commands, kVolume, R"({"isMuted": true})", 400);

    CHECK(commands.count() == 0);
}

TEST_CASE("a field of the wrong type is a 400 and never reaches the player") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* body : {R"({"seconds": "30"})", R"({"seconds": null})", R"({"seconds": [30]})",
                             R"({"relativeSeconds": true})"})
        checkRefused(server, commands, kSeek, body, 400);

    for (const char* body : {R"({"value": "-30"})", R"({"value": null})", R"({"muted": 1})",
                             R"({"muted": "true"})", R"({"step": null})"})
        checkRefused(server, commands, kVolume, body, 400);

    for (const char* body : {R"({"mode": null})", R"({"mode": ["random"]})"})
        checkRefused(server, commands, kMode, body, 400);

    CHECK(commands.count() == 0);
}

TEST_CASE(
    "each of the seven modes reaches a stock foobar2000 as the position it lists that order at") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const auto& stock : kStockModes) {
        INFO("mode: ", stock.mode);
        checkAnswered(post(server, kMode, json{{"mode", stock.mode}}.dump()));

        REQUIRE_FALSE(commands.orders.empty());
        CHECK(commands.orders.back() == stock.index);
    }

    CHECK(commands.count() == kStockModes.size());
}

// The index is the player's, not foobar2000's usual one. A client that numbered the stock list
// sends 3 for random, which on this install is past the end.
TEST_CASE("a mode reaches the player as its position in this install's own list") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands, twoOrders()));

    checkAnswered(post(server, kMode, R"({"mode": "random"})"));
    checkAnswered(post(server, kMode, R"({"mode": "inOrder"})"));

    CHECK(commands.orders == std::vector<size_t>{1, 0});
}

// GET /api/capabilities leaves an order with no Jean name out of what it offers, and the player
// still counts it. Resolving against the offered list rather than the player's lands one short.
TEST_CASE("an order the player lists with no Jean name still counts toward the position") {
    Commands commands;
    const TestServer server(servingSettings(),
                            commanding(&commands, {kAddedByAComponent, "Default", "Random"}));

    checkAnswered(post(server, kMode, R"({"mode": "random"})"));
    checkAnswered(post(server, kMode, R"({"mode": "inOrder"})"));

    CHECK(commands.orders == std::vector<size_t>{2, 1});
}

TEST_CASE("a mode given as an ordinal is a 400, however valid the position") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* body : {R"({"mode": 3})", R"({"mode": 0})", R"({"mode": 3.0})"})
        checkRefused(server, commands, kMode, body, 400);

    CHECK(commands.count() == 0);
}

// foobar2000's own order names are the ones most likely to be sent by mistake, and PlaybackMode
// promises they never cross this API in either direction.
TEST_CASE("a mode name PlaybackMode does not carry is a 400, foobar2000's own names included") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const char* mode :
         {"shuffle", "shuffleArtists", "", "Random", "Shuffle (tracks)", kAddedByAComponent})
        checkRefused(server, commands, kMode, json{{"mode", mode}}.dump(), 400);

    CHECK(commands.count() == 0);
}

// The request is well formed and the player is why it cannot be met, which is a 409 rather than
// a 400. Guessing at the nearest order would put the player somewhere nobody asked for.
TEST_CASE(
    "a mode this install does not offer is a 409, and GET /api/capabilities does not offer it") {
    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands, twoOrders()));

    const auto offered = capabilitiesOf(server)["playbackModes"];

    for (const char* mode :
         {"repeatAll", "repeatOne", "shuffleTracks", "shuffleAlbums", "shuffleFolders"}) {
        INFO("mode: ", mode);
        checkRefused(server, commands, kMode, json{{"mode", mode}}.dump(), 409);
        CHECK(std::find(offered.begin(), offered.end(), mode) == offered.end());
    }

    CHECK(commands.count() == 0);
}

// A client draws its control from GET /api/capabilities and sends back whatever it drew.
TEST_CASE("every mode GET /api/capabilities offers is one POST /api/playback/mode accepts") {
    const std::vector<std::vector<std::string>> installs{
        stockOrders(), twoOrders(), {kAddedByAComponent, "Random", "Default"}};

    for (const auto& orders : installs) {
        Commands commands;
        const TestServer server(servingSettings(), commanding(&commands, orders));

        const auto offered = capabilitiesOf(server)["playbackModes"];
        REQUIRE_FALSE(offered.empty());

        for (const auto& mode : offered) {
            INFO("mode: ", mode.dump(), " against ", orders.size(), " orders");
            checkAnswered(post(server, kMode, json{{"mode", mode}}.dump()));
        }

        CHECK(commands.orders.size() == offered.size());
    }
}

// A held skip key or a dragged fader sends a run of these. The playlist limit exists for edits
// that rebuild a snapshot, and a refusal here would be a key that stops working mid-press.
TEST_CASE("a run of commands faster than the playlist limit allows is answered every time") {
    // Past the playlist burst by enough that a limit shared with it could not hide.
    constexpr size_t kHeldKey = 40;

    Commands commands;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const auto& command : kOneOfEach) {
        size_t answered = 0;
        size_t toldToWait = 0;

        for (size_t press = 0; press < kHeldKey; ++press) {
            const auto response = post(server, command.path, command.body);
            REQUIRE(response);

            answered += response->status == 204 ? 1 : 0;
            toldToWait += response->has_header("Retry-After") ? 1 : 0;
        }

        INFO("POST ", command.path, " ", command.body);
        CHECK(answered == kHeldKey);
        CHECK(toldToWait == 0);
    }

    CHECK(commands.count() == kHeldKey * kOneOfEach.size());
}

TEST_CASE("every command the player did not finish in time is a 504 saying so") {
    Commands commands;
    commands.answer = PlayerOutcome::timedOut;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const auto& command : kEveryForm)
        checkUnfinished(server, commands, command, 504, "the player did not answer in time");
}

TEST_CASE("every command the player refused is a 500 saying so") {
    Commands commands;
    commands.answer = PlayerOutcome::playerRefused;
    const TestServer server(servingSettings(), commanding(&commands));

    for (const auto& command : kEveryForm)
        checkUnfinished(server, commands, command, 500, "the player could not do that");
}

// A null seam is how src/fb2k/ says an install switched a feature off.
TEST_CASE("an install with no playback seams answers every command 503") {
    Player player = servingPlayer();
    player.report.playbackOrders = stockOrders();
    const TestServer server(servingSettings(), player);

    for (const auto& command : kOneOfEach) {
        INFO("POST ", command.path, " ", command.body);

        const auto response = post(server, command.path, command.body);

        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(json::parse(response->body)["error"].is_string());
    }
}

// Driven from the contract, so a playback route added later is refused without editing this.
TEST_CASE("with controlPlayback off, every playback command, seek, mode and volume is 403") {
    Commands commands;
    const TestServer server(parseSettings(R"({"controlPlayback": false})"), commanding(&commands));

    std::set<std::string> sentences;
    size_t routes = 0;

    for (const auto& route : publishedRoutes()) {
        const bool playback = route.path.rfind("/playback/", 0) == 0 || route.path == "/volume";
        if (route.method != "POST" || !playback)
            continue;

        ++routes;
        const auto path = "/api" + route.path;

        std::vector<std::string> bodies;
        for (const auto& command : kEveryForm)
            if (path == command.path)
                bodies.emplace_back(command.body);
        if (bodies.empty())
            bodies.emplace_back("{}");

        for (const auto& body : bodies) {
            const auto error = checkRefused(server, commands, path, body, 403);
            if (!error.empty())
                sentences.insert(error);
        }
    }

    REQUIRE(routes >= kOneOfEach.size());
    CHECK(commands.count() == 0);

    // One switch, one sentence, naming the switch a player's owner has to turn back on.
    REQUIRE(sentences.size() == 1);
    CHECK(sentences.begin()->find("controlPlayback") != std::string::npos);
}

TEST_CASE("with controlPlayback off, the player's state is still read") {
    const TestServer server(parseSettings(R"({"controlPlayback": false})"));

    const auto response = server.client().Get("/api/state");

    REQUIRE(response);
    CHECK(response->status == 200);
}
