#pragma once

#include <optional>
#include <string>
#include <vector>

// An output device and what listing or switching one may answer. Pure: a request is understood
// and refused here, and fb2k/player_outputs.h talks to output_manager_v2.
namespace jean {

struct OutputDevice {
    std::string id;
    std::string name;
};

enum class OutputOutcome {
    done,
    changeDisabled,
    notListed,
    playerRefused,
    timedOut,
};

// What GET /api/outputs answers: every device the player lists, in its own order, and the id
// of the one active, or nullopt where the player's current pair matches none of them.
struct OutputsRead {
    OutputOutcome outcome = OutputOutcome::done;
    std::vector<OutputDevice> devices;
    std::optional<std::string> active;
};

std::string describe(OutputOutcome outcome);
int httpStatusFor(OutputOutcome outcome);

}  // namespace jean
