#pragma once

#include "core/audience.h"

#include <atomic>
#include <functional>
#include <mutex>
#include <optional>
#include <thread>

namespace jean {

// See CLAUDE.md, *Facts about the player*, for why muting here is safe and what foobar2000's
// mute button actually does.
class OutputHold {
public:
    using Clock = Audience::Clock;

    // Every callback runs on this object's own thread, so one that has to reach the player's
    // main thread blocks there.
    struct Player {
        std::function<bool()> isMuted;
        std::function<void(bool)> setMuted;
        std::function<std::optional<float>()> volume;
        std::function<void(float)> setVolume;
    };

    OutputHold(Audience& audience, Player player, bool enabled);

    ~OutputHold();

    bool enabled() const { return thread_.joinable(); }

    bool held() const { return held_; }

    // Callable from the player's own volume callback, including the one this object's own
    // write sets off: it takes no lock and never calls back into the player, because that
    // callback runs on the main thread and a lock held across it would deadlock the mute
    // this object just made.
    void playerVolumeChanged(bool muted);

    void release();

    OutputHold(const OutputHold&) = delete;
    OutputHold& operator=(const OutputHold&) = delete;

private:
    void watch();
    void apply(bool listening);

    Audience& audience_;
    const Player player_;

    std::atomic<bool> held_{false};
    std::atomic<bool> released_{false};

    std::optional<float> levelBefore_;

    std::mutex deciding_;

    std::thread thread_;
};

}  // namespace jean
