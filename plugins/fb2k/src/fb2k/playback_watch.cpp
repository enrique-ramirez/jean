#include "fb2k/PCH.h"

#include "fb2k/playback_watch.h"

#include "core/output_hold.h"
#include "core/playback_modes.h"
#include "fb2k/main_thread.h"
#include "fb2k/playlists.h"
#include "fb2k/strings.h"

#include <chrono>
#include <utility>

namespace jean {

namespace {

// The title reads as foobar2000's own filename fallback for a track with no title tag: "If
// 'title' metadata field is missing, file name is used instead."
constexpr char kTitleScript[] = "%title%";

// %artist% checks artist, album artist, composer and performer in that order, and where none
// of the four resolves the title-format engine answers the literal string "?" rather than an
// empty one. Bracketing discards an unresolved field instead of the literal text, so a track
// with none of the four reads as no artist rather than as an artist named "?".
constexpr char kArtistScript[] = "[%artist%]";

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

// `playback_format_title_ex` rather than a plain metadb query is what folds in a station's
// own broadcast update, since that is a currently-playing concept `playback_control` resolves
// rather than something the track's stored tags carry.
void publishName(PlayerStateStore& store, const titleformat_object::ptr& titleScript,
                  const titleformat_object::ptr& artistScript, const metadb_handle_ptr& track) {
    const auto playback = playback_control::get();

    pfc::string8 title;
    playback->playback_format_title_ex(track, nullptr, title, titleScript, nullptr,
                                        playback_control::display_level_titles);

    pfc::string8 artist;
    playback->playback_format_title_ex(track, nullptr, artist, artistScript, nullptr,
                                        playback_control::display_level_titles);

    store.nameChanged(toStd(title), toStd(artist));
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

std::optional<PlayingLocation> currentLocation() {
    t_size playlist = 0;
    t_size index = 0;
    if (!playlist_manager::get()->get_playing_item_location(&playlist, &index))
        return std::nullopt;

    return PlayingLocation{playlistId(playlist), static_cast<uint32_t>(index)};
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
    state.playingLocation = currentLocation();

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
    Callback(MainThreadQueue& mainThread, PlayerStateStore& store, OutputHold& outputHold,
             NowPlayingArtwork& artwork, titleformat_object::ptr titleScript,
             titleformat_object::ptr artistScript)
        : play_callback_impl_base(flag_on_playback_new_track | flag_on_playback_pause |
                                   flag_on_playback_stop | flag_on_playback_seek |
                                   flag_on_playback_dynamic_info |
                                   flag_on_playback_dynamic_info_track | flag_on_volume_change),
          mainThread_(mainThread), store_(store), outputHold_(outputHold), artwork_(artwork),
          titleScript_(std::move(titleScript)), artistScript_(std::move(artistScript)) {}

    // `get_playing_item_location` has not caught up with the new track yet: see
    // ARCHITECTURE.md, *Facts about the player*. `started()` leaves `playingLocation` standing
    // on purpose (see player_state.cpp), so the row from before the change is what a poll reads
    // until `queueLocationRead` corrects it once the player has. Artwork has no such fallback,
    // since nothing corrects a stale cover the way `queueLocationRead` corrects the row, so it
    // clears rather than stand on the outgoing track's picture.
    void on_playback_new_track(metadb_handle_ptr track) override {
        artwork_.clear();
        store_.started(trackOf(track), std::chrono::steady_clock::now());
        publishName(store_, titleScript_, artistScript_, track);
        queueLocationRead();
    }

    // foobar2000 raises stop_reason_starting_another as the outgoing track of a change
    // rather than a stop, and clearing the trackbar for it would flash the status bar blank
    // between every pair of tracks.
    void on_playback_stop(play_control::t_stop_reason reason) override {
        if (reason == playback_control::stop_reason_starting_another)
            return;

        store_.stopped();
        artwork_.clear();
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

    // What an internet radio station announces its current song through: the track does not
    // change, so no metadb query answers the new title. `file_info` carries the update, but
    // `get_now_playing` rather than `info` is what `publishName` runs against, because the
    // player's own dynamic-info override is resolved through `playback_control` rather than
    // being a value this callback hands over directly. Both this callback and the one for a
    // new track run on the main thread with nothing else able to change the playing track
    // between them, so the handle read back here is the one the update is about.
    void on_playback_dynamic_info_track(const file_info&) override {
        metadb_handle_ptr track;
        if (playback_control::get()->get_now_playing(track))
            publishName(store_, titleScript_, artistScript_, track);
    }

    void on_volume_change(float value) override {
        store_.volumeChanged(value, userMuted(value, outputHold_));
    }

    // The deferral is the fix for the race the comment on `on_playback_new_track` describes.
    // `mainThread_` outliving this `Callback` is what makes it safe with no liveness guard of
    // its own: component.cpp declares it before `playbackWatch_` and closes it first on the
    // way down, so a read still pending at shutdown is abandoned rather than run against a
    // `store_` that may already be gone.
    void queueLocationRead() {
        mainThread_.enqueue([&store = store_] { store.playingLocationChanged(currentLocation()); },
                             [] {});
    }

    MainThreadQueue& mainThread_;
    PlayerStateStore& store_;
    OutputHold& outputHold_;
    NowPlayingArtwork& artwork_;
    titleformat_object::ptr titleScript_;
    titleformat_object::ptr artistScript_;
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

// Every edit to every playlist reaches this, so comparing against the playing playlist happens
// first and an edit elsewhere returns before the store is ever touched: see ARCHITECTURE.md,
// *Facts about the player*.
struct PlaybackWatch::LocationCallback : public playlist_callback_impl_base {
    explicit LocationCallback(PlayerStateStore& store)
        : playlist_callback_impl_base(flag_on_items_added | flag_on_items_removed |
                                       flag_on_items_reordered),
          store_(store) {}

    void on_items_added(t_size playlist, t_size, metadb_handle_list_cref,
                         const bit_array&) override {
        updateIfPlaying(playlist);
    }

    void on_items_removed(t_size playlist, const bit_array&, t_size, t_size) override {
        updateIfPlaying(playlist);
    }

    void on_items_reordered(t_size playlist, const t_size*, t_size) override {
        updateIfPlaying(playlist);
    }

    void updateIfPlaying(t_size playlist) {
        const auto playlists = playlist_manager::get();

        t_size playingPlaylist = 0;
        t_size index = 0;
        if (playlists->get_playing_item_location(&playingPlaylist, &index)) {
            if (playingPlaylist != playlist)
                return;

            store_.playingLocationChanged(
                PlayingLocation{playlistId(playingPlaylist), static_cast<uint32_t>(index)});
            return;
        }

        // Also covers nothing playing, without needing to tell the two apart: see
        // ARCHITECTURE.md, *Facts about the player*.
        if (playlists->get_playing_playlist() != playlist)
            return;

        store_.playingLocationChanged(std::nullopt);
    }

    PlayerStateStore& store_;
};

PlaybackWatch::PlaybackWatch(MainThreadQueue& mainThread, PlayerStateStore& store,
                              OutputHold& outputHold, NowPlayingArtwork& artwork) {
    // On the main thread, once: see the class comment and ARCHITECTURE.md, *Facts about the
    // player*, for why a shared titleformat_object still has to compile here rather than on
    // whichever thread first runs it.
    const auto compiler = titleformat_compiler::get();

    titleformat_object::ptr titleScript;
    compiler->compile_safe_ex(titleScript, kTitleScript, "");

    titleformat_object::ptr artistScript;
    compiler->compile_safe_ex(artistScript, kArtistScript, "");

    callback_ = std::make_unique<Callback>(mainThread, store, outputHold, artwork, titleScript,
                                            artistScript);
    orderCallback_ = std::make_unique<OrderCallback>(store);
    locationCallback_ = std::make_unique<LocationCallback>(store);

    store.publish(initialStateOf(outputHold, std::chrono::steady_clock::now()));

    metadb_handle_ptr track;
    if (playback_control::get()->get_now_playing(track))
        publishName(store, titleScript, artistScript, track);
}

PlaybackWatch::~PlaybackWatch() = default;

}  // namespace jean
