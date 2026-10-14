#pragma once

#include "core/artwork.h"
#include "core/player.h"
#include "core/player_state.h"

#include <memory>
#include <optional>

namespace jean {

class MainThreadQueue;
class OutputHold;
class PlaylistVersions;

// Registering a callback touches the player, so this is constructed and destroyed on the
// main thread. Construction also seeds the store with what the player is already doing, since
// the callbacks it registers fire only on the next change. The scripts naming the playing track
// compile here as well, once, through compiledNameScripts.
class PlaybackWatch {
public:
    PlaybackWatch(MainThreadQueue& mainThread, PlayerStateStore& store,
                  PlaylistVersions& playlistVersions, OutputHold& outputHold,
                  NowPlayingArtwork& artwork);
    ~PlaybackWatch();

    PlaybackWatch(const PlaybackWatch&) = delete;
    PlaybackWatch& operator=(const PlaybackWatch&) = delete;

private:
    struct Callback;
    struct OrderCallback;
    struct CurrentCallback;
    struct LocationCallback;
    std::unique_ptr<Callback> callback_;
    std::unique_ptr<OrderCallback> orderCallback_;
    std::unique_ptr<CurrentCallback> currentCallback_;
    std::unique_ptr<LocationCallback> locationCallback_;
};

PlayingTrackReader playingTrackReader(MainThreadQueue& mainThread);

void publishLocation(PlayerStateStore& store, PlaylistVersions& versions,
                     const std::optional<PlayingLocation>& location);

}  // namespace jean
