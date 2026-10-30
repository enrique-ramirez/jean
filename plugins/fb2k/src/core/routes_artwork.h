#pragma once

#include "third_party/httplib.h"

#include "core/artwork.h"
#include "core/player.h"
#include "core/rate_limit.h"
#include "core/session_registry.h"

// Covers: by library path, for whatever is playing, and for a playlist row the library holds no
// path for. See ARCHITECTURE.md, *Artwork*.
namespace jean {

class ArtworkRoutes {
public:
    // A null `nowPlaying` is read the same as one holding nothing yet.
    ArtworkRoutes(const LibraryCalls& library, const PlaylistCalls& playlists,
                  const SessionCalls& sessions, SessionRegistry& registry,
                  const NowPlayingArtwork* nowPlaying, const RateLimitClock& clock);

    void addTo(httplib::Server& server);

private:
    void sendPlaying(const httplib::Request& req, httplib::Response& res);

    const LibraryCalls& library_;
    const PlaylistCalls& playlists_;
    const SessionCalls& sessions_;
    SessionRegistry& registry_;
    const NowPlayingArtwork* const nowPlaying_;
    const RateLimitClock clock_;

    Throttle reads_;
};

}  // namespace jean
