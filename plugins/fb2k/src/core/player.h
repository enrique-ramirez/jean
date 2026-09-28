#pragma once

#include "core/api.h"
#include "core/artwork.h"
#include "core/library.h"
#include "core/outputs.h"
#include "core/player_outcome.h"
#include "core/playlists.h"
#include "core/stream.h"
#include "core/tag_write.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

// Everything core/ can ask of the player, one call set per thing it reaches. See ARCHITECTURE.md,
// *The seams*: src/fb2k/ supplies every one of these, and a null callback is how an install that
// switched a feature off says so.
namespace jean {

using PlaylistLister = std::function<PlaylistsResult()>;

// Reads at most `count` rows of `playlistId` from `offset`, with `columns` evaluated against
// each row's own handle. The handles are copied on the main thread and formatted off it.
using PlaylistRowReader =
    std::function<PlaylistRowsRead(const std::string& playlistId, size_t offset, size_t count,
                                   const std::vector<std::string>& columns)>;

// Reads the rows of `playlistId` whose content moved after `since`, each with its position, with
// `columns` evaluated against each row's own handle. `structure` is the generation the client's
// positions were read at.
using PlaylistChangeReader =
    std::function<PlaylistChangesRead(const std::string& playlistId, uint64_t structure,
                                      uint64_t since, const std::vector<std::string>& columns)>;

// What GET /api/artwork/playlists/{id}/{row} has to decide from: `outcome` carries the two
// only the player can answer, an unknown playlist and a position past its end. `libraryPath`
// is set where the media library already holds a path for the row, which the route refuses
// (ARCHITECTURE.md, *Artwork*, has why); `source` is the cover itself where there is one to send.
struct PlaylistArtworkRead {
    PlayerOutcome outcome = PlayerOutcome::done;
    std::optional<std::string> libraryPath;
    ArtworkSource source;
};

using PlaylistRowArtworkReader =
    std::function<PlaylistArtworkRead(const std::string& playlistId, uint32_t row)>;

// The rows a new playlist is created holding, in the order they are inserted. A create with
// no set carries neither pair: `ordinals` resolved against `structure` name media library
// tracks, and `positions` name rows of `sourcePlaylistId`.
struct NewPlaylistRows {
    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;

    std::string sourcePlaylistId;
    std::vector<uint32_t> positions;
};

// Creates a playlist at the end of the player's list, titled `title` and holding `rows`, in
// one main-thread work item so that no client ever sees it empty. Answers the annotation
// GET /api/playlists reports for it.
using PlaylistCreator =
    std::function<PlaylistResult(const std::string& title, const NewPlaylistRows& rows)>;

using PlaylistRenamer =
    std::function<PlaylistResult(const std::string& id, const std::string& title)>;

// Removes `id` and leaves the play queue alone: foobar2000 keeps a queued entry whose whole
// playlist is gone rather than dropping it, so there is nothing here to tidy. See
// ARCHITECTURE.md, *Facts about the player*.
using PlaylistRemover = std::function<PlaylistResult(const std::string& id)>;

using PlaylistMover = std::function<PlaylistResult(const std::string& id, uint32_t index)>;

// What a row edit left behind: the structure generation the playlist is at once the write has
// landed, and where the rows an insert added sit, in the order they were inserted. `positions`
// is empty for a removal, which lands nothing.
struct RowsEdited {
    PlayerOutcome outcome = PlayerOutcome::done;
    uint64_t structure = 0;
    std::vector<size_t> positions;
};

// Appends the rows `positions` names in `sourcePlaylistId` to the end of `playlistId`. Takes no
// structure generation: an append addresses no position in the target, so there is nothing for
// one to protect, and the generation this answers is the one a client's undo names.
using PlaylistRowCopier =
    std::function<RowsEdited(const std::string& playlistId, const std::string& sourcePlaylistId,
                             const std::vector<uint32_t>& positions)>;

// Removes the rows `positions` names from `playlistId`, and answers `rowsMoved` having removed
// nothing where `structure` is no longer the playlist's structure generation.
using PlaylistRowRemover = std::function<RowsEdited(
    const std::string& playlistId, uint64_t structure, const std::vector<uint32_t>& positions)>;

// Where the rows an insert asked for landed, in the order they were inserted, and the
// target's structure generation once they had.
struct FillResult {
    PlayerOutcome outcome = PlayerOutcome::done;
    std::vector<size_t> positions;
    uint64_t structure = 0;
};

// Resolves `ordinals` against the snapshot built for `structure`, in the order given, and
// inserts the tracks they name into `playlistId`, emptying it first when `replace` is set.
// The read-only-playlists switch is decided before this is called. Whether foobar2000 has
// the playlist locked against the edit is not: only the player knows a lock's state, so
// this callback answers `playlistLocked` itself. `title` renames the playlist in the same
// main-thread work item that checks the generation, so a refusal never lands ahead of the
// rows it refused; an empty `title` is a user's playlist saying it is not this component's
// to rename.
using PlaylistFiller = std::function<FillResult(
    const std::string& playlistId, const std::string& title, uint64_t structure,
    const std::vector<uint32_t>& ordinals, bool replace)>;

// Resolves `role` to the id of the component's own playlist for it, through the marker the
// playlist carries rather than its title, so a rename at the player still finds it and a
// playlist a user titled to look like it is not adopted. Creates one titled `title` if the
// role has none yet; a role that already has a playlist keeps whatever title it carries,
// because retitling it for a view belongs to PlaylistFiller, in the same work item that
// checks the generation.
using OwnPlaylistResolver =
    std::function<PlaylistResult(OwnPlaylistRole role, const std::string& title)>;

// Empties `role`'s own playlist and leaves the playlist itself standing. Takes no structure
// and no ordinals: there is nothing here to resolve against the library, unlike a fill. A
// role with no playlist yet is a quiet success rather than one made to answer this.
using OwnPlaylistEmptier = std::function<PlaylistResult(OwnPlaylistRole role)>;

struct PlaylistCalls {
    PlaylistLister list;
    PlaylistRowReader readRows;
    PlaylistChangeReader readChangedRows;
    PlaylistRowArtworkReader readRowArtwork;
    PlaylistCreator create;
    PlaylistRenamer rename;
    PlaylistRemover remove;
    PlaylistMover move;
    PlaylistRowCopier copyRows;
    PlaylistRowRemover removeRows;
    PlaylistFiller fill;
    OwnPlaylistResolver resolveOwn;
    OwnPlaylistEmptier emptyOwn;
};

using AutoPlaylistCreator =
    std::function<PlaylistResult(const AutoPlaylistSpec&, int maxAutoPlaylists)>;
using AutoPlaylistUpdater =
    std::function<PlaylistResult(const std::string& id, const AutoPlaylistSpec&)>;
using AutoPlaylistRemover = std::function<PlaylistResult(const std::string& id)>;
using QueryPreviewer = std::function<PreviewResult(const std::string& query)>;

struct AutoPlaylistCalls {
    AutoPlaylistCreator create;
    AutoPlaylistUpdater update;
    AutoPlaylistRemover remove;
    QueryPreviewer preview;
};

using QueueReader = std::function<QueueRead()>;
using PlaylistRowQueuer = std::function<PlayerOutcome(const std::string& playlistId,
                                                      const std::vector<uint32_t>& positions,
                                                      std::optional<QueuePosition> at)>;
using LibraryTrackQueuer = std::function<PlayerOutcome(
    uint64_t structure, const std::vector<uint32_t>& ordinals, std::optional<QueuePosition> at)>;
using MoveQueueEntry = std::function<PlayerOutcome(uint32_t from, uint32_t to, uint64_t revision)>;
using RemoveQueueEntry = std::function<PlayerOutcome(uint32_t index, uint64_t revision)>;
using ClearQueue = std::function<PlayerOutcome()>;

struct QueueCalls {
    QueueReader read;
    PlaylistRowQueuer addPlaylistRows;
    LibraryTrackQueuer addLibraryTracks;
    MoveQueueEntry moveEntry;
    RemoveQueueEntry removeEntry;
    ClearQueue clear;
};

enum class Transport { PlayPause, Next, Previous, Stop };
enum class VolumeStep { Up, Down };

using PlaylistRowPlayer =
    std::function<PlayerOutcome(const std::string& playlistId, uint32_t index)>;
using TransportCommander = std::function<PlayerOutcome(Transport)>;
using PlaybackSeeker = std::function<PlayerOutcome(double seconds, bool relative)>;
// `index` is a position in PlayerReport::playbackOrders.
using PlaybackOrderSetter = std::function<PlayerOutcome(size_t index)>;
using VolumeSetter = std::function<PlayerOutcome(double level)>;
using VolumeStepper = std::function<PlayerOutcome(VolumeStep)>;
using MuteSetter = std::function<PlayerOutcome(bool muted)>;

struct PlayingTrackRead {
    PlayerOutcome outcome = PlayerOutcome::done;
    bool playing = false;
    std::string path;
    uint32_t subsong = 0;
    std::vector<std::string> columns;
};

using PlayingTrackReader = std::function<PlayingTrackRead(const std::vector<std::string>& columns)>;

struct PlaybackCalls {
    PlaylistRowPlayer playPlaylistRow;
    TransportCommander commandTransport;
    PlaybackSeeker seek;
    PlaybackOrderSetter setOrder;
    VolumeSetter setVolume;
    VolumeStepper stepVolume;
    MuteSetter setMuted;
    PlayingTrackReader readPlayingTrack;
};

using OutputLister = std::function<OutputsRead()>;
using OutputSetter = std::function<PlayerOutcome(const std::string& deviceId)>;

struct OutputCalls {
    OutputLister list;
    OutputSetter setActive;
};

// Walks the player's media library and replaces the snapshot with one built from exactly these
// columns. Slow, and rate limited.
using LibraryRefresher = std::function<void(std::vector<std::string> columns, RebuildReason why)>;

// What GET /api/track/library has to decide from: `outcome` carries the failures only the
// player can answer, and `held` is false where the snapshot has no track at that address.
struct LibraryTrackRead {
    PlayerOutcome outcome = PlayerOutcome::done;
    bool held = false;
    std::vector<std::string> columns;
};

// Evaluates `columns` against the one track the media library holds at `track` and `subsong`,
// the address GET /api/artwork takes. Unlike the artwork read, which resolves on the calling
// thread, this takes GET /api/playlists/{id}/items' shape and does its work on the player's
// main thread: foobar2000 does not document titleformat_compiler::compile as safe anywhere
// else, and the scripts already compiled hold only the columns the snapshot was declared with.
using LibraryTrackReader = std::function<LibraryTrackRead(
    const std::string& track, uint32_t subsong, const std::vector<std::string>& columns)>;

// Evaluates `columns` against the one track the media library holds at `at`, the precise
// address POST /api/tags' ordinal form also resolves through. Same main-thread hop as
// LibraryTrackReader, and the same shape of failure: `outcome` carries structureMoved for a
// stale generation, and `held` false is an ordinal past the end of the current one.
using LibraryOrdinalReader = std::function<LibraryTrackRead(
    const OrdinalTrackRef& at, const std::vector<std::string>& columns)>;

using TagWriter = std::function<TagWriteOutcome(const TagWrite&)>;

struct LibraryCalls {
    LibraryRefresher refresh;
    LibraryTrackReader readTrack;
    LibraryOrdinalReader readOrdinal;
    ArtworkReader readArtwork;
    TagWriter writeTags;
};

// Already rendered: the stream clock and the marks agree only at the moment they are read
// together.
using TimelineReader = std::function<std::string()>;

struct StreamCalls {
    StreamOpener open;

    // Which formats `open` will accept, best first. Empty means no streaming.
    std::vector<std::string> formats;

    TimelineReader readTimeline;
    std::function<bool()> outputHeld;
    std::function<void()> releaseOutput;
};

// Answers the bytes of the page's own build at `path`, relative to the build root and with no
// leading slash, or nothing where nothing holds such a file. Null is how an install with no
// page compiled in and no page on disk says so.
using PageReader = std::function<std::optional<std::string>(const std::string& path)>;

struct DiskPage {
    enum class Kind { Missing, File, Directory };
    Kind kind = Kind::Missing;
    std::string bytes;
};

using DiskPageReader = std::function<DiskPage(const std::string& path)>;

struct PageCalls {
    PageReader read;
    std::vector<std::string> names;
    DiskPageReader readDisk;
};

// Read once from the player and never changed while it runs. An empty name or version, or an
// equal volumeMin and volumeMax, is how a null Player{} in a test says it carries no report; a
// real one always fills them.
struct PlayerReport {
    std::string name;
    std::string version;
    double volumeMin = 0;
    double volumeMax = 0;
    std::string volumeUnit;

    // The player's own listing of its playback orders, in its own order. Extensible: a
    // component can add one, so a name missing from core/playback_modes.h is expected rather
    // than a defect.
    std::vector<std::string> playbackOrders;
};

struct Player {
    PlayerReport report;
    PlaylistCalls playlists;
    AutoPlaylistCalls autoPlaylists;
    QueueCalls queue;
    PlaybackCalls playback;
    OutputCalls outputs;
    LibraryCalls library;
    StreamCalls stream;
    PageCalls page;
};

}  // namespace jean
