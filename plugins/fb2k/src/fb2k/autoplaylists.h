#pragma once

#include "core/main_thread_queue.h"
#include "core/player.h"
#include "core/playlists.h"
#include "fb2k/library.h"

// The half of autoplaylists that involves foobar2000. Whether a request is acceptable was decided
// in core/playlists.h before any of this runs; what is left only the player can answer, including
// whether a query parses.
namespace jean {

AutoPlaylistCreator makeAutoPlaylistCreator(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions);
AutoPlaylistUpdater makeAutoPlaylistUpdater(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions);
AutoPlaylistRemover makeAutoPlaylistRemover(MainThreadQueue& mainThread);
QueryPreviewer makeQueryPreviewer(MainThreadQueue& mainThread, OrdinalMatcher ordinalMatcher);

}  // namespace jean
