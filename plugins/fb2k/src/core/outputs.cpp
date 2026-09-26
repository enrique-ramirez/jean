#include "core/outputs.h"

#include "core/api.h"
#include "core/playlists.h"

namespace jean {

std::string describe(OutputOutcome outcome) {
    switch (outcome) {
        case OutputOutcome::done:
            return "done";
        case OutputOutcome::changeDisabled:
            return "this install has output device changes turned off; turn on changeOutput in "
                   "config.json to allow them";
        case OutputOutcome::notListed:
            return "the player does not list that output device; read the outputs again";
        case OutputOutcome::playerRefused:
            return describe(PlaylistOutcome::playerRefused);
        case OutputOutcome::timedOut:
            return describe(PlaylistOutcome::timedOut);
    }
    return "unknown";
}

int httpStatusFor(OutputOutcome outcome) {
    switch (outcome) {
        case OutputOutcome::done:
            return 200;
        case OutputOutcome::changeDisabled:
            return 403;
        case OutputOutcome::notListed:
            return 409;
        case OutputOutcome::playerRefused:
            return httpStatusFor(PlaylistOutcome::playerRefused);
        case OutputOutcome::timedOut:
            return httpStatusFor(PlaylistOutcome::timedOut);
    }
    return 500;
}

}  // namespace jean
