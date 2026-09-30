#pragma once

#include "core/main_thread_queue.h"
#include "core/player.h"
#include "core/playlists.h"
#include "fb2k/library.h"

// Creating, renaming, removing and moving playlists, and adding and removing their rows. Each
// edit is one main-thread job that reads what it checks and makes the change in the same turn,
// so nothing can land between the check and the write. core/refusal_order.h decides which
// refusal wins when several apply.
namespace jean {

PlaylistCreator makePlaylistCreator(MainThreadQueue& mainThread, const PlaylistVersions& versions,
                                    OrdinalResolver resolveOrdinals);
PlaylistRenamer makePlaylistRenamer(MainThreadQueue& mainThread);
PlaylistRemover makePlaylistRemover(MainThreadQueue& mainThread);
PlaylistMover makePlaylistMover(MainThreadQueue& mainThread);
PlaylistRowCopier makePlaylistRowCopier(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions);
PlaylistRowRemover makePlaylistRowRemover(MainThreadQueue& mainThread,
                                          const PlaylistVersions& versions);
PlaylistRowMover makePlaylistRowMover(MainThreadQueue& mainThread,
                                      const PlaylistVersions& versions);
PlaylistRowSorter makePlaylistRowSorter(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions);
PlaylistFiller makePlaylistFiller(MainThreadQueue& mainThread, OrdinalResolver resolveOrdinals,
                                  const PlaylistVersions& versions);
OwnPlaylistResolver makeOwnPlaylistResolver(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions);
OwnPlaylistEmptier makeOwnPlaylistEmptier(MainThreadQueue& mainThread,
                                          const PlaylistVersions& versions);

}  // namespace jean
