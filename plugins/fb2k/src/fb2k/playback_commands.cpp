#include "fb2k/PCH.h"

#include "fb2k/playback_commands.h"

#include "fb2k/ask_player.h"

namespace jean {

TransportCommander makeTransportCommander(MainThreadQueue& mainThread) {
    return [&mainThread](Transport command) {
        switch (command) {
            case Transport::PlayPause:
                tellPlayer(mainThread, "toggling play/pause",
                          [] { playback_control::get()->play_or_pause(); });
                return;
            case Transport::Next:
                tellPlayer(mainThread, "advancing to the next track",
                          [] { playback_control::get()->next(); });
                return;
            case Transport::Previous:
                tellPlayer(mainThread, "moving to the previous track",
                          [] { playback_control::get()->previous(); });
                return;
            case Transport::Stop:
                tellPlayer(mainThread, "stopping playback",
                          [] { playback_control::get()->stop(); });
                return;
        }
    };
}

PlaybackSeeker makePlaybackSeeker(MainThreadQueue& mainThread) {
    return [&mainThread](double seconds, bool relative) {
        tellPlayer(mainThread, "seeking", [seconds, relative] {
            const auto playback = playback_control::get();
            if (relative)
                playback->playback_seek_delta(seconds);
            else
                playback->playback_seek(seconds);
        });
    };
}

PlaybackOrderSetter makePlaybackOrderSetter(MainThreadQueue& mainThread) {
    return [&mainThread](size_t index) {
        tellPlayer(mainThread, "setting the playback order",
                  [index] { playlist_manager::get()->playback_order_set_active(index); });
    };
}

VolumeSetter makeVolumeSetter(MainThreadQueue& mainThread) {
    return [&mainThread](double level) {
        tellPlayer(mainThread, "setting the player's level", [level] {
            playback_control::get()->set_volume(static_cast<float>(level));
        });
    };
}

VolumeStepper makeVolumeStepper(MainThreadQueue& mainThread) {
    return [&mainThread](VolumeStep step) {
        tellPlayer(mainThread,
                  step == VolumeStep::Up ? "stepping the player's level up"
                                        : "stepping the player's level down",
                  [step] {
                      const auto playback = playback_control::get();
                      if (step == VolumeStep::Up)
                          playback->volume_up();
                      else
                          playback->volume_down();
                  });
    };
}

MuteSetter makeMuteSetter(MainThreadQueue& mainThread) {
    return [&mainThread](bool muted) {
        tellPlayer(mainThread, muted ? "muting the player" : "unmuting the player", [muted] {
            const auto playback = playback_control::get();
            if (playback->is_muted() != muted)
                playback->volume_mute_toggle();
        });
    };
}

}  // namespace jean
