#include "fb2k/PCH.h"

#include "fb2k/playback_commands.h"

#include "fb2k/ask_player.h"

namespace jean {

namespace {

PlaylistOutcome askCommand(MainThreadQueue& mainThread, const std::string& what,
                           std::function<void()> work) {
    return askPlayer<PlaylistOutcome>(
        mainThread, what,
        [work](const AnswerPtr<PlaylistOutcome>& answer) {
            work();
            answer->set(PlaylistOutcome::done);
        },
        PlaylistOutcome::timedOut, PlaylistOutcome::playerRefused);
}

}  // namespace

TransportCommander makeTransportCommander(MainThreadQueue& mainThread) {
    return [&mainThread](Transport command) {
        switch (command) {
            case Transport::PlayPause:
                return askCommand(mainThread, "toggling play/pause",
                                  [] { playback_control::get()->play_or_pause(); });
            case Transport::Next:
                return askCommand(mainThread, "advancing to the next track",
                                  [] { playback_control::get()->next(); });
            case Transport::Previous:
                return askCommand(mainThread, "moving to the previous track",
                                  [] { playback_control::get()->previous(); });
            case Transport::Stop:
                return askCommand(mainThread, "stopping playback",
                                  [] { playback_control::get()->stop(); });
        }
        return PlaylistOutcome::playerRefused;
    };
}

PlaybackSeeker makePlaybackSeeker(MainThreadQueue& mainThread) {
    return [&mainThread](double seconds, bool relative) {
        return askCommand(mainThread, "seeking", [seconds, relative] {
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
        return askCommand(mainThread, "setting the playback order",
                          [index] { playlist_manager::get()->playback_order_set_active(index); });
    };
}

VolumeSetter makeVolumeSetter(MainThreadQueue& mainThread) {
    return [&mainThread](double level) {
        return askCommand(mainThread, "setting the player's level", [level] {
            playback_control::get()->set_volume(static_cast<float>(level));
        });
    };
}

VolumeStepper makeVolumeStepper(MainThreadQueue& mainThread) {
    return [&mainThread](VolumeStep step) {
        return askCommand(mainThread,
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
        return askCommand(mainThread, muted ? "muting the player" : "unmuting the player", [muted] {
            const auto playback = playback_control::get();
            if (playback->is_muted() != muted)
                playback->volume_mute_toggle();
        });
    };
}

}  // namespace jean
