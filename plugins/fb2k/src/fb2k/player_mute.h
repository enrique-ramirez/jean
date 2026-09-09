#pragma once

#include "core/output_hold.h"

#include <memory>

namespace jean {

class MainThreadQueue;

OutputHold::Player playerMuteVia(MainThreadQueue& mainThread);

// Registering a callback touches the player, so this is constructed and destroyed on the
// main thread.
class PlayerVolumeWatch {
public:
    explicit PlayerVolumeWatch(OutputHold& hold);
    ~PlayerVolumeWatch();

    PlayerVolumeWatch(const PlayerVolumeWatch&) = delete;
    PlayerVolumeWatch& operator=(const PlayerVolumeWatch&) = delete;

private:
    struct Callback;
    std::unique_ptr<Callback> callback_;
};

}  // namespace jean
