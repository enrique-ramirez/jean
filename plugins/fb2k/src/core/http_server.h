#pragma once

#include "core/api.h"
#include "core/audience.h"
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

using TagWriter = std::function<TagWriteOutcome(const TagWrite&)>;
using PlaylistLister = std::function<PlaylistsResult()>;
using AutoPlaylistCreator = std::function<PlaylistResult(const AutoPlaylistSpec&)>;
using AutoPlaylistUpdater =
    std::function<PlaylistResult(const std::string& id, const AutoPlaylistSpec&)>;
using AutoPlaylistRemover = std::function<PlaylistResult(const std::string& id)>;
using QueryPreviewer = std::function<PreviewResult(const std::string& query)>;
using TimelineReader = std::function<std::string()>;

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
};

class HttpServer {
public:
    // `audience` outlives the server: a connection unwinds through it as it closes.
    HttpServer(Settings settings, Audience& audience, Player player = {}, TicketMint mint = {});
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
