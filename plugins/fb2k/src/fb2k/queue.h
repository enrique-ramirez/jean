#pragma once

#include "core/player.h"
#include "core/player_state.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"

// The half of the play queue that involves foobar2000. What a queue read may answer, and what
// a queue request may ask for, was decided in core/requests_queue.h before any of this runs.
namespace jean {

QueueReader makeQueueReader(MainThreadQueue& mainThread, PlayerStateStore& store);

PlaylistRowQueuer makePlaylistRowQueuer(MainThreadQueue& mainThread, PlayerStateStore& store);

LibraryTrackQueuer makeLibraryTrackQueuer(MainThreadQueue& mainThread,
                                          OrdinalResolver resolveOrdinals, PlayerStateStore& store);

MoveQueueEntry makeMoveQueueEntry(MainThreadQueue& mainThread, PlayerStateStore& store);

RemoveQueueEntry makeRemoveQueueEntry(MainThreadQueue& mainThread, PlayerStateStore& store);

ClearQueue makeClearQueue(MainThreadQueue& mainThread);

// foobar2000's playlist_manager::queue_get_contents is a main-thread call.
std::vector<QueueEntry> currentQueue();

}  // namespace jean
