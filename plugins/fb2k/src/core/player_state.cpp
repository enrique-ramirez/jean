#include "core/player_state.h"

#include <utility>

namespace jean {

using std::chrono::duration;
using std::chrono::steady_clock;

bool operator==(const PlayingLocation& a, const PlayingLocation& b) {
    return a.playlistId == b.playlistId && a.index == b.index;
}

bool operator==(const PlayerState& a, const PlayerState& b) {
    return a.playback == b.playback && a.path == b.path && a.subsong == b.subsong &&
           a.position.seconds == b.position.seconds && a.position.taken == b.position.taken &&
           a.duration == b.duration && a.volume == b.volume && a.muted == b.muted &&
           a.playbackMode == b.playbackMode && a.title == b.title && a.artist == b.artist &&
           a.playingLocation == b.playingLocation;
}

void PlayerStateStore::publish(PlayerState state) {
    const std::lock_guard<std::mutex> held(mutex_);
    applyLocked(std::move(state));
}

PlayerStateStore::Published PlayerStateStore::read() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return {version_, state_};
}

void PlayerStateStore::started(PlayingTrack track, steady_clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.playback = PlaybackState::playing;
    next.path = std::move(track.path);
    next.subsong = track.subsong;
    next.duration = track.duration;
    next.position = {0, now};
    next.title.reset();
    next.artist.reset();

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
    next.duration = 0;
    next.position = PositionMark{};
    next.title.reset();
    next.artist.reset();
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

void PlayerStateStore::playingLocationChanged(std::optional<PlayingLocation> location) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.playingLocation = std::move(location);

    applyLocked(std::move(next));
}

void PlayerStateStore::nameChanged(std::string title, std::string artist) {
    const std::lock_guard<std::mutex> held(mutex_);

    PlayerState next = state_;
    next.title = title.empty() ? std::nullopt : std::optional(std::move(title));
    next.artist = artist.empty() ? std::nullopt : std::optional(std::move(artist));

    applyLocked(std::move(next));
}

void PlayerStateStore::applyLocked(PlayerState next) {
    if (next == state_)
        return;

    state_ = std::move(next);
    ++version_;
}

}  // namespace jean
