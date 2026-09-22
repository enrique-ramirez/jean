#pragma once

#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace jean {

enum class PlaybackState { stopped, paused, playing };

struct PositionMark {
    double seconds = 0;
    std::chrono::steady_clock::time_point taken;
};

struct PlayingLocation {
    // The playlist's own GUID, never a beefweb id.
    std::string playlistId;
    uint32_t index = 0;
};

bool operator==(const PlayingLocation& a, const PlayingLocation& b);

struct PlayerState {
    PlaybackState playback = PlaybackState::stopped;
    std::string path;
    uint32_t subsong = 0;
    PositionMark position;
    double duration = 0;
    double volume = 0;
    bool muted = false;

    // Jean's own name for the order the player is in, from core/playback_modes.h. `std::nullopt`
    // is an order this component has no name for, and crosses the wire as `null` rather than as
    // a wrong name.
    std::optional<std::string> playbackMode;

    // The playing track's name, computed by the player through title-formatting.
    std::optional<std::string> title;
    std::optional<std::string> artist;

    std::optional<PlayingLocation> playingLocation;

    // The playlist foobar2000 has focused, not the one the playing track sits in
    // (`playingLocation`): ARCHITECTURE.md, *Facts about the player*.
    std::optional<std::string> currentPlaylistId;
};

bool operator==(const PlayerState& a, const PlayerState& b);
inline bool operator!=(const PlayerState& a, const PlayerState& b) {
    return !(a == b);
}

struct PlayingTrack {
    std::string path;
    uint32_t subsong = 0;
    double duration = 0;
};

// One queued track. `location` is `std::nullopt` for a library track queued by handle, and for
// a playlist row whose position the player has lost.
struct QueueEntry {
    std::string path;
    uint32_t subsong = 0;
    std::optional<PlayingLocation> location;
};

bool operator==(const QueueEntry& a, const QueueEntry& b);

struct PlaylistMark {
    std::string id;
    std::string title;
    uint64_t structure = 0;
    uint64_t revision = 0;
};

bool operator==(const PlaylistMark& a, const PlaylistMark& b);

// `publish` replaces the whole state under one lock, and stays alongside the narrower
// transitions below for `fb2k/playback_watch.cpp`'s construction-time seed, where there is
// no prior state to transition from, and for the test suite's arranging one directly.
class PlayerStateStore {
public:
    struct Published {
        uint64_t version = 0;
        uint64_t queueRevision = 0;
        uint64_t playlistsRevision = 0;
        PlayerState state;
    };

    PlayerStateStore() = default;

    void publish(PlayerState state);
    Published read() const;

    void started(PlayingTrack track, std::chrono::steady_clock::time_point now);
    void paused(std::chrono::steady_clock::time_point now);
    void resumed(std::chrono::steady_clock::time_point now);
    void stopped();
    void seeked(double seconds, std::chrono::steady_clock::time_point now);
    void volumeChanged(double volume, bool muted);
    void durationChanged(double duration);
    void playbackModeChanged(std::optional<std::string> mode);
    void playingLocationChanged(std::optional<PlayingLocation> location);
    void currentPlaylistChanged(std::optional<std::string> playlistId);

    void nameChanged(std::string title, std::string artist);

    void queueChanged(std::vector<QueueEntry> entries);

    void playlistsChanged(std::vector<PlaylistMark> playlists);

    PlayerStateStore(const PlayerStateStore&) = delete;
    PlayerStateStore& operator=(const PlayerStateStore&) = delete;

private:
    void applyLocked(PlayerState next);

    mutable std::mutex mutex_;
    uint64_t version_ = 0;
    uint64_t queueRevision_ = 0;
    uint64_t playlistsRevision_ = 0;
    PlayerState state_;
    std::vector<QueueEntry> queue_;
    std::vector<PlaylistMark> playlists_;
};

}  // namespace jean
