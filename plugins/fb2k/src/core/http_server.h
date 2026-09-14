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

// Where the rows an insert asked for landed, in the order they were inserted, and beefweb's
// id for the playlist they landed in as of the write. Empty where beefweb has not mapped
// that playlist yet, exactly as PlaylistAnnotation.beefwebId reports it.
struct FillResult {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    std::vector<size_t> positions;
    std::string beefwebId;
};

// Resolves `ordinals` against the snapshot built for `structure`, in the order given, and
// inserts the tracks they name into `playlistId`, emptying it first when `replace` is set.
// Whether the write is permitted is decided before this is called; this callback is never
// asked to weigh in. `title` renames the playlist in the same main-thread work item that
// checks the generation, so a refusal never lands ahead of the rows it refused; an empty
// `title` is a user's playlist saying it is not this component's to rename.
using PlaylistFiller =
    std::function<FillResult(const std::string& playlistId, const std::string& title,
                             uint64_t structure, const std::vector<uint32_t>& ordinals,
                             bool replace)>;

// Empties `role`'s own playlist and leaves the playlist itself standing. Takes no structure
// and no ordinals: there is nothing here to resolve against the library, unlike a fill. A
// role with no playlist yet is a quiet success rather than one made to answer this.
using OwnPlaylistEmptier = std::function<PlaylistResult(OwnPlaylistRole role)>;

// See ARCHITECTURE.md, *The seams*: src/fb2k/ supplies every one of these, and a null
// callback is how an install that switched a feature off says so.
struct Player {
    TagWriter writeTags;
    PlaylistLister listPlaylists;
    AutoPlaylistCreator createAutoPlaylist;
    AutoPlaylistUpdater updateAutoPlaylist;
    AutoPlaylistRemover removeAutoPlaylist;
    OwnPlaylistResolver ownPlaylist;
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
};

class HttpServer {
public:
    // `audience`, `library` and `playerState` outlive the server: a connection unwinds through
    // the first as it closes, and reads the other two from a connection thread. A null
    // `library` is how an install with the feature off says so, and every library route then
    // answers 503. A null `playerState` is answered from a stopped default, because a player
    // report is never optional: GET /state carries one on every 200 it gives.
    HttpServer(Settings settings, Audience& audience, Player player = {}, TicketMint mint = {},
               Library* library = nullptr, PlayerStateStore* playerState = nullptr);
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
