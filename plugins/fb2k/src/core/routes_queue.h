#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/json.h"
#include "core/library.h"
#include "core/player.h"
#include "core/player_state.h"
#include "core/rate_limit.h"

#include <cstdint>

// The play queue: reading it, and queueing, moving, removing and clearing entries.
namespace jean {

class QueueRoutes {
public:
    // `changes` is the one budget playlist and queue edits share. A null `playerState` reads
    // as revision 0, the revision of a fresh queue with nothing to name.
    QueueRoutes(const QueueCalls& queue, const Library* library,
                const PlayerStateStore* playerState, const LiveSettings& settings,
                Throttle& changes);

    void addTo(httplib::Server& server);

private:
    void queuePlaylistRows(const JsonObject& body, httplib::Response& res);
    void queueLibraryTracks(const JsonObject& body, httplib::Response& res);

    bool queueMoved(uint64_t revision, httplib::Response& res) const;

    const QueueCalls& queue_;
    const Library* const library_;
    const PlayerStateStore* const playerState_;
    const LiveSettings& settings_;
    Throttle& changes_;
};

}  // namespace jean
