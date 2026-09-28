#pragma once

#include "core/main_thread_queue.h"
#include "core/player_state.h"
#include "core/playlists.h"

#include <memory>

namespace jean {

// Registering a callback touches the player, so this is constructed and destroyed on the main
// thread. Construction also seeds the store with the playlists already there, since the callback
// it registers fires only on the next change.
class PlaylistWatch {
public:
    PlaylistWatch(MainThreadQueue& mainThread, PlaylistVersions& versions, PlayerStateStore& store);
    ~PlaylistWatch();

    PlaylistWatch(const PlaylistWatch&) = delete;
    PlaylistWatch& operator=(const PlaylistWatch&) = delete;

private:
    struct Callback;
    std::unique_ptr<Callback> callback_;
};

}  // namespace jean
