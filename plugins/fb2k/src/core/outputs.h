#pragma once

#include "core/player_outcome.h"

#include <optional>
#include <string>
#include <vector>

// An output device and what listing them answers. fb2k/player_outputs.h talks to
// output_manager_v2.
namespace jean {

struct OutputDevice {
    std::string id;
    std::string name;
};

// What GET /api/outputs answers: every device the player lists, in its own order, and the id
// of the one active, or nullopt where the player's current pair matches none of them.
struct OutputsRead {
    PlayerOutcome outcome = PlayerOutcome::done;
    std::vector<OutputDevice> devices;
    std::optional<std::string> active;
};

}  // namespace jean
