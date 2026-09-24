#pragma once

#include "core/api.h"
#include "core/artwork.h"
#include "core/audience.h"
#include "core/library.h"
#include "core/pairing.h"
#include "core/player_state.h"
#include "core/settings.h"
#include "core/stream.h"
#include "core/stream_ticket.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace jean {

constexpr size_t kMaxBodyBytes = size_t{256} * 1024;

// The one response too big for kMaxBodyBytes to say anything about, which bounds a request.
// A library of a quarter of a million tracks serialises to a few tens of megabytes, so this
// leaves room above that and still refuses before a client's memory is the thing that fails.
// It bounds the serialised body, before any content coding: gzip is what crosses the wire, and
// what a client has to hold once it has decoded is the number this caps.
constexpr size_t kMaxLibraryBytes = size_t{64} * 1024 * 1024;

using TagWriter = std::function<TagWriteOutcome(const TagWrite&)>;
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

using PlaylistRowPlayer =
    std::function<PlaylistOutcome(const std::string& playlistId, uint32_t index)>;

using QueueReader = std::function<QueueRead()>;

using PlaylistRowQueuer = std::function<PlaylistOutcome(const std::string& playlistId,
                                                        const std::vector<uint32_t>& positions,
                                                        std::optional<QueuePosition> at)>;
using LibraryTrackQueuer = std::function<PlaylistOutcome(
    uint64_t structure, const std::vector<uint32_t>& ordinals, std::optional<QueuePosition> at)>;
using MoveQueueEntry =
    std::function<PlaylistOutcome(uint32_t from, uint32_t to, uint64_t revision)>;
using RemoveQueueEntry = std::function<PlaylistOutcome(uint32_t index, uint64_t revision)>;
using ClearQueue = std::function<PlaylistOutcome()>;
using AutoPlaylistCreator = std::function<PlaylistResult(const AutoPlaylistSpec&)>;
using AutoPlaylistUpdater =
    std::function<PlaylistResult(const std::string& id, const AutoPlaylistSpec&)>;
using AutoPlaylistRemover = std::function<PlaylistResult(const std::string& id)>;
using QueryPreviewer = std::function<PreviewResult(const std::string& query)>;
using TimelineReader = std::function<std::string()>;
using LibraryRefresher = std::function<void(std::vector<std::string> columns, RebuildReason why)>;

// Resolves `role` to the id of the component's own playlist for it, through the marker the
// playlist carries rather than its title, so a rename at the player still finds it and a
// playlist a user titled to look like it is not adopted. Creates one titled `title` if the
// role has none yet; a role that already has a playlist keeps whatever title it carries,
// because retitling it for a view belongs to PlaylistFiller, in the same work item that
// checks the generation.
using OwnPlaylistResolver =
    std::function<PlaylistResult(OwnPlaylistRole role, const std::string& title)>;

// Where the rows an insert asked for landed, in the order they were inserted, and the
// target's structure generation once they had.
struct FillResult {
    PlaylistOutcome outcome = PlaylistOutcome::done;
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

// Empties `role`'s own playlist and leaves the playlist itself standing. Takes no structure
// and no ordinals: there is nothing here to resolve against the library, unlike a fill. A
// role with no playlist yet is a quiet success rather than one made to answer this.
using OwnPlaylistEmptier = std::function<PlaylistResult(OwnPlaylistRole role)>;

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
    PlaylistOutcome outcome = PlaylistOutcome::done;
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

// What GET /api/artwork/playlists/{id}/{row} has to decide from: `outcome` carries the two
// only the player can answer, an unknown playlist and a position past its end. `libraryPath`
// is set where the media library already holds a path for the row, which the route refuses
// (ARCHITECTURE.md, *Artwork*, has why); `source` is the cover itself where there is one to send.
struct PlaylistArtworkRead {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    std::optional<std::string> libraryPath;
    ArtworkSource source;
};

using PlaylistRowArtworkReader =
    std::function<PlaylistArtworkRead(const std::string& playlistId, uint32_t row)>;

// What GET /api/track/library has to decide from: `outcome` carries the failures only the
// player can answer, and `held` is false where the snapshot has no track at that address.
struct LibraryTrackRead {
    PlaylistOutcome outcome = PlaylistOutcome::done;
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

struct PlayingTrackRead {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    bool playing = false;
    std::string path;
    uint32_t subsong = 0;
    std::vector<std::string> columns;
};

using PlayingTrackReader =
    std::function<PlayingTrackRead(const std::vector<std::string>& columns)>;

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

enum class Transport { PlayPause, Next, Previous, Stop };
enum class VolumeStep { Up, Down };
using TransportCommander = std::function<PlaylistOutcome(Transport)>;
using PlaybackSeeker = std::function<PlaylistOutcome(double seconds, bool relative)>;
// `index` is a position in Player::playbackOrders.
using PlaybackOrderSetter = std::function<PlaylistOutcome(size_t index)>;
using VolumeSetter = std::function<PlaylistOutcome(double level)>;
using VolumeStepper = std::function<PlaylistOutcome(VolumeStep)>;
using MuteSetter = std::function<PlaylistOutcome(bool muted)>;

// See ARCHITECTURE.md, *The seams*: src/fb2k/ supplies every one of these, and a null
// callback is how an install that switched a feature off says so.
struct Player {
    TagWriter writeTags;
    PlaylistLister listPlaylists;
    PlaylistRowReader readPlaylistRows;
    PlaylistChangeReader readChangedPlaylistRows;
    PlaylistRowPlayer playPlaylistRow;
    TransportCommander commandTransport;
    PlaybackSeeker seek;
    PlaybackOrderSetter setPlaybackOrder;
    VolumeSetter setVolume;
    VolumeStepper stepVolume;
    MuteSetter setMuted;
    QueueReader readQueue;
    PlaylistRowQueuer queuePlaylistRows;
    LibraryTrackQueuer queueLibraryTracks;
    MoveQueueEntry moveQueueEntry;
    RemoveQueueEntry removeQueueEntry;
    ClearQueue clearQueue;
    AutoPlaylistCreator createAutoPlaylist;
    AutoPlaylistUpdater updateAutoPlaylist;
    AutoPlaylistRemover removeAutoPlaylist;
    OwnPlaylistResolver ownPlaylist;
    PlaylistCreator createPlaylist;
    PlaylistRenamer renamePlaylist;
    PlaylistRemover removePlaylist;
    PlaylistMover movePlaylist;
    PlaylistRowCopier copyPlaylistRows;
    PlaylistRowRemover removePlaylistRows;
    PlaylistFiller fill;
    OwnPlaylistEmptier emptyOwnPlaylist;
    QueryPreviewer previewQuery;
    StreamOpener openStream;

    // Which formats openStream will accept, best first. Empty means no streaming.
    std::vector<std::string> streamFormats;

    // An empty playerName or playerVersion, or an equal volumeMin/volumeMax, is how a null
    // Player{} in a test says it carries no report; a real one always fills them.
    std::string playerName;
    std::string playerVersion;
    double volumeMin = 0;
    double volumeMax = 0;
    std::string volumeUnit;

    // The player's own listing of its playback orders, in its own order. Extensible: a
    // component can add one, so a name missing from core/playback_modes.h is expected rather
    // than a defect.
    std::vector<std::string> playbackOrders;

    // Already rendered: the stream clock and the marks agree only at the moment they are
    // read together.
    TimelineReader readTimeline;

    std::function<bool()> outputHeld;

    std::function<void()> releaseOutput;

    // Walks the player's media library and replaces the snapshot with one built from
    // exactly these columns. Slow, and rate limited.
    LibraryRefresher refreshLibrary;

    ArtworkReader readArtwork;
    PlaylistRowArtworkReader readPlaylistRowArtwork;
    LibraryTrackReader readLibraryTrack;
    LibraryOrdinalReader readLibraryOrdinal;
    PlayingTrackReader readPlayingTrack;
    PageReader readPage;

    std::vector<std::string> pageNames;

    DiskPageReader readDiskPage;
};

class HttpServer {
public:
    // `audience`, `library`, `playerState` and `nowPlayingArtwork` outlive the server: a
    // connection unwinds through the first as it closes, and reads the other three from a
    // connection thread. A null `library` is how an install with the feature off says so, and
    // every library route then answers 503. A null `playerState` is answered from a stopped
    // default, because a player report is never optional: GET /state carries one on every 200
    // it gives. A null `nowPlayingArtwork` is read the same as one holding nothing yet.
    HttpServer(Settings settings, Audience& audience, Player player = {}, TicketMint mint = {},
               Library* library = nullptr, PlayerStateStore* playerState = nullptr,
               NowPlayingArtwork* nowPlayingArtwork = nullptr);
    ~HttpServer();

    // Call once.
    ListenerStatus start();

    // Idempotent, and safe to call from the main thread during shutdown.
    void stop();

    void openPairingWindow();
    void closePairingWindow();

    struct PairingState {
        bool open = false;
        int remainingSeconds = 0;
        std::vector<PairingWindow::Record> history;
    };

    PairingState pairingState() const;

    HttpServer(const HttpServer&) = delete;
    HttpServer& operator=(const HttpServer&) = delete;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace jean
