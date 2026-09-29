#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/library.h"
#include "core/player.h"
#include "core/rate_limit.h"

#include <string>

// A playlist's rows: a page of them, the ones that changed, and filling, copying into and
// removing from a playlist addressed by its id.
namespace jean {

class PlaylistRowRoutes {
public:
    // `changes` is the one budget playlist and queue edits share.
    PlaylistRowRoutes(const PlaylistCalls& playlists, const Library* library,
                      const LiveSettings& settings, Throttle& changes);

    void addTo(httplib::Server& server);

private:
    void fill(const httplib::Request& req, httplib::Response& res);

    bool ownPlaylistRefused(const std::string& id, httplib::Response& res) const;

    const PlaylistCalls& playlists_;
    const Library* const library_;
    const LiveSettings& settings_;
    Throttle& changes_;
};

}  // namespace jean
