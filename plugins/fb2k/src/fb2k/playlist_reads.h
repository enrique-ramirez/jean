#pragma once

#include "core/main_thread_queue.h"
#include "core/player.h"
#include "core/playlists.h"
#include "fb2k/artwork.h"
#include "fb2k/library.h"

// Listing playlists and reading their rows. The handles are copied on the main thread and the
// columns evaluated off it, on the connection thread that asked: see ARCHITECTURE.md, *Facts
// about the player*, for why a compiled script may run there.
namespace jean {

PlaylistLister makePlaylistLister(MainThreadQueue& mainThread, const PlaylistVersions& versions);
PlaylistRoleReader makePlaylistRoleReader(MainThreadQueue& mainThread);
PlaylistRowReader makePlaylistRowReader(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions);

PlaylistTrackReader makePlaylistTracksReader(MainThreadQueue& mainThread,
                                             const PlaylistVersions& versions,
                                             HandleOrdinalMapper ordinalsOf);
PlaylistChangeReader makeChangedPlaylistRowReader(MainThreadQueue& mainThread,
                                                  const PlaylistVersions& versions);

// The playlist and the row are resolved to a handle on the main thread; the library path and the
// cover are read from it off the main thread, the way a page of rows is. `art` outlives the
// reader this returns.
PlaylistRowArtworkReader makePlaylistRowArtworkReader(MainThreadQueue& mainThread,
                                                      const AlbumArt& art);

PlaylistTrackTaker makePlaylistTrackTaker(MainThreadQueue& mainThread);

}  // namespace jean
