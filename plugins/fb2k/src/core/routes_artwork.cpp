#include "core/routes_artwork.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/requests_playlists.h"

#include <chrono>
#include <string>

namespace jean {

namespace {

// A screenful of covers arrives at once and that is the feature, so the burst is deep and
// what it bounds is a client stuck in a loop turning into a queue of disk reads.
constexpr int kArtworkBurst = 300;
constexpr auto kArtworkRefill = std::chrono::milliseconds(50);

constexpr int kSecondsPerDay = 24 * 60 * 60;

// See ARCHITECTURE.md, *Artwork*, for why these two and kAskEveryTime are what they are.
constexpr int kCoverCacheLifetimeSeconds = 180 * kSecondsPerDay;
constexpr int kMissingCoverCacheLifetimeSeconds = 10 * 60;

std::string freshFor(int seconds) {
    return "private, max-age=" + std::to_string(seconds);
}

// What sendArtwork answers with on a 200 or a 304 (present), and on its own 404 or 413 (refused).
struct ArtworkCacheControl {
    std::string present;
    std::string refused;
};

void sendArtwork(const httplib::Request& req, httplib::Response& res, const ArtworkSource& source,
                 const ArtworkCacheControl& caching) {
    if (alreadyHolds(req, source.tag)) {
        res.set_header("Cache-Control", caching.present);
        res.set_header("ETag", source.tag);
        res.status = 304;
        return;
    }

    if (source.picture.size() > kMaxArtworkBytes) {
        res.set_header("Cache-Control", caching.refused);
        respondError(res, 413, kArtworkTooLarge);
        return;
    }

    const auto type = imageTypeOf(source.picture);
    if (type.empty()) {
        res.set_header("Cache-Control", caching.refused);
        respondError(res, 404, kUnpublishableArtwork);
        return;
    }

    res.set_header("Cache-Control", caching.present);
    res.set_header("ETag", source.tag);
    res.status = 200;
    res.set_content(source.picture, type);
}

}  // namespace

ArtworkRoutes::ArtworkRoutes(const LibraryCalls& library, const PlaylistCalls& playlists,
                             const NowPlayingArtwork* nowPlaying, const RateLimitClock& clock)
    : library_(library),
      playlists_(playlists),
      nowPlaying_(nowPlaying),
      reads_(kArtworkBurst, kArtworkRefill,
             "refusing artwork reads: they are arriving faster than this component will answer "
             "them, which usually means a client is looping",
             clock) {}

bool ArtworkRoutes::fetchingTooFast(httplib::Response& res) {
    if (!reads_.refuses())
        return false;

    respondTooFast(res, reads_, errorDocument(kFetchingArtworkTooFast));
    return true;
}

void ArtworkRoutes::addTo(httplib::Server& server) {
    server.Get("/api/artwork", [this](const httplib::Request& req, httplib::Response& res) {
        const auto track = req.get_param_value("track");

        if (const auto refusal = trackAddressRefusal(track); !refusal.empty()) {
            respondError(res, 400, refusal);
            return;
        }

        if (!library_.readArtwork) {
            respondUnavailable(res, kNoArtwork);
            return;
        }

        if (fetchingTooFast(res))
            return;

        const auto source = library_.readArtwork(track);
        const auto missingCoverCacheControl = freshFor(kMissingCoverCacheLifetimeSeconds);

        if (source.picture.empty()) {
            res.set_header("Cache-Control", missingCoverCacheControl);
            respondError(res, 404, kNoArtworkForTrack);
            return;
        }

        sendArtwork(req, res, source,
                    {freshFor(kCoverCacheLifetimeSeconds), missingCoverCacheControl});
    });

    // The picture is held rather than looked up, so a conditional request never reaches the
    // player or a file: it costs a comparison of two strings.
    server.Get("/api/artwork/playing", [this](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Cache-Control", kAskEveryTime);

        if (fetchingTooFast(res))
            return;

        const auto source = nowPlaying_ ? nowPlaying_->current() : ArtworkSource{};
        if (source.picture.empty()) {
            respondError(res, 404, kNoArtworkForTrack);
            return;
        }

        sendArtwork(req, res, source, {kAskEveryTime, kAskEveryTime});
    });

    // The fallback for a row GET /api/artwork cannot address: no path reaches the client, so
    // the player resolves the playlist and the row to a handle itself, behind every refusal, the
    // rate limit and the response shape the two routes above already answer with.
    constexpr char kPlaylistRowArtworkPath[] = R"(/api/artwork/playlists/([0-9a-f-]{36})/([^/]+))";

    server.Get(kPlaylistRowArtworkPath,
               [this](const httplib::Request& req, httplib::Response& res) {
                   res.set_header("Cache-Control", kAskEveryTime);

                   const auto request = parsePlayRow(req.matches[1].str(), req.matches[2].str());
                   if (!request.ok()) {
                       respondRefusal(res, request.refusal);
                       return;
                   }

                   if (!playlists_.readRowArtwork) {
                       respondUnavailable(res, kNoArtwork);
                       return;
                   }

                   if (fetchingTooFast(res))
                       return;

                   const auto read = playlists_.readRowArtwork(request.playlistId, request.index);

                   // Both refused as 404, unlike POST .../play: neither is a position a client
                   // could choose differently, and a client drawing a grid of covers treats every
                   // one the same as a track address the snapshot never held.
                   if (read.outcome == PlayerOutcome::noSuchPlaylist ||
                       read.outcome == PlayerOutcome::positionPastEnd) {
                       respondError(res, 404, describe(read.outcome));
                       return;
                   }

                   if (read.outcome != PlayerOutcome::done) {
                       respondError(res, httpStatusFor(read.outcome), describe(read.outcome));
                       return;
                   }

                   if (read.libraryPath || read.source.picture.empty()) {
                       respondError(res, 404, kNoArtworkForTrack);
                       return;
                   }

                   sendArtwork(req, res, read.source, {kAskEveryTime, kAskEveryTime});
               });
}

}  // namespace jean
