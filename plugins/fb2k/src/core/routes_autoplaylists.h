#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/player.h"
#include "core/playlists.h"
#include "core/rate_limit.h"

#include <functional>
#include <optional>

// Autoplaylists: a query tried without creating anything, and the playlists foobar2000 keeps
// filled from one.
namespace jean {

class AutoPlaylistRoutes {
public:
    // `changes` is the budget every playlist edit shares.
    AutoPlaylistRoutes(const AutoPlaylistCalls& autoPlaylists, const LiveSettings& settings,
                       Throttle& changes, const RateLimitClock& clock);

    void addTo(httplib::Server& server);

private:
    std::optional<PlaylistResult> attempt(httplib::Response& res,
                                          const AutoPlaylistRequest& request,
                                          const std::function<PlaylistResult()>& ask);

    const AutoPlaylistCalls& autoPlaylists_;
    const LiveSettings& settings_;
    Throttle& changes_;
    Throttle previews_;
};

}  // namespace jean
