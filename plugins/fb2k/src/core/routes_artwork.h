#pragma once

#include "third_party/httplib.h"

#include "core/artwork.h"
#include "core/player.h"
#include "core/rate_limit.h"

// Covers: by library path, for whatever is playing, and for a playlist row the library holds no
// path for. See ARCHITECTURE.md, *Artwork*.
namespace jean {

class ArtworkRoutes {
public:
    // A null `nowPlaying` is read the same as one holding nothing yet.
    ArtworkRoutes(const LibraryCalls& library, const PlaylistCalls& playlists,
                  const NowPlayingArtwork* nowPlaying, const RateLimitClock& clock);

    void addTo(httplib::Server& server);

private:
    bool fetchingTooFast(httplib::Response& res);

    const LibraryCalls& library_;
    const PlaylistCalls& playlists_;
    const NowPlayingArtwork* const nowPlaying_;

    Throttle reads_;
};

}  // namespace jean
