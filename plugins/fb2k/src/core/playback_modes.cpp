#include "core/playback_modes.h"

#include <algorithm>
#include <array>
#include <iterator>

namespace jean {

namespace {

struct Mode {
    const char* order;
    const char* mode;
};

constexpr std::array<Mode, 7> kModes{{{"Default", "inOrder"},
                                      {"Repeat (playlist)", "repeatAll"},
                                      {"Repeat (track)", "repeatOne"},
                                      {"Random", "random"},
                                      {"Shuffle (tracks)", "shuffleTracks"},
                                      {"Shuffle (albums)", "shuffleAlbums"},
                                      {"Shuffle (folders)", "shuffleFolders"}}};

}  // namespace

std::optional<std::string> jeanModeFor(const std::string& playerOrder) {
    const auto found =
        std::find_if(kModes.begin(), kModes.end(),
                     [&playerOrder](const Mode& mode) { return playerOrder == mode.order; });

    if (found == kModes.end())
        return std::nullopt;

    return std::string(found->mode);
}

std::optional<std::string> playerOrderFor(const std::string& jeanMode) {
    const auto found = std::find_if(kModes.begin(), kModes.end(), [&jeanMode](const Mode& mode) {
        return jeanMode == mode.mode;
    });

    if (found == kModes.end())
        return std::nullopt;

    return std::string(found->order);
}

PlaybackModeIndex resolvePlaybackMode(const std::string& jeanMode,
                                      const std::vector<std::string>& playbackOrders) {
    const auto order = playerOrderFor(jeanMode);
    if (!order)
        return {PlaybackModeResolution::unknownMode, 0};

    const auto found = std::find(playbackOrders.begin(), playbackOrders.end(), *order);
    if (found == playbackOrders.end())
        return {PlaybackModeResolution::notOffered, 0};

    return {PlaybackModeResolution::ok,
           static_cast<size_t>(std::distance(playbackOrders.begin(), found))};
}

}  // namespace jean
