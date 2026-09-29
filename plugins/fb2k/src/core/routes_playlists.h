#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/json.h"
#include "core/library.h"
#include "core/player.h"
#include "core/rate_limit.h"

#include <optional>

// The player's list of playlists: reading it, and creating, renaming, removing and moving one.
namespace jean {

class PlaylistRoutes {
public:
    // `changes` is the one budget playlist and queue edits share.
    PlaylistRoutes(const PlaylistCalls& playlists, const Library* library,
                   const LiveSettings& settings, Throttle& changes);

    void addTo(httplib::Server& server);

private:
    void create(const httplib::Request& req, httplib::Response& res);

    std::optional<NewPlaylistRows> newPlaylistRows(const JsonObject& body,
                                                   httplib::Response& res) const;

    const PlaylistCalls& playlists_;
    const Library* const library_;
    const LiveSettings& settings_;
    Throttle& changes_;
};

}  // namespace jean
