#pragma once

#include "core/http_server.h"
#include "fb2k/main_thread.h"

#include <cstddef>
#include <vector>

// The half of autoplaylists that involves foobar2000. Whether a request is acceptable was
// decided in core/playlists.h before any of this runs; what is left only the player can
// answer, including whether a query parses.
namespace jean {

PlaylistLister makePlaylistLister(MainThreadQueue& mainThread);
AutoPlaylistCreator makeAutoPlaylistCreator(MainThreadQueue& mainThread, int maxAutoPlaylists);
AutoPlaylistUpdater makeAutoPlaylistUpdater(MainThreadQueue& mainThread);
AutoPlaylistRemover makeAutoPlaylistRemover(MainThreadQueue& mainThread);
QueryPreviewer makeQueryPreviewer(MainThreadQueue& mainThread);

// Main thread only. The SDK offers a count and a getter rather than a range; this turns
// that into something foldable.
std::vector<size_t> playlistIndices();

}  // namespace jean
