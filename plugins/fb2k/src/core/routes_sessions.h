#pragma once

#include "third_party/httplib.h"

#include "core/audience.h"
#include "core/documents.h"
#include "core/http_server.h"
#include "core/player.h"
#include "core/player_state.h"
#include "core/rate_limit.h"
#include "core/session.h"
#include "core/session_registry.h"

#include <string>
#include <vector>

namespace jean {

void nameTurn(Session& session, const SessionTrackReader& readTrack);

class SessionRoutes {
public:
    SessionRoutes(SessionRegistry& registry, const Audience& engineAudience,
                  const PlayerReport& report, const PlayerStateStore* playerState,
                  const SessionCalls& sessions, const LiveSettings& settings,
                  const std::vector<std::string>& streamFormats, SessionCapacity capacity,
                  RateLimitClock clock);

    void addTo(httplib::Server& server);

private:
    void create(const httplib::Request& req, httplib::Response& res);
    void list(const httplib::Request& req, httplib::Response& res);
    void read(const httplib::Request& req, httplib::Response& res);
    void change(const httplib::Request& req, httplib::Response& res);

    SessionView engineView() const;
    SessionView detachedView(Session& session, Session::Clock::time_point now) const;

    SessionRegistry& registry_;
    const Audience& engineAudience_;
    const PlayerReport& report_;
    const PlayerStateStore* const playerState_;
    const SessionCalls& sessions_;
    const LiveSettings& settings_;
    const std::vector<std::string>& streamFormats_;
    const SessionCapacity capacity_;
    const RateLimitClock clock_;
};

}  // namespace jean
