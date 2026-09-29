// GET /api/outputs and POST /api/outputs/active over a real socket: which devices the player
// lists, and switching it to one of them. How src/fb2k/ reads and sets foobar2000's output is
// reviewed on the player rather than tested here.

#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/outputs.h"
#include "core/player_state.h"
#include "support/fixtures.h"
#include "support/keys.h"
#include "support/test_server.h"
#include "third_party/json.hpp"

#include <array>
#include <cstddef>
#include <optional>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kOutputs[] = "/api/outputs";
constexpr char kActive[] = "/api/outputs/active";

constexpr char kChangeDisabled[] =
    "this install has output device changes turned off; turn on changeOutput in config.json to "
    "allow them";
constexpr char kNotListed[] = "the player does not list that output device; read the outputs again";
constexpr char kOutputsUnavailable[] = "output devices are not available";

constexpr char kAskEveryTime[] = "private, no-cache";

// Shaped the way foobar2000 prints the pair, an output module's GUID and a device's joined by a
// colon, with braces, capitals and dashes a client could be tempted to tidy.
constexpr char kSpeakers[] =
    "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{0E1D3C47-5A7B-4F21-9C3D-2B8E6F4A1D90}";
constexpr char kHeadphones[] =
    "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}:{7C2A9E14-3B6D-4E8F-A1C5-9D0B2F7E4A36}";
constexpr char kDisplay[] =
    "{B1F04D6A-2E9C-4A57-8D13-6C0F5E7A9B28}:{00000000-0000-0000-0000-000000000000}";

// The module half alone, which a membership check by prefix or by substring would take for
// kSpeakers.
constexpr char kModuleAlone[] = "{5A3E1C27-8B4D-4F0E-9C61-2D7B8E9F0A13}";

constexpr char kUnissued[] =
    "{9D8C7B6A-5F4E-4D3C-8B2A-1F0E9D8C7B6A}:{6A5B4C3D-2E1F-4A0B-9C8D-7E6F5A4B3C2D}";

// Declared out of alphabetical order, so a list that came back sorted reads differently from
// one kept in the player's order.
std::vector<OutputDevice> threeDevices() {
    return {{kSpeakers, "Speakers (Fictional Audio)"},
            {kHeadphones, "Headphones (Fictional Audio)"},
            {kDisplay, "Haut-parleurs de l'écran (Fictional Display)"}};
}

struct Outputs {
    std::vector<OutputDevice> devices = threeDevices();
    std::optional<std::string> active = std::string{kHeadphones};

    PlayerOutcome listAnswer = PlayerOutcome::done;
    PlayerOutcome setAnswer = PlayerOutcome::done;

    size_t lists = 0;
    std::vector<std::string> switched;
};

// Stands in for src/fb2k/, which needs the foobar2000 SDK and never compiles here. The pointer
// must outlive the server.
Player switching(Outputs* outputs) {
    Player player = servingPlayer();

    player.outputs.list = [outputs] {
        ++outputs->lists;

        OutputsRead read;
        read.outcome = outputs->listAnswer;
        read.devices = outputs->devices;
        read.active = outputs->active;
        return read;
    };
    player.outputs.setActive = [outputs](const std::string& deviceId) {
        outputs->switched.push_back(deviceId);
        return outputs->setAnswer;
    };

    return player;
}

std::string switchTo(const std::string& deviceId) {
    return json{{"deviceId", deviceId}}.dump();
}

json outputsOf(const TestServer& server) {
    const auto response = get(server, kOutputs);

    REQUIRE(response);
    REQUIRE(response->status == 200);
    return json::parse(response->body);
}

void checkSwitched(const httplib::Result& response) {
    REQUIRE(response);
    CHECK(response->status == 204);
    CHECK(response->body.empty());
}

void checkAsksEveryTime(const httplib::Result& response) {
    REQUIRE(response);
    INFO("status ", response->status);
    CHECK(response->get_header_value("Cache-Control") == kAskEveryTime);
    CHECK_FALSE(response->has_header("ETag"));
}

void checkRefusedSaying(const httplib::Result& response, int status, const std::string& error) {
    REQUIRE(response);
    CHECK(response->status == status);
    CHECK(keysOf(response->body) == Keys{"error", "detail"});
    CHECK(errorOf(*response) == error);
}

}  // namespace

TEST_CASE(
    "GET /api/outputs answers every device the player lists, in its order, and the active "
    "one") {
    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    const auto body = outputsOf(server);

    CHECK(keysOf(body) == Keys{"devices", "active"});
    CHECK(body["devices"] ==
          json::array(
              {{{"id", kSpeakers}, {"name", "Speakers (Fictional Audio)"}},
               {{"id", kHeadphones}, {"name", "Headphones (Fictional Audio)"}},
               {{"id", kDisplay}, {"name", "Haut-parleurs de l'écran (Fictional Display)"}}}));
    CHECK(body["active"] == kHeadphones);
    CHECK(outputs.switched.empty());
}

// foobar2000 can be set to a device it no longer lists, one unplugged since, and a client has
// to be able to tell that from a device whose id it failed to read.
TEST_CASE("an active device the player does not list is null, present rather than missing") {
    Outputs outputs;
    outputs.active = std::nullopt;
    const TestServer server(servingSettings(), switching(&outputs));

    const auto body = outputsOf(server);

    REQUIRE(body.contains("active"));
    CHECK(body["active"] == nullptr);
    CHECK(body["devices"].size() == 3);
}

TEST_CASE("a player listing no devices answers an empty list and no active one") {
    Outputs outputs;
    outputs.devices.clear();
    outputs.active = std::nullopt;
    const TestServer server(servingSettings(), switching(&outputs));

    const auto body = outputsOf(server);

    CHECK(body["devices"] == json::array());
    CHECK(body["active"] == nullptr);
}

TEST_CASE(
    "switching to a listed device is a 204 with no body, and reaches the player once as "
    "that id") {
    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    checkSwitched(post(server, kActive, switchTo(kDisplay)));

    CHECK(outputs.switched == std::vector<std::string>{kDisplay});
}

// The id is opaque to every client, so the only promise is that what GET handed out is what
// the player is asked for. A route that parsed, trimmed or re-cased it would still pass a test
// written with a plain word for an id.
TEST_CASE(
    "an id read from GET /api/outputs switches the player to exactly that id, byte for "
    "byte") {
    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    const auto listed = outputsOf(server);
    for (const auto& device : listed["devices"]) {
        const auto id = device["id"].get<std::string>();
        INFO("device ", id);
        checkSwitched(post(server, kActive, switchTo(id)));
    }

    CHECK(outputs.switched == std::vector<std::string>{kSpeakers, kHeadphones, kDisplay});
}

TEST_CASE("a device the player does not list is a 409 and the player is never asked to switch") {
    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    for (const char* id : {kUnissued, kModuleAlone}) {
        INFO("deviceId ", id);
        checkRefusedSaying(post(server, kActive, switchTo(id)), 409, kNotListed);
    }

    CHECK(outputs.switched.empty());
}

// A device unplugged between a client reading the list and choosing from it. The check has to
// be against what the player lists now, and a list held from an earlier request is stale.
TEST_CASE("a device the player listed a moment ago and lists no longer is a 409") {
    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    REQUIRE(outputsOf(server)["devices"].size() == 3);
    outputs.devices.pop_back();

    checkRefusedSaying(post(server, kActive, switchTo(kDisplay)), 409, kNotListed);
    CHECK(outputs.switched.empty());

    outputs.devices.push_back({kUnissued, "Speakers (A Fictional Dock)"});

    checkSwitched(post(server, kActive, switchTo(kUnissued)));
    CHECK(outputs.switched == std::vector<std::string>{kUnissued});
}

TEST_CASE(
    "a switch whose body is not an object naming a deviceId string is a 400 and reaches "
    "nothing") {
    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    const std::array<const char*, 12> malformed{
        {"", "{", "[]", "null", "42", R"("x")", "{}", R"({"id": "x"})", R"({"deviceId": 7})",
         R"({"deviceId": null})", R"({"deviceId": ["x"]})", R"({"deviceId": {"id": "x"}})"}};

    for (const char* body : malformed) {
        INFO("POST ", kActive, " ", body);
        const auto response = post(server, kActive, body);
        REQUIRE(response);
        CHECK(response->status == 400);
        CHECK_FALSE(errorOf(*response).empty());
    }

    CHECK(outputs.lists == 0);
    CHECK(outputs.switched.empty());
}

// The contract gives the body additionalProperties: false. An output type in particular is
// what a client might add, and foobar2000 picks the module and the endpoint as one line.
TEST_CASE("a switch carrying a field the route does not publish is a 400, a listed id beside it") {
    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    for (const auto& body : {json{{"deviceId", kSpeakers}, {"type", "wasapi"}},
                             json{{"deviceId", kSpeakers}, {"name", "Speakers (Fictional Audio)"}},
                             json{{"deviceId", kSpeakers}, {"deviceID", kSpeakers}}}) {
        INFO("POST ", kActive, " ", body.dump());
        const auto response = post(server, kActive, body.dump());
        REQUIRE(response);
        CHECK(response->status == 400);
    }

    CHECK(outputs.lists == 0);
    CHECK(outputs.switched.empty());
}

TEST_CASE(
    "with changeOutput off, a switch is a 403 naming the key and the file, and reaches "
    "nothing") {
    Outputs outputs;
    const TestServer server(parseSettings(R"({"changeOutput": false})"), switching(&outputs));

    checkRefusedSaying(post(server, kActive, switchTo(kSpeakers)), 403, kChangeDisabled);

    CHECK(outputs.switched.empty());
    CHECK(outputs.lists == 0);
}

// Refuse before doing: a client learns nothing about a request the switch was always going to
// refuse, so neither a malformed body nor a missing seam may answer first.
TEST_CASE(
    "with changeOutput off, a malformed switch and a switch to a player with no seams are "
    "both 403") {
    SUBCASE("a body that would be a 400") {
        Outputs outputs;
        const TestServer server(parseSettings(R"({"changeOutput": false})"), switching(&outputs));

        for (const char* body : {"{", R"({"deviceId": 7})", R"({"deviceId": "x", "type": 1})"}) {
            INFO("POST ", kActive, " ", body);
            checkRefusedSaying(post(server, kActive, body), 403, kChangeDisabled);
        }

        CHECK(outputs.lists == 0);
        CHECK(outputs.switched.empty());
    }

    SUBCASE("an id the player does not list, which would be a 409") {
        Outputs outputs;
        const TestServer server(parseSettings(R"({"changeOutput": false})"), switching(&outputs));

        checkRefusedSaying(post(server, kActive, switchTo(kUnissued)), 403, kChangeDisabled);
        CHECK(outputs.lists == 0);
    }

    SUBCASE("a player with neither seam, which would be a 503") {
        const TestServer server(parseSettings(R"({"changeOutput": false})"), Player{});

        checkRefusedSaying(post(server, kActive, switchTo(kSpeakers)), 403, kChangeDisabled);
    }
}

// changeOutput permits changing the device, and reading the list changes nothing.
TEST_CASE("with changeOutput off, GET /api/outputs still answers the list") {
    Outputs outputs;
    const TestServer server(parseSettings(R"({"changeOutput": false})"), switching(&outputs));

    const auto body = outputsOf(server);

    CHECK(body["devices"].size() == 3);
    CHECK(body["active"] == kHeadphones);
}

TEST_CASE(
    "with controlPlayback off and changeOutput on, both routes answer as they otherwise "
    "would") {
    Outputs outputs;
    const TestServer server(parseSettings(R"({"controlPlayback": false, "changeOutput": true})"),
                            switching(&outputs));

    CHECK(outputsOf(server)["devices"].size() == 3);
    checkSwitched(post(server, kActive, switchTo(kSpeakers)));

    CHECK(outputs.switched == std::vector<std::string>{kSpeakers});
}

TEST_CASE(
    "a reload turning changeOutput off refuses the next switch, and turning it back on "
    "allows one") {
    Outputs outputs;
    TestServer server(servingSettings(), switching(&outputs));

    checkSwitched(post(server, kActive, switchTo(kSpeakers)));
    REQUIRE(outputs.switched.size() == 1);

    server.reload(R"({"changeOutput": false})");

    checkRefusedSaying(post(server, kActive, switchTo(kDisplay)), 403, kChangeDisabled);
    CHECK(outputs.switched.size() == 1);

    server.reload("{}");

    checkSwitched(post(server, kActive, switchTo(kDisplay)));
    CHECK(outputs.switched == std::vector<std::string>{kSpeakers, kDisplay});
}

// A null seam is how src/fb2k/ says the player has no output manager to ask.
TEST_CASE("a player with neither output seam answers 503 on both routes") {
    const TestServer server(servingSettings(), Player{});

    const auto listed = get(server, kOutputs);
    REQUIRE(listed);
    CHECK(listed->status == 503);
    CHECK(errorOf(*listed) == kOutputsUnavailable);

    const auto switched = post(server, kActive, switchTo(kSpeakers));
    REQUIRE(switched);
    CHECK(switched->status == 503);
    CHECK(errorOf(*switched) == kOutputsUnavailable);
}

TEST_CASE("a switch to a player missing either output seam is a 503, and reaches the other") {
    SUBCASE("a lister and no setter") {
        Outputs outputs;
        Player player = switching(&outputs);
        player.outputs.setActive = nullptr;
        const TestServer server(servingSettings(), player);

        const auto response = post(server, kActive, switchTo(kSpeakers));
        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(errorOf(*response) == kOutputsUnavailable);
    }

    SUBCASE("a setter and no lister") {
        Outputs outputs;
        Player player = switching(&outputs);
        player.outputs.list = nullptr;
        const TestServer server(servingSettings(), player);

        const auto response = post(server, kActive, switchTo(kSpeakers));
        REQUIRE(response);
        CHECK(response->status == 503);
        CHECK(errorOf(*response) == kOutputsUnavailable);
        CHECK(outputs.switched.empty());
    }
}

TEST_CASE(
    "a player that could not answer, or did not in time, is a 500 or a 504 on either "
    "route") {
    for (const auto outcome : {PlayerOutcome::playerRefused, PlayerOutcome::timedOut}) {
        const int status = httpStatusFor(outcome);
        const std::string sentence = describe(outcome);
        INFO(sentence);

        Outputs listing;
        listing.listAnswer = outcome;
        const TestServer unlisted(servingSettings(), switching(&listing));

        checkRefusedSaying(get(unlisted, kOutputs), status, sentence);
        checkRefusedSaying(post(unlisted, kActive, switchTo(kSpeakers)), status, sentence);
        CHECK(listing.switched.empty());

        Outputs setting;
        setting.setAnswer = outcome;
        const TestServer unset(servingSettings(), switching(&setting));

        checkRefusedSaying(post(unset, kActive, switchTo(kSpeakers)), status, sentence);
        CHECK(setting.switched == std::vector<std::string>{kSpeakers});
    }
}

// The 415 is the admission filter's and comes ahead of anything the route decides.
TEST_CASE("a switch sent as text/plain is a 415 whether changeOutput is on or off") {
    for (const char* settings : {"{}", R"({"changeOutput": false})"}) {
        INFO("config.json ", settings);
        Outputs outputs;
        const TestServer server(parseSettings(settings), switching(&outputs));

        const auto response = server.client().Post(kActive, switchTo(kSpeakers), "text/plain");

        REQUIRE(response);
        CHECK(response->status == 415);
        CHECK(outputs.switched.empty());
    }
}

// changingTooFast() exists for playlist edits that rebuild a snapshot, and a switch is a
// deliberate act. A run shorter than the playlist burst would pass with that limit applied here.
TEST_CASE("a run of switches past the playlist burst is answered every time, none told to wait") {
    constexpr size_t kSwitches = 40;

    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs));

    size_t answered = 0;
    size_t toldToWait = 0;
    for (size_t press = 0; press < kSwitches; ++press) {
        const auto response =
            post(server, kActive, switchTo(press % 2 == 0 ? kSpeakers : kHeadphones));
        REQUIRE(response);

        answered += response->status == 204 ? 1 : 0;
        toldToWait += response->has_header("Retry-After") ? 1 : 0;
    }

    CHECK(answered == kSwitches);
    CHECK(toldToWait == 0);
    CHECK(outputs.switched.size() == kSwitches);
}

// What sits behind the address changes without the address changing: a device plugged in at
// the player, a switch made there. A browser holding any of these answers would show a list
// or a refusal that is no longer true.
TEST_CASE("every answer either route gives asks again each time and carries no validator") {
    SUBCASE("the list, a 200") {
        Outputs outputs;
        const TestServer server(servingSettings(), switching(&outputs));

        checkAsksEveryTime(get(server, kOutputs));
    }

    SUBCASE("the list asked for with a wildcard validator is still a 200") {
        Outputs outputs;
        const TestServer server(servingSettings(), switching(&outputs));

        const auto response =
            server.client().Get(kOutputs, httplib::Headers{{"If-None-Match", "*"}});
        REQUIRE(response);
        CHECK(response->status == 200);
        checkAsksEveryTime(response);
    }

    SUBCASE("a switch, a 204") {
        Outputs outputs;
        const TestServer server(servingSettings(), switching(&outputs));

        checkAsksEveryTime(post(server, kActive, switchTo(kSpeakers)));
    }

    SUBCASE("a malformed switch, a 400") {
        Outputs outputs;
        const TestServer server(servingSettings(), switching(&outputs));

        checkAsksEveryTime(post(server, kActive, "{"));
    }

    SUBCASE("a switch refused by changeOutput, a 403") {
        Outputs outputs;
        const TestServer server(parseSettings(R"({"changeOutput": false})"), switching(&outputs));

        checkAsksEveryTime(post(server, kActive, switchTo(kSpeakers)));
    }

    SUBCASE("a switch to a device the player does not list, a 409") {
        Outputs outputs;
        const TestServer server(servingSettings(), switching(&outputs));

        checkAsksEveryTime(post(server, kActive, switchTo(kUnissued)));
    }

    SUBCASE("a switch the player did not finish in time, a 504") {
        Outputs outputs;
        outputs.setAnswer = PlayerOutcome::timedOut;
        const TestServer server(servingSettings(), switching(&outputs));

        checkAsksEveryTime(post(server, kActive, switchTo(kSpeakers)));
    }

    SUBCASE("either route with no seam, a 503") {
        const TestServer server(servingSettings(), Player{});

        checkAsksEveryTime(get(server, kOutputs));
        checkAsksEveryTime(post(server, kActive, switchTo(kSpeakers)));
    }
}

// foobar2000 reports a switch back through its own output callback, and that is what moves
// the poll. A route that also wrote the field would publish a device the player may not have
// taken, and would do it ahead of the callback that says whether it did.
TEST_CASE("a switch leaves GET /api/state's outputDeviceId where the player last reported it") {
    PlayerStateStore store;
    PlayerState reported;
    reported.outputDeviceId = kHeadphones;
    store.publish(reported);

    Outputs outputs;
    const TestServer server(servingSettings(), switching(&outputs), nullptr, countingMint(),
                            &store);

    const auto before = get(server, "/api/state");
    REQUIRE(before);
    REQUIRE(before->status == 200);
    const auto tag = before->get_header_value("ETag");
    REQUIRE_FALSE(tag.empty());

    checkSwitched(post(server, kActive, switchTo(kSpeakers)));
    REQUIRE(outputs.switched == std::vector<std::string>{kSpeakers});

    const auto after = server.client().Get("/api/state", httplib::Headers{{"If-None-Match", tag}});
    REQUIRE(after);
    CHECK(after->status == 304);
    CHECK(store.read().state.outputDeviceId == kHeadphones);
}

TEST_CASE("an output refusal says what the contract publishes, under the status it publishes") {
    CHECK(describe(PlayerOutcome::changeDisabled) == std::string(kChangeDisabled));
    CHECK(describe(PlayerOutcome::notListed) == std::string(kNotListed));

    CHECK(httpStatusFor(PlayerOutcome::changeDisabled) == 403);
    CHECK(httpStatusFor(PlayerOutcome::notListed) == 409);
}
