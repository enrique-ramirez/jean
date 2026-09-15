// The playback-mode vocabulary: the name a client is handed for the order the player is in, and
// the way back from that name to the order it stands for. tests/state_route_test.cpp covers the
// rest of the polled document; what this adds is that no part of foobar2000's own naming reaches
// a client, and that an order with no Jean name is reported as nothing rather than as a guess.

#include "third_party/doctest.h"

#include "core/api.h"
#include "core/library.h"
#include "core/playback_modes.h"
#include "core/player_state.h"
#include "third_party/json.hpp"

#include <array>
#include <chrono>
#include <optional>
#include <string>

using namespace jean;
using namespace std::chrono;
using nlohmann::json;

namespace {

struct StockOrder {
    const char* order;
    const char* mode;
};

// The seven playback orders a stock foobar2000 2.25.3 reports through playlist_manager, beside
// the name Jean knows each one by. That list is extensible: a component can register an order of
// its own, so a string missing from this table is a case the map has to meet rather than a defect.
constexpr std::array<StockOrder, 7> kStock{{{"Default", "inOrder"},
                                            {"Repeat (playlist)", "repeatAll"},
                                            {"Repeat (track)", "repeatOne"},
                                            {"Random", "random"},
                                            {"Shuffle (tracks)", "shuffleTracks"},
                                            {"Shuffle (albums)", "shuffleAlbums"},
                                            {"Shuffle (folders)", "shuffleFolders"}}};

// No stock foobar2000 has this order, and it is shaped like one a component would plausibly add.
constexpr char kAddedByAComponent[] = "Shuffle (artists)";

constexpr char kNoJeanName[] = "<no Jean name>";
constexpr char kNoPlayerOrder[] = "<no player order>";

std::string documentFor(const std::optional<std::string>& mode) {
    PlayerState player;
    player.playbackMode = mode;
    return stateDocument(Library::State{}, player, steady_clock::now());
}

}  // namespace

TEST_CASE("every playback order a stock foobar2000 has crosses to a client as a Jean name") {
    for (const auto& stock : kStock) {
        const std::string order(stock.order);
        const std::string mode(stock.mode);
        CAPTURE(order);
        CHECK(jeanModeFor(order).value_or(kNoJeanName) == mode);
    }
}

TEST_CASE("a Jean name maps back to the order string the player answered, so a mode stays settable") {
    for (const auto& stock : kStock) {
        const std::string order(stock.order);
        const std::string mode(stock.mode);
        CAPTURE(mode);
        CHECK(playerOrderFor(mode).value_or(kNoPlayerOrder) == order);
    }
}

// The price the criterion names. Mapping an unknown order to the nearest stock one would tell a
// client the player is doing something it is not, which is worse than telling it nothing.
TEST_CASE("an order this component has no name for is absent rather than mapped to the nearest one") {
    CHECK_FALSE(jeanModeFor(kAddedByAComponent).has_value());
    CHECK_FALSE(jeanModeFor("").has_value());
    CHECK_FALSE(playerOrderFor("shuffleArtists").has_value());
    CHECK_FALSE(playerOrderFor("").has_value());
}

// Both vocabularies are fixed text rather than anything a person typed, so the match is exact. A
// loose one would let an order some component added collide with a stock name and be reported as
// that stock order.
TEST_CASE("an order name is matched exactly, so a near miss is unknown rather than guessed at") {
    CHECK_FALSE(jeanModeFor("default").has_value());
    CHECK_FALSE(jeanModeFor("Repeat (Playlist)").has_value());
    CHECK_FALSE(jeanModeFor("Random ").has_value());
    CHECK_FALSE(playerOrderFor("InOrder").has_value());
    CHECK_FALSE(playerOrderFor("shuffle_albums").has_value());
}

TEST_CASE("the polled document names the mode in Jean's vocabulary and carries no name of foobar2000's") {
    for (const auto& stock : kStock) {
        const std::string order(stock.order);
        const std::string mode(stock.mode);
        CAPTURE(order);

        const auto body = documentFor(jeanModeFor(order));
        const auto published = json::parse(body)["player"]["playbackMode"];

        CHECK(published.is_string());
        CHECK(published.get<std::string>() == mode);
        CHECK(body.find(order) == std::string::npos);
    }
}

// An ordinal is the same leak in another shape: the two players number their orders differently
// and neither numbering means anything to a client.
TEST_CASE("the document carries no ordinal for the mode beside the name") {
    const auto section = json::parse(documentFor(jeanModeFor("Random")))["player"];

    CHECK_FALSE(section.contains("playbackOrder"));
}

TEST_CASE("an order with no Jean name reaches a client as null rather than as a wrong name") {
    const auto section = json::parse(documentFor(jeanModeFor(kAddedByAComponent)))["player"];

    REQUIRE(section.contains("playbackMode"));
    CHECK(section["playbackMode"].is_null());
}
