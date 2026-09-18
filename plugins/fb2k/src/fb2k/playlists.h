#pragma once

#include "core/http_server.h"
#include "core/playlists.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
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

struct ChangedPositions {
    DeltaOutcome catchUp = DeltaOutcome::ok;
    uint64_t revision = 0;
    std::vector<uint32_t> positions;
};

using ChangedPositionsReader = std::function<ChangedPositions(
    const std::string& playlistId, uint64_t structure, uint64_t since)>;

ChangedPositionsReader changedPositionsFrom(const PlaylistVersions& versions);

// Registering a callback touches the player, so this is constructed and destroyed on the main
// thread. Construction also seeds the store with the playlists already there, since the
// callback it registers fires only on the next change.
class PlaylistWatch {
public:
    PlaylistWatch(MainThreadQueue& mainThread, PlaylistVersions& versions,
                  PlayerStateStore& store);
    ~PlaylistWatch();

    PlaylistWatch(const PlaylistWatch&) = delete;
    PlaylistWatch& operator=(const PlaylistWatch&) = delete;

private:
    struct Callback;
    std::unique_ptr<Callback> callback_;
};

PlaylistLister makePlaylistLister(MainThreadQueue& mainThread, const PlaylistVersions& versions);
PlaylistRowReader makePlaylistRowReader(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions);
PlaylistChangeReader makeChangedPlaylistRowReader(MainThreadQueue& mainThread,
                                                  ChangedPositionsReader changedPositions);
AutoPlaylistCreator makeAutoPlaylistCreator(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions,
                                            int maxAutoPlaylists);
AutoPlaylistUpdater makeAutoPlaylistUpdater(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions);
AutoPlaylistRemover makeAutoPlaylistRemover(MainThreadQueue& mainThread);
OwnPlaylistResolver makeOwnPlaylistResolver(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions);
OwnPlaylistEmptier makeOwnPlaylistEmptier(MainThreadQueue& mainThread,
                                          const PlaylistVersions& versions);
PlaylistFiller makePlaylistFiller(MainThreadQueue& mainThread, const PlaylistVersions& versions,
                                  OrdinalResolver resolveOrdinals);
QueryPreviewer makeQueryPreviewer(MainThreadQueue& mainThread);

// Main thread only. The SDK offers a count and a getter rather than a range; this turns
// that into something foldable.
std::vector<size_t> playlistIndices();

}  // namespace jean
