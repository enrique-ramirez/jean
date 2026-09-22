#include "support/fixtures.h"

#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace jean::testing {

std::string ratingWrite(const std::string& track, std::optional<uint32_t> subsong) {
    const auto within = subsong ? R"(, "subsong": )" + std::to_string(*subsong) : std::string();

    return R"({"track": ")" + track + R"(")" + within + R"(, "fields": {"rating": ")" + kRating +
           R"("}})";
}

std::string ratingWriteAtRow(const std::string& playlist, uint32_t index, uint64_t structure) {
    return R"({"playlist": ")" + playlist + R"(", "index": )" + std::to_string(index) +
           R"(, "structure": ")" + std::to_string(structure) + R"(", "fields": {"rating": ")" +
           kRating + R"("}})";
}

Settings servingSettings() {
    Settings settings;
    settings.authToken = kToken;
    return settings;
}

Settings servingSettingsAllowing(std::vector<std::string> fields) {
    Settings settings = servingSettings();
    settings.allowedFields = std::move(fields);
    return settings;
}

Player servingPlayer() {
    Player player;
    player.playerName = "foobar2000";
    player.playerVersion = "2.25.3";
    player.volumeMin = -100;
    player.volumeMax = 0;
    player.volumeUnit = "db";
    return player;
}

ListenerStatus listeningStatus() {
    ListenerStatus status;
    status.listening = true;
    return status;
}

TicketMint countingMint() {
    const auto issued = std::make_shared<int>(0);
    return [issued] { return "ticket-" + std::to_string(++*issued); };
}

}  // namespace jean::testing
