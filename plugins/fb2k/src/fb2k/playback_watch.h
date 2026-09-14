#pragma once

#include "core/player_state.h"

#include <memory>

namespace jean {

class OutputHold;

// Registering a callback touches the player, so this is constructed and destroyed on the
// main thread. Construction also seeds the store with what the player is already doing, since
// the callbacks it registers fire only on the next change.
//
// Two callbacks, against two different SDK services: `playback_control` for the transport and
// the volume, `playlist_manager` for the playback order, because that is where foobar2000 keeps
// it.
class PlaybackWatch {
public:
    PlaybackWatch(PlayerStateStore& store, OutputHold& outputHold);
    ~PlaybackWatch();

    PlaybackWatch(const PlaybackWatch&) = delete;
    PlaybackWatch& operator=(const PlaybackWatch&) = delete;

private:
    struct Callback;
    struct OrderCallback;
    std::unique_ptr<Callback> callback_;
    std::unique_ptr<OrderCallback> orderCallback_;
};

}  // namespace jean
