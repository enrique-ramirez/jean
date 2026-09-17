#pragma once

#include "core/http_server.h"
#include "core/playlists.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

// The half of autoplaylists that involves foobar2000. Whether a request is acceptable was
// decided in core/playlists.h before any of this runs; what is left only the player can
// answer, including whether a query parses.
namespace jean {

// GUID, lowercased, dashed, no braces.
std::string playlistId(size_t index);

// pfc::infinite_size when nothing matches. pfc::GUID_from_text never reports a failure, so
// after the shape check in core/playlists.h this is the only thing that can say "no such
// playlist". Exposed for fb2k/queue.cpp, which resolves a playlist GUID the same way before it
// queues a row.
size_t findPlaylist(const std::string& id);

std::optional<PlayingLocation> queuedLocationOf(const t_playback_queue_item& item);

PlaylistLister makePlaylistLister(MainThreadQueue& mainThread);
AutoPlaylistCreator makeAutoPlaylistCreator(MainThreadQueue& mainThread, int maxAutoPlaylists);
AutoPlaylistUpdater makeAutoPlaylistUpdater(MainThreadQueue& mainThread);
AutoPlaylistRemover makeAutoPlaylistRemover(MainThreadQueue& mainThread);
OwnPlaylistResolver makeOwnPlaylistResolver(MainThreadQueue& mainThread);
OwnPlaylistEmptier makeOwnPlaylistEmptier(MainThreadQueue& mainThread);
PlaylistFiller makePlaylistFiller(MainThreadQueue& mainThread, OrdinalResolver resolveOrdinals);
QueryPreviewer makeQueryPreviewer(MainThreadQueue& mainThread);

// Main thread only. The SDK offers a count and a getter rather than a range; this turns
// that into something foldable.
std::vector<size_t> playlistIndices();

}  // namespace jean
