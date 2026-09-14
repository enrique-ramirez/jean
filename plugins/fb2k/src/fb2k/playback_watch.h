#pragma once

#include "core/player_state.h"

#include <memory>

namespace jean {

class OutputHold;

// Registering a callback touches the player, so this is constructed and destroyed on the
// main thread. Construction also seeds the store with what the player is already doing, since
// the callbacks it registers fire only on the next change.
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
