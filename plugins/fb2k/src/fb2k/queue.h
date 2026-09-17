#pragma once

#include "core/http_server.h"
#include "core/player_state.h"
#include "fb2k/main_thread.h"

// The half of the play queue that involves foobar2000. What a queue read may answer was
// decided in core/api.h before any of this runs.
namespace jean {

QueueReader makeQueueReader(MainThreadQueue& mainThread, PlayerStateStore& store);

}  // namespace jean
