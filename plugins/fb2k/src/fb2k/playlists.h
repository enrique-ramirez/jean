#pragma once

#include "core/http_server.h"
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

// The core keeps a queued entry whose row or whole playlist is gone rather than dropping it,
// and marks the position pfc_infinite in whichever field no longer names anything: see
// ARCHITECTURE.md, *Facts about the player*. Read as an index, either would name a playlist
// or a row that does not exist.
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
