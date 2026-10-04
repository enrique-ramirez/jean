#include "core/player_state.h"

#include <utility>

namespace jean {

using std::chrono::duration;
using std::chrono::steady_clock;

namespace {

bool samePlayerFields(const PlayerState& a, const PlayerState& b) {
    return a.volume == b.volume && a.muted == b.muted && a.outputDeviceId == b.outputDeviceId &&
           a.outputSilent == b.outputSilent && a.currentPlaylistId == b.currentPlaylistId;
}

}  // namespace

bool operator==(const PlayingLocation& a, const PlayingLocation& b) {
    return a.playlistId == b.playlistId && a.index == b.index;
}

bool operator==(const QueueEntry& a, const QueueEntry& b) {
    return a.path == b.path && a.subsong == b.subsong && a.location == b.location;
}

bool operator==(const PlaylistMark& a, const PlaylistMark& b) {
    return a.id == b.id && a.title == b.title && a.structure == b.structure &&
           a.revision == b.revision;
}

bool operator==(const PlayerState& a, const PlayerState& b) {
    return a.playback == b.playback && a.path == b.path && a.subsong == b.subsong &&
           a.libraryPath == b.libraryPath && a.position.seconds == b.position.seconds &&
           a.position.taken == b.position.taken && a.duration == b.duration &&
           a.volume == b.volume && a.muted == b.muted && a.playbackMode == b.playbackMode &&
           a.outputDeviceId == b.outputDeviceId && a.outputSilent == b.outputSilent &&
           a.title == b.title && a.artist == b.artist && a.album == b.album &&
           a.albumArtist == b.albumArtist && a.playingLocation == b.playingLocation &&
           a.currentPlaylistId == b.currentPlaylistId;
}

void PlayerStateStore::publish(PlayerState state) {
    const std::lock_guard<std::mutex> held(mutex_);
    applyLocked(std::move(state));
}

PlayerStateStore::Published PlayerStateStore::read() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return {version_,          queueRevision_,  playlistsRevision_,
            timelineRevision_, playerRevision_, state_};
}

void PlayerStateStore::started(PlayingTrack track, steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.playback = PlaybackState::playing;
    next.path = std::move(track.path);
    next.subsong = track.subsong;
    next.libraryPath = std::move(track.libraryPath);
    next.duration = track.duration;
    next.position = {0, now};
    next.title.reset();
    next.artist.reset();
    next.album.reset();
    next.albumArtist.reset();

    applyLocked(std::move(next));
}

void PlayerStateStore::paused(steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (state_.playback != PlaybackState::playing)
        return;

    PlayerState next = state_;
    next.playback = PlaybackState::paused;
    next.position.seconds += duration<double>(now - state_.position.taken).count();
    next.position.taken = now;

    applyLocked(std::move(next));
}

void PlayerStateStore::resumed(steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (state_.playback != PlaybackState::paused)
        return;

    PlayerState next = state_;
    next.playback = PlaybackState::playing;
    next.position.taken = now;

    applyLocked(std::move(next));
}

void PlayerStateStore::stopped() {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.playback = PlaybackState::stopped;
    next.path.clear();
    next.subsong = 0;
    next.libraryPath.reset();
    next.duration = 0;
    next.position = PositionMark{};
    next.title.reset();
    next.artist.reset();
    next.album.reset();
    next.albumArtist.reset();
    next.playingLocation.reset();

    applyLocked(std::move(next));
}

void PlayerStateStore::seeked(double seconds, steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.position = {seconds, now};

    applyLocked(std::move(next));
}

void PlayerStateStore::volumeChanged(double volume, bool muted) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.volume = volume;
    next.muted = muted;

    applyLocked(std::move(next));
}

void PlayerStateStore::durationChanged(double duration) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.duration = duration;

    applyLocked(std::move(next));
}

void PlayerStateStore::playbackModeChanged(std::optional<std::string> mode) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.playbackMode = std::move(mode);

    applyLocked(std::move(next));
}

void PlayerStateStore::outputDeviceChanged(std::optional<std::string> id,
                                           std::optional<bool> silent) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.outputDeviceId = std::move(id);
    next.outputSilent = silent;

    applyLocked(std::move(next));
}

void PlayerStateStore::playingLocationChanged(std::optional<PlayingLocation> location) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.playingLocation = std::move(location);

    applyLocked(std::move(next));
}

void PlayerStateStore::currentPlaylistChanged(std::optional<std::string> playlistId) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.currentPlaylistId = std::move(playlistId);

    applyLocked(std::move(next));
}

void PlayerStateStore::nameChanged(std::string title, std::string artist, std::string album,
                                   std::string albumArtist) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.title = title.empty() ? std::nullopt : std::optional(std::move(title));
    next.artist = artist.empty() ? std::nullopt : std::optional(std::move(artist));
    next.album = album.empty() ? std::nullopt : std::optional(std::move(album));
    next.albumArtist = albumArtist.empty() ? std::nullopt : std::optional(std::move(albumArtist));

    applyLocked(std::move(next));
}

void PlayerStateStore::queueChanged(std::vector<QueueEntry> entries) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (entries == queue_)
        return;

    queue_ = std::move(entries);
    bumpRevision(queueRevision_);
}

void PlayerStateStore::playlistsChanged(std::vector<PlaylistMark> playlists) {
    const std::lock_guard<std::mutex> held(mutex_);

    if (playlists == playlists_)
        return;

    playlists_ = std::move(playlists);
    bumpRevision(playlistsRevision_);
}

void PlayerStateStore::timelineMarked() {
    const std::lock_guard<std::mutex> held(mutex_);
    bumpRevision(timelineRevision_);
}

void PlayerStateStore::applyLocked(PlayerState next) {
    if (next == state_)
        return;

    if (!samePlayerFields(next, state_))
        ++playerRevision_;

    state_ = std::move(next);
    ++version_;
}

void PlayerStateStore::bumpRevision(uint64_t& revision) {
    ++version_;
    ++revision;
}

}  // namespace jean
