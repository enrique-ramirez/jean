#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/json.h"
#include "core/library.h"
#include "core/library_questions.h"
#include "core/library_roles.h"
#include "core/player.h"
#include "core/player_state.h"
#include "core/rate_limit.h"
#include "core/session_registry.h"

#include <cstdint>
#include <functional>
#include <optional>

// The play queue: reading it, and queueing, moving, removing and clearing entries.
namespace jean {

class QueueRoutes {
public:
    // `changes` is the one budget playlist and queue edits share. A null `playerState` reads
    // as revision 0, the revision of a fresh queue with nothing to name.
    QueueRoutes(const QueueCalls& queue, const SessionCalls& sessions, SessionRegistry& registry,
                const Library* library, LibraryQuestions& questions,
                const PlayerStateStore* playerState, const LiveSettings& settings,
                Throttle& changes, const RateLimitClock& clock);

    void addTo(httplib::Server& server);

private:
    SessionAnswer namedSession(const httplib::Request& req, httplib::Response& res);
    SessionAnswer commandedSession(const httplib::Request& req, httplib::Response& res);

    void queuePlaylistRows(Session* session, const JsonObject& body, httplib::Response& res);
    void queueLibraryTracks(Session* session, const JsonObject& body, httplib::Response& res);

    void readSessionQueue(const Session& session, const RolesAsked& roles, httplib::Response& res);
    void queueInSession(Session& session, std::optional<QueuePosition> at, size_t requestedCount,
                        const std::function<SessionTracksRead()>& take, httplib::Response& res);

    bool queueMoved(uint64_t revision, httplib::Response& res) const;

    const QueueCalls& queue_;
    const SessionCalls& sessions_;
    SessionRegistry& registry_;
    const Library* const library_;
    LibraryQuestions& questions_;
    const PlayerStateStore* const playerState_;
    const LiveSettings& settings_;
    Throttle& changes_;
    const RateLimitClock clock_;
};

}  // namespace jean
