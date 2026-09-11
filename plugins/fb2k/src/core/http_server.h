#pragma once

#include "core/api.h"
#include "core/artwork.h"
#include "core/audience.h"
#include "core/library.h"
#include "core/pairing.h"
#include "core/settings.h"
#include "core/stream.h"
#include "core/stream_ticket.h"

#include <cstddef>
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

// See ARCHITECTURE.md, *The seams*: src/fb2k/ supplies every one of these, and a null
// callback is how an install that switched a feature off says so.
struct Player {
    TagWriter writeTags;
    PlaylistLister listPlaylists;
    AutoPlaylistCreator createAutoPlaylist;
    AutoPlaylistUpdater updateAutoPlaylist;
    AutoPlaylistRemover removeAutoPlaylist;
    QueryPreviewer previewQuery;
    StreamOpener openStream;

    // Which formats openStream will accept, best first. Empty means no streaming.
    std::vector<std::string> streamFormats;

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
    // `audience` and `library` outlive the server: a connection unwinds through the first as
    // it closes, and reads the second from a connection thread. A null `library` is how an
    // install with the feature off says so, and every library route then answers 503.
    HttpServer(Settings settings, Audience& audience, Player player = {}, TicketMint mint = {},
               Library* library = nullptr);
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
