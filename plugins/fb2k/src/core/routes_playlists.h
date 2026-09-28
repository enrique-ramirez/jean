#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/json.h"
#include "core/library.h"
#include "core/player.h"
#include "core/rate_limit.h"

#include <optional>
#include <string>

// Every playlist the player holds: the listing, a playlist's rows and the edits to them, and the
// component's own playlists, addressed by role.
namespace jean {

class PlaylistRoutes {
public:
    // `changes` is the one budget playlist and queue edits share.
    PlaylistRoutes(const PlaylistCalls& playlists, const Library* library,
                   const LiveSettings& settings, Throttle& changes);

    void addTo(httplib::Server& server);

private:
    void addListRoutes(httplib::Server& server);
    void addRowRoutes(httplib::Server& server);
    void addOwnPlaylistRoutes(httplib::Server& server);

    void create(const httplib::Request& req, httplib::Response& res);
    void fill(const httplib::Request& req, httplib::Response& res);
    void fillOwn(const httplib::Request& req, httplib::Response& res);

    std::optional<NewPlaylistRows> newPlaylistRows(const JsonObject& body,
                                                   httplib::Response& res) const;

    bool ownPlaylistRefused(const std::string& id, httplib::Response& res) const;

    const PlaylistCalls& playlists_;
    const Library* const library_;
    const LiveSettings& settings_;
    Throttle& changes_;
};

}  // namespace jean
