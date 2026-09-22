#include "fb2k/PCH.h"

#include "fb2k/playback_watch.h"

#include "core/output_hold.h"
#include "core/playback_modes.h"
#include "fb2k/main_thread.h"
#include "fb2k/playlists.h"
#include "fb2k/strings.h"

#include <chrono>
#include <mutex>
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

// Bracketed for the same reason as %artist%: an untagged track reads as no record rather than
// one named "?". `[%album artist%]` is a separate title-formatting field, not filled in from
// `[%artist%]`.
constexpr char kAlbumScript[] = "[%album%]";
constexpr char kAlbumArtistScript[] = "[%album artist%]";

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
                 const titleformat_object::ptr& artistScript,
                 const titleformat_object::ptr& albumScript,
                 const titleformat_object::ptr& albumArtistScript,
                 const metadb_handle_ptr& track) {
    const auto playback = playback_control::get();

    pfc::string8 title;
    playback->playback_format_title_ex(track, nullptr, title, titleScript, nullptr,
                                       playback_control::display_level_titles);

    pfc::string8 artist;
    playback->playback_format_title_ex(track, nullptr, artist, artistScript, nullptr,
                                       playback_control::display_level_titles);

    pfc::string8 album;
    playback->playback_format_title_ex(track, nullptr, album, albumScript, nullptr,
                                       playback_control::display_level_titles);

    pfc::string8 albumArtist;
    playback->playback_format_title_ex(track, nullptr, albumArtist, albumArtistScript, nullptr,
                                       playback_control::display_level_titles);

    store.nameChanged(toStd(title), toStd(artist), toStd(album), toStd(albumArtist));
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

std::optional<std::string> currentPlaylist() {
    const auto index = playlist_manager::get()->get_active_playlist();
    if (index == pfc::infinite_size)
        return std::nullopt;

    return playlistId(index);
}

std::optional<PlayingLocation> currentLocation() {
    t_size playlist = 0;
    t_size index = 0;
    if (!playlist_manager::get()->get_playing_item_location(&playlist, &index))
        return std::nullopt;

    return PlayingLocation{playlistId(playlist), static_cast<uint32_t>(index)};
}

// Both halves of what knowing where playback is buys, in one place so that neither can be
// moved without the other. PlaylistVersions treats the row being left as changed whatever the
// player announced, which is how a play count reaches the playing playlist at all.
void publishLocation(PlayerStateStore& store, PlaylistVersions& versions,
                     const std::optional<PlayingLocation>& location) {
    store.playingLocationChanged(location);
    versions.playingRowChanged(location);
}

QueueEntry queueEntryOf(const t_playback_queue_item& item) {
    QueueEntry entry;
    entry.path = displayPathOf(item.m_handle);
    entry.subsong = item.m_handle.is_valid() ? item.m_handle->get_subsong_index() : 0;
    entry.location = queuedLocationOf(item);
    return entry;
}

std::vector<QueueEntry> currentQueue() {
    pfc::list_t<t_playback_queue_item> items;
    playlist_manager::get()->queue_get_contents(items);

    std::vector<QueueEntry> entries;
    entries.reserve(items.get_count());
    for (t_size at = 0; at < items.get_count(); ++at)
        entries.push_back(queueEntryOf(items[at]));

    return entries;
}

std::mutex g_queueTargetMutex;
MainThreadQueue* g_queueTargetMainThread = nullptr;
PlayerStateStore* g_queueTargetStore = nullptr;

void publishQueueTarget(MainThreadQueue* mainThread, PlayerStateStore* store) {
    const std::lock_guard<std::mutex> lock(g_queueTargetMutex);
    g_queueTargetMainThread = mainThread;
    g_queueTargetStore = store;
}

// Deferred for the reason `queueLocationRead` is: a playlist or queue notice runs before
// `playlist_manager` has finished the edit it is reporting. Reads nothing when the component
// isn't running, which covers both a `Plugin` construction that never got this far and one
// already torn down.
void deferQueueRead() {
    MainThreadQueue* mainThread;
    PlayerStateStore* store;
    {
        const std::lock_guard<std::mutex> lock(g_queueTargetMutex);
        mainThread = g_queueTargetMainThread;
        store = g_queueTargetStore;
    }

    if (mainThread == nullptr || store == nullptr)
        return;

    mainThread->enqueue([store] { store->queueChanged(currentQueue()); }, [] {});
}

// See ARCHITECTURE.md, *Facts about the player*, for how this wires itself up with no
// register/unregister pair.
class QueueServiceCallback : public playback_queue_callback {
public:
    void on_changed(t_change_origin) override { deferQueueRead(); }
};

// foobar2000's volume is dB against full scale, so a store left at its default reports the
// fader at maximum until the next change. Seeding from the player at construction covers
// whatever was already true before the first callback, and the playback order the same way: no
// callback fires for it until it next changes.
PlayerState initialStateOf(const OutputHold& outputHold,
                           std::chrono::steady_clock::time_point now) {
    const auto playback = playback_control::get();

    PlayerState state;
    state.volume = playback->get_volume();
    state.muted = userMuted(state.volume, outputHold);
    state.playbackMode = activePlaybackModeOf();
    state.playingLocation = currentLocation();
    state.currentPlaylistId = currentPlaylist();

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

service_factory_single_t<QueueServiceCallback> g_queueServiceCallback;

}  // namespace

struct PlaybackWatch::Callback : public play_callback_impl_base {
    Callback(MainThreadQueue& mainThread, PlayerStateStore& store, PlaylistVersions& versions,
             OutputHold& outputHold, NowPlayingArtwork& artwork,
             titleformat_object::ptr titleScript, titleformat_object::ptr artistScript,
             titleformat_object::ptr albumScript, titleformat_object::ptr albumArtistScript)
        : play_callback_impl_base(flag_on_playback_new_track | flag_on_playback_pause |
                                  flag_on_playback_stop | flag_on_playback_seek |
                                  flag_on_playback_dynamic_info |
                                  flag_on_playback_dynamic_info_track | flag_on_volume_change),
          mainThread_(mainThread),
          store_(store),
          versions_(versions),
          outputHold_(outputHold),
          artwork_(artwork),
          titleScript_(std::move(titleScript)),
          artistScript_(std::move(artistScript)),
          albumScript_(std::move(albumScript)),
          albumArtistScript_(std::move(albumArtistScript)) {}

    // Reading the location inline here would race the player: see ARCHITECTURE.md, *Facts about
    // the player*. `started()` leaves `playingLocation` standing on purpose (player_state.cpp),
    // so a poll between this call and `queueLocationRead`'s sees the outgoing track's row rather
    // than nothing. Artwork has nothing downstream to correct it the way `queueLocationRead`
    // corrects the row, so it clears here instead of standing on that same outgoing picture.
    void on_playback_new_track(metadb_handle_ptr track) override {
        artwork_.clear();
        store_.started(trackOf(track), std::chrono::steady_clock::now());
        publishName(store_, titleScript_, artistScript_, albumScript_, albumArtistScript_, track);
        queueLocationRead();
    }

    // foobar2000 raises stop_reason_starting_another as the outgoing track of a change
    // rather than a stop, and clearing the trackbar for it would flash the status bar blank
    // between every pair of tracks.
    void on_playback_stop(play_control::t_stop_reason reason) override {
        if (reason == playback_control::stop_reason_starting_another)
            return;

        store_.stopped();
        versions_.playingRowChanged(std::nullopt);
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
            publishName(store_, titleScript_, artistScript_, albumScript_, albumArtistScript_, track);
    }

    void on_volume_change(float value) override {
        store_.volumeChanged(value, userMuted(value, outputHold_));
    }

    // Deferred for the race ARCHITECTURE.md, *Facts about the player*, describes.
    void queueLocationRead() {
        mainThread_.enqueue(
            [&store = store_, &versions = versions_] {
                publishLocation(store, versions, currentLocation());
            },
            [] {});
    }

    MainThreadQueue& mainThread_;
    PlayerStateStore& store_;
    PlaylistVersions& versions_;
    OutputHold& outputHold_;
    NowPlayingArtwork& artwork_;
    titleformat_object::ptr titleScript_;
    titleformat_object::ptr artistScript_;
    titleformat_object::ptr albumScript_;
    titleformat_object::ptr albumArtistScript_;
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

// Which playlist foobar2000 has focused decides where an advance draws from, so it is a fact
// about playback rather than about the playlist list: ARCHITECTURE.md, *Facts about the player*.
struct PlaybackWatch::CurrentCallback : public playlist_callback_impl_base {
    explicit CurrentCallback(PlayerStateStore& store)
        : playlist_callback_impl_base(flag_on_playlist_activate), store_(store) {}

    void on_playlist_activate(t_size, t_size) override {
        store_.currentPlaylistChanged(currentPlaylist());
    }

    PlayerStateStore& store_;
};

// Every edit to every playlist reaches this, so comparing against the playing playlist happens
// first and an edit elsewhere returns before the store is ever touched: see ARCHITECTURE.md,
// *Facts about the player*. A queued row can sit in any playlist rather than only the playing
// one, so the queue re-read below is unconditional. A whole playlist going away carries no
// per-row callback of its own, only `on_playlists_removed`, so a queued row losing its position
// that way needs the same re-read.
struct PlaybackWatch::LocationCallback : public playlist_callback_impl_base {
    LocationCallback(MainThreadQueue& mainThread, PlayerStateStore& store,
                     PlaylistVersions& versions)
        : playlist_callback_impl_base(flag_on_items_added | flag_on_items_removed |
                                      flag_on_items_reordered | flag_on_playlists_removed),
          mainThread_(mainThread),
          store_(store),
          versions_(versions) {
        publishQueueTarget(&mainThread_, &store_);
    }

    // locationCallback_ owns this as a LocationCallback, never as the base; see
    // ARCHITECTURE.md, *Facts about the player*, for why that is what makes this destructor
    // safe without `override`.
    ~LocationCallback() { publishQueueTarget(nullptr, nullptr); }

    void on_items_added(t_size playlist, t_size, metadb_handle_list_cref,
                        const bit_array&) override {
        updateIfPlaying(playlist);
        deferQueueRead();
    }

    void on_items_removed(t_size playlist, const bit_array&, t_size, t_size) override {
        updateIfPlaying(playlist);
        deferQueueRead();
    }

    void on_items_reordered(t_size playlist, const t_size*, t_size) override {
        updateIfPlaying(playlist);
        deferQueueRead();
    }

    void on_playlists_removed(const bit_array&, t_size, t_size) override { deferQueueRead(); }

    void updateIfPlaying(t_size playlist) {
        const auto playlists = playlist_manager::get();

        t_size playingPlaylist = 0;
        t_size index = 0;
        if (playlists->get_playing_item_location(&playingPlaylist, &index)) {
            if (playingPlaylist != playlist)
                return;

            publishLocation(
                store_, versions_,
                PlayingLocation{playlistId(playingPlaylist), static_cast<uint32_t>(index)});
            return;
        }

        // Also covers nothing playing, without needing to tell the two apart: see
        // ARCHITECTURE.md, *Facts about the player*.
        if (playlists->get_playing_playlist() != playlist)
            return;

        publishLocation(store_, versions_, std::nullopt);
    }

    MainThreadQueue& mainThread_;
    PlayerStateStore& store_;
    PlaylistVersions& versions_;
};

PlaybackWatch::PlaybackWatch(MainThreadQueue& mainThread, PlayerStateStore& store,
                             PlaylistVersions& playlistVersions, OutputHold& outputHold,
                             NowPlayingArtwork& artwork) {
    // On the main thread, once: see the class comment and ARCHITECTURE.md, *Facts about the
    // player*, for why a shared titleformat_object still has to compile here rather than on
    // whichever thread first runs it.
    const auto compiler = titleformat_compiler::get();

    titleformat_object::ptr titleScript;
    compiler->compile_safe_ex(titleScript, kTitleScript, "");

    titleformat_object::ptr artistScript;
    compiler->compile_safe_ex(artistScript, kArtistScript, "");

    titleformat_object::ptr albumScript;
    compiler->compile_safe_ex(albumScript, kAlbumScript, "");

    titleformat_object::ptr albumArtistScript;
    compiler->compile_safe_ex(albumArtistScript, kAlbumArtistScript, "");

    callback_ = std::make_unique<Callback>(mainThread, store, playlistVersions, outputHold, artwork,
                                           titleScript, artistScript, albumScript, albumArtistScript);
    orderCallback_ = std::make_unique<OrderCallback>(store);
    currentCallback_ = std::make_unique<CurrentCallback>(store);
    locationCallback_ = std::make_unique<LocationCallback>(mainThread, store, playlistVersions);

    store.publish(initialStateOf(outputHold, std::chrono::steady_clock::now()));
    store.queueChanged(currentQueue());
    publishLocation(store, playlistVersions, currentLocation());

    metadb_handle_ptr track;
    if (playback_control::get()->get_now_playing(track))
        publishName(store, titleScript, artistScript, albumScript, albumArtistScript, track);
}

PlaybackWatch::~PlaybackWatch() = default;

}  // namespace jean
