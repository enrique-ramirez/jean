#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

// Jean's own names for a playback order, and the map to and from whatever foobar2000 calls its
// own. foobar2000's own order names are extensible -- a component can register one of its own --
// so the map is a lookup rather than an enum, and a name on neither side is absent rather than
// guessed at.
namespace jean {

std::optional<std::string> jeanModeFor(const std::string& playerOrder);
std::optional<std::string> playerOrderFor(const std::string& jeanMode);

enum class PlaybackModeResolution { ok, unknownMode, notOffered };

struct PlaybackModeIndex {
    PlaybackModeResolution resolution = PlaybackModeResolution::unknownMode;
    size_t index = 0;
};

PlaybackModeIndex resolvePlaybackMode(const std::string& jeanMode,
                                      const std::vector<std::string>& playbackOrders);

}  // namespace jean
