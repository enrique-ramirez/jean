#pragma once

#include "third_party/httplib.h"

#include "core/documents.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/library_roles.h"
#include "core/player.h"
#include "core/rate_limit.h"
#include "core/routes_library.h"

#include <string>
#include <vector>

namespace jean {

class PlaylistRowRoutes {
public:
    PlaylistRowRoutes(const PlaylistCalls& playlists, const Library* library,
                      const LiveSettings& settings, Throttle& changes, LibraryRoutes& libraryRoutes,
                      const RateLimitClock& clock);

    void addTo(httplib::Server& server);

private:
    void fill(const httplib::Request& req, httplib::Response& res);

    bool ownPlaylistRefused(const std::string& id, httplib::Response& res) const;

    bool readingRowsTooFast(const httplib::Request& req, httplib::Response& res);

    const PlaylistCalls& playlists_;
    const Library* const library_;
    const LiveSettings& settings_;
    Throttle& changes_;
    LibraryRoutes& libraryRoutes_;
    PerClientRateLimiter rowReads_;
    const RateLimitClock clock_;
};

}  // namespace jean
