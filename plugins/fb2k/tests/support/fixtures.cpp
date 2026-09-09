#include "support/fixtures.h"

#include <memory>
#include <utility>

namespace jean::testing {

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
