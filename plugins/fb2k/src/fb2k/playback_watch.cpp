#include "fb2k/PCH.h"

#include "fb2k/playback_watch.h"

#include "core/output_hold.h"
#include "core/playback_modes.h"
#include "fb2k/strings.h"

#include <chrono>
#include <utility>

namespace jean {

namespace {

std::string displayPathOf(const metadb_handle_ptr& track) {
    if (!track.is_valid())
        return {};

    try {
        pfc::string8 display;
        filesystem::g_get_display_path(track->get_path(), display);
        return toStd(display);
    } catch (const std::exception&) {
        return track->get_path();
    }
}

PlayingTrack trackOf(const metadb_handle_ptr& track) {
    PlayingTrack playing;
    playing.path = displayPathOf(track);

    if (track.is_valid()) {
        playing.subsong = track->get_subsong_index();
        playing.duration = playback_control::get()->playback_get_length();
    }

    return playing;
}

// `output_hold`'s mute and the player's own look identical to foobar2000, since it has no
// mute flag of its own: `is_muted()` is `get_volume() == volume_mute`. So a volume this low is
// only the *user's* mute when the hold is not the one holding it.
bool userMuted(float volume, const OutputHold& outputHold) {
    return volume <= playback_control::volume_mute && !outputHold.held();
}

std::optional<std::string> activePlaybackModeOf() {
    const auto playlists = playlist_manager::get();
    const auto name = playlists->playback_order_get_name(playlists->playback_order_get_active());
    return jeanModeFor(std::string(name));
}

// foobar2000's volume is dB against full scale, so a store left at its default reports the
// fader at maximum until the next change. Seeding from the player at construction covers
// whatever was already true before the first callback, and the playback order the same way: no
// callback fires for it until it next changes.
PlayerState initialStateOf(const OutputHold& outputHold, std::chrono::steady_clock::time_point now) {
    const auto playback = playback_control::get();

    PlayerState state;
    state.volume = playback->get_volume();
    state.muted = userMuted(state.volume, outputHold);
    state.playbackMode = activePlaybackModeOf();

    metadb_handle_ptr track;
    if (playback->get_now_playing(track)) {
        state.path = displayPathOf(track);
        state.subsong = track->get_subsong_index();
        state.duration = playback->playback_get_length();
        state.position = {playback->playback_get_position(), now};
    }

    if (playback->is_paused())
        state.playback = PlaybackState::paused;
    else if (playback->is_playing())
        state.playback = PlaybackState::playing;

    return state;
}

}  // namespace

struct PlaybackWatch::Callback : public play_callback_impl_base {
    Callback(PlayerStateStore& store, OutputHold& outputHold)
        : play_callback_impl_base(flag_on_playback_new_track | flag_on_playback_pause |
                                   flag_on_playback_stop | flag_on_playback_seek |
                                   flag_on_playback_dynamic_info | flag_on_volume_change),
          store_(store), outputHold_(outputHold) {}

    void on_playback_new_track(metadb_handle_ptr track) override {
        store_.started(trackOf(track), std::chrono::steady_clock::now());
    }

    // foobar2000 raises stop_reason_starting_another as the outgoing track of a change
    // rather than a stop, and clearing the trackbar for it would flash the status bar blank
    // between every pair of tracks.
    void on_playback_stop(play_control::t_stop_reason reason) override {
        if (reason == playback_control::stop_reason_starting_another)
            return;

        store_.stopped();
    }

    void on_playback_seek(double time) override {
        store_.seeked(time, std::chrono::steady_clock::now());
    }

    void on_playback_pause(bool state) override {
        const auto now = std::chrono::steady_clock::now();
        if (state)
            store_.paused(now);
        else
            store_.resumed(now);
    }

    void on_playback_dynamic_info(const file_info& info) override {
        store_.durationChanged(info.get_length());
    }

    void on_volume_change(float value) override {
        store_.volumeChanged(value, userMuted(value, outputHold_));
    }

    PlayerStateStore& store_;
    OutputHold& outputHold_;
};

// foobar2000 keeps the playback order on playlist_manager rather than on playback_control, so
// it needs a registration of its own.
struct PlaybackWatch::OrderCallback : public playlist_callback_impl_base {
    explicit OrderCallback(PlayerStateStore& store)
        : playlist_callback_impl_base(flag_on_playback_order_changed), store_(store) {}

    void on_playback_order_changed(t_size newIndex) override {
        const auto name = playlist_manager::get()->playback_order_get_name(newIndex);
        store_.playbackModeChanged(jeanModeFor(std::string(name)));
    }

    PlayerStateStore& store_;
};

PlaybackWatch::PlaybackWatch(PlayerStateStore& store, OutputHold& outputHold)
    : callback_(std::make_unique<Callback>(store, outputHold)),
      orderCallback_(std::make_unique<OrderCallback>(store)) {
    store.publish(initialStateOf(outputHold, std::chrono::steady_clock::now()));
}

PlaybackWatch::~PlaybackWatch() = default;

}  // namespace jean
