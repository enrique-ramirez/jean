#include "core/playback_modes.h"

#include <algorithm>
#include <iterator>

namespace jean {

namespace {

struct Mode {
    const char* order;
    const char* mode;
};

constexpr Mode kModes[]{{"Default", "inOrder"},
                        {"Repeat (playlist)", "repeatAll"},
                        {"Repeat (track)", "repeatOne"},
                        {"Random", "random"},
                        {"Shuffle (tracks)", "shuffleTracks"},
                        {"Shuffle (albums)", "shuffleAlbums"},
                        {"Shuffle (folders)", "shuffleFolders"}};

}  // namespace

std::optional<std::string> jeanModeFor(const std::string& playerOrder) {
    const auto* const found =
        std::find_if(std::begin(kModes), std::end(kModes),
                     [&playerOrder](const Mode& mode) { return playerOrder == mode.order; });

    if (found == std::end(kModes))
        return std::nullopt;

    return std::string(found->mode);
}

std::optional<std::string> playerOrderFor(const std::string& jeanMode) {
    const auto* const found =
        std::find_if(std::begin(kModes), std::end(kModes),
                     [&jeanMode](const Mode& mode) { return jeanMode == mode.mode; });

    if (found == std::end(kModes))
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
