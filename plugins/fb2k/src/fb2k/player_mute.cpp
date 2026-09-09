#include "fb2k/PCH.h"

#include "fb2k/player_mute.h"

#include "fb2k/ask_player.h"

#include <optional>

namespace jean {

OutputHold::Player playerMuteVia(MainThreadQueue& mainThread) {
    OutputHold::Player player;

    player.isMuted = [&mainThread] {
        return askPlayer<bool>(
            mainThread, "reading the player's volume",
            [](const AnswerPtr<bool>& answer) { answer->set(playback_control::get()->is_muted()); },
            false, false);
    };

    player.volume = [&mainThread]() -> std::optional<float> {
        return askPlayer<std::optional<float>>(
            mainThread, "reading the player's level",
            [](const AnswerPtr<std::optional<float>>& answer) {
                answer->set(playback_control::get()->get_volume());
            },
            std::nullopt, std::nullopt);
    };

    player.setVolume = [&mainThread](float level) {
        tellPlayer(mainThread, "setting the player's level",
                   [level] { playback_control::get()->set_volume(level); });
    };

    player.setMuted = [&mainThread](bool muted) {
        tellPlayer(mainThread, muted ? "muting the player" : "unmuting the player", [muted] {
            const auto playback = playback_control::get();
            if (playback->is_muted() != muted)
                playback->volume_mute_toggle();
        });
    };

    return player;
}

struct PlayerVolumeWatch::Callback : public play_callback_impl_base {
    explicit Callback(OutputHold& hold)
        : play_callback_impl_base(flag_on_volume_change), hold(hold) {}

    void on_volume_change(float value) override {
        hold.playerVolumeChanged(value <= playback_control::volume_mute);
    }

    OutputHold& hold;
};

PlayerVolumeWatch::PlayerVolumeWatch(OutputHold& hold)
    : callback_(std::make_unique<Callback>(hold)) {}

PlayerVolumeWatch::~PlayerVolumeWatch() = default;

}  // namespace jean
