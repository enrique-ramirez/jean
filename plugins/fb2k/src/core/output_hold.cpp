#include "core/output_hold.h"

#include "core/log.h"

#include <exception>
#include <optional>
#include <string>
#include <utility>

namespace jean {

OutputHold::OutputHold(Audience& audience, Player player, bool enabled)
    : audience_(audience), player_(std::move(player)) {
    if (enabled && player_.isMuted && player_.setMuted && player_.volume && player_.setVolume)
        thread_ = std::thread([this] { watch(); });
}

OutputHold::~OutputHold() {
    if (!thread_.joinable())
        return;

    audience_.close();
    thread_.join();

    try {
        apply(Listening::nobody);
    } catch (...) {
        return;
    }
}

void OutputHold::watch() {
    bool applied = false;

    while (audience_.awaitChangeFrom(applied)) {
        applied = audience_.anyListening(Clock::now());
        try {
            apply(applied ? Listening::somebody : Listening::nobody);
        } catch (const std::exception& e) {
            logError(std::string("the mute hold failed: ") + e.what());
        } catch (...) {
            logError("the mute hold failed with an unknown exception");
        }
    }
}

void OutputHold::apply(Listening listening) {
    const std::lock_guard<std::mutex> deciding(deciding_);

    if (listening == Listening::somebody) {
        if (held_ || released_)
            return;

        if (player_.isMuted())
            return;

        levelBefore_ = player_.volume();
        held_ = true;
        try {
            player_.setMuted(true);
        } catch (...) {
            held_ = false;
            throw;
        }
        logInfo("muted the player while somebody is listening to the stream");
        return;
    }

    released_ = false;

    const bool wasHeld = held_.exchange(false);
    const std::optional<float> before = std::exchange(levelBefore_, std::nullopt);

    if (!wasHeld && !before)
        return;

    if (!player_.isMuted())
        return;

    if (wasHeld) {
        player_.setMuted(false);
        logInfo("gave the player its sound back");
        return;
    }

    if (before) {
        player_.setVolume(*before);
        logInfo("put the player's level back where the listening started");
    }
}

void OutputHold::release() {
    if (!audience_.anyListening(Clock::now()))
        return;

    const std::lock_guard<std::mutex> deciding(deciding_);
    released_ = true;

    if (!held_)
        return;

    held_ = false;

    if (player_.isMuted())
        player_.setMuted(false);

    logInfo("gave the player its sound back alongside the stream, as asked");
}

void OutputHold::playerVolumeChanged(bool muted) {
    if (!muted)
        held_ = false;
}

}  // namespace jean
