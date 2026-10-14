#include "fb2k/PCH.h"

#include "fb2k/playback_commands.h"

#include "core/ask_player.h"
#include "core/playlists.h"
#include "fb2k/playback_watch.h"
#include "fb2k/playlists.h"

#include <cstdint>
#include <string>
#include <utility>

namespace jean {

namespace {

PlayerOutcome askCommand(MainThreadQueue& mainThread, const std::string& what,
                         std::function<void()> command) {
    return askForOutcome<PlayerOutcome>(mainThread, what, [command = std::move(command)] {
        command();
        return PlayerOutcome::done;
    });
}

// The foobar2000 SDK's playlist_lock names filter_default_action as a lock doing something else in
// place of playing the row.
bool lockTakesDefaultAction(const playlist_manager::ptr& manager, t_size playlist) {
    return (manager->playlist_lock_get_filter_mask(playlist) &
            playlist_lock::filter_default_action) != 0;
}

// The foobar2000 SDK does not say what playlist_execute_default_action's bool means when a
// playlist lock takes the action over, so it is not read, and the playlist and row are checked
// beforehand instead. Why the playlist is activated first is ARCHITECTURE.md, *Facts about the
// player*.
//
// foobar2000 announces the activation at once and the playing location only once the track has
// opened, so the row is published first, where a poll between the two would otherwise see the
// new playlist with no row playing in it.
PlayerOutcome playRowOnMainThread(PlayerStateStore& store, PlaylistVersions& versions,
                                  const std::string& playlistId, uint32_t index) {
    const auto playlist = findPlaylist(playlistId);
    if (playlist == pfc::infinite_size)
        return PlayerOutcome::noSuchPlaylist;

    const auto manager = playlist_manager::get();
    if (index >= manager->playlist_get_item_count(playlist))
        return PlayerOutcome::positionPastEnd;

    if (!lockTakesDefaultAction(manager, playlist))
        publishLocation(store, versions, PlayingLocation{playlistId, index});

    manager->set_active_playlist(playlist);
    manager->playlist_execute_default_action(playlist, index);
    return PlayerOutcome::done;
}

}  // namespace

PlaylistRowPlayer makePlaylistRowPlayer(MainThreadQueue& mainThread, PlayerStateStore& store,
                                        PlaylistVersions& versions) {
    return [&mainThread, &store, &versions](const std::string& playlistId, uint32_t index) {
        return askForOutcome<PlayerOutcome>(
            mainThread, "playing a playlist row", [&store, &versions, playlistId, index] {
                return playRowOnMainThread(store, versions, playlistId, index);
            });
    };
}

TransportCommander makeTransportCommander(MainThreadQueue& mainThread) {
    return [&mainThread](Transport command) {
        switch (command) {
            case Transport::playPause:
                return askCommand(mainThread, "toggling play/pause",
                                  [] { playback_control::get()->play_or_pause(); });
            case Transport::pause:
                return askCommand(mainThread, "pausing playback",
                                  [] { playback_control::get()->pause(true); });
            case Transport::resume:
                return askCommand(mainThread, "resuming playback",
                                  [] { playback_control::get()->play_or_unpause(); });
            case Transport::next:
                return askCommand(mainThread, "advancing to the next track",
                                  [] { playback_control::get()->next(); });
            case Transport::previous:
                return askCommand(mainThread, "moving to the previous track",
                                  [] { playback_control::get()->previous(); });
            case Transport::stop:
                return askCommand(mainThread, "stopping playback",
                                  [] { playback_control::get()->stop(); });
        }
        return PlayerOutcome::playerRefused;
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
                          step == VolumeStep::up ? "stepping the player's level up"
                                                 : "stepping the player's level down",
                          [step] {
                              const auto playback = playback_control::get();
                              if (step == VolumeStep::up)
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
