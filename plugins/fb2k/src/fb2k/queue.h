#pragma once

#include "core/http_server.h"
#include "core/player_state.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"

// The half of the play queue that involves foobar2000. What a queue read may answer, and what
// a queue request may ask for, was decided in core/api.h before any of this runs.
namespace jean {

QueueReader makeQueueReader(MainThreadQueue& mainThread, PlayerStateStore& store);

PlaylistRowQueuer makePlaylistRowQueuer(MainThreadQueue& mainThread);

LibraryTrackQueuer makeLibraryTrackQueuer(MainThreadQueue& mainThread,
                                          OrdinalResolver resolveOrdinals);

}  // namespace jean
