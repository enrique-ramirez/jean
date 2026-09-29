#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/library.h"
#include "core/player.h"
#include "core/rate_limit.h"

// The component's own playlists, addressed by role rather than by id: filling one and emptying
// it.
namespace jean {

class OwnPlaylistRoutes {
public:
    // `changes` is the one budget playlist and queue edits share.
    OwnPlaylistRoutes(const PlaylistCalls& playlists, const Library* library,
                      const LiveSettings& settings, Throttle& changes);

    void addTo(httplib::Server& server);

private:
    void fill(const httplib::Request& req, httplib::Response& res);
    void empty(const httplib::Request& req, httplib::Response& res);

    const PlaylistCalls& playlists_;
    const Library* const library_;
    const LiveSettings& settings_;
    Throttle& changes_;
};

}  // namespace jean
