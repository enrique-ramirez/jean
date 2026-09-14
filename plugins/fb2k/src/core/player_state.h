#pragma once

#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>

// What the player is doing, held so a poll can answer it without a hop to the main thread.
// Pure: this half holds the value and its version, and fb2k/ writes it from the player's
// callbacks.
namespace jean {

enum class PlaybackState { stopped, paused, playing };

// Where playback was at the moment the mark was taken. A read never advances `seconds` past
// this; the client interpolates from `taken` the way it already does for the stream's own
// marks.
struct PositionMark {
    double seconds = 0;
    std::chrono::steady_clock::time_point taken;
};

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
};

bool operator==(const PlayerState& a, const PlayerState& b);
inline bool operator!=(const PlayerState& a, const PlayerState& b) {
    return !(a == b);
}

// What `fb2k/` hands `started()` when a new track becomes current. Everything else about the
// state at that moment -- the playback flag, the position resetting to zero -- follows from
// starting rather than from the player, so it is not repeated here.
struct PlayingTrack {
    std::string path;
    uint32_t subsong = 0;
    double duration = 0;
};

// One value under a mutex, with a monotonic version that advances only on a publish that
// changes something a client can see. `read()` hands back the version and the state together
// so a caller never reads one without the other in between.
//
// `started`, `paused`, `resumed` and `stopped` are the transitions a real player raises;
// `publish` stays the primitive underneath all of them, so the version rule lives in one
// place. `fb2k/playback_watch.cpp` calls the transitions for the events they name and
// `publish` directly for the rest -- a seek, a volume change, a dynamic-info duration --
// where there is no state change to name beyond the one field moving.
class PlayerStateStore {
public:
    struct Published {
        uint64_t version = 0;
        PlayerState state;
    };

    PlayerStateStore() = default;

    void publish(PlayerState state);
    Published read() const;

    void started(PlayingTrack track, std::chrono::steady_clock::time_point now);
    void paused(std::chrono::steady_clock::time_point now);
    void resumed(std::chrono::steady_clock::time_point now);
    void stopped();

    PlayerStateStore(const PlayerStateStore&) = delete;
    PlayerStateStore& operator=(const PlayerStateStore&) = delete;

private:
    void applyLocked(PlayerState next);

    mutable std::mutex mutex_;
    uint64_t version_ = 0;
    PlayerState state_;
};

}  // namespace jean
