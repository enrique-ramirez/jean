#include "core/routes_sessions.h"

#include "core/device.h"
#include "core/failures.h"
#include "core/http_responses.h"
#include "core/requests_sessions.h"
#include "core/session_order.h"
#include "core/session_scope.h"

#include <algorithm>
#include <iterator>
#include <utility>
#include <vector>

namespace jean {

namespace {

constexpr char kSessionById[] = R"(/api/sessions/([^/]+))";

}  // namespace

void nameTurn(Session& session, const SessionTrackReader& readTrack) {
    if (!readTrack)
        return;

    const auto turn = session.unnamedTurn();
    if (!turn)
        return;

    const auto read = readTrack(turn->track, {});
    if (read.outcome != PlayerOutcome::done || !read.named)
        return;

    session.named(turn->serial, read.title, read.artist, read.album, read.albumArtist,
                  read.duration);
}

SessionView SessionRoutes::detachedView(Session& session, Session::Clock::time_point now) const {
    nameTurn(session, sessions_.readTrack);

    const Audience& audience = session.audience();

    SessionView view;
    view.id = session.id();
    view.detached = true;
    view.shared = session.shared();
    view.state = session.state(now);
    view.listeners = audience.roster(audience.now()).size();
    view.playbackModes = sessionPlaybackModes();
    view.chainDropped = session.chainDropped();
    view.reports = session.reports();
    view.createdBy = session.createdBy();
    return view;
}

SessionRoutes::SessionRoutes(SessionRegistry& registry, const Audience& engineAudience,
                             const PlayerReport& report, const PlayerStateStore* playerState,
                             const SessionCalls& sessions, const LiveSettings& settings,
                             const std::vector<std::string>& streamFormats,
                             SessionCapacity capacity, RateLimitClock clock)
    : registry_(registry),
      engineAudience_(engineAudience),
      report_(report),
      playerState_(playerState),
      sessions_(sessions),
      settings_(settings),
      streamFormats_(streamFormats),
      capacity_(capacity),
      clock_(std::move(clock)) {}

SessionView SessionRoutes::engineView() const {
    SessionView view;
    view.id = kEngineSessionId;
    view.shared = true;
    view.state = playerState_ ? playerState_->read().state : PlayerState{};
    view.listeners = engineAudience_.roster(engineAudience_.now()).size();
    view.playbackModes = playbackModesOf(report_.playbackOrders);
    return view;
}

void SessionRoutes::addTo(httplib::Server& server) {
    server.Post("/api/sessions",
                [this](const httplib::Request& req, httplib::Response& res) { create(req, res); });

    server.Get("/api/sessions",
               [this](const httplib::Request& req, httplib::Response& res) { list(req, res); });

    server.Get(kSessionById,
               [this](const httplib::Request& req, httplib::Response& res) { read(req, res); });

    server.Post(kSessionById,
                [this](const httplib::Request& req, httplib::Response& res) { change(req, res); });
}

void SessionRoutes::create(const httplib::Request& req, httplib::Response& res) {
    DeviceIdentity asked;
    if (!readDeviceIdentity(req, res, asked))
        return;

    const DeviceIdentity creator = sanitised(asked);
    if (creator.id.empty()) {
        respondError(res, 400, kDeviceIdRequired);
        return;
    }

    if (!canCreateSessions(*settings_.current(), streamFormats_, capacity_)) {
        respondUnavailable(res, kNoSessions);
        return;
    }

    const auto now = clock_();
    const auto created = registry_.create(creator, now);

    switch (created.how) {
        case SessionCreation::created:
            respond(res, 200, sessionDocument(detachedView(*created.session, now)));
            return;
        case SessionCreation::atTheCap:
            respondUnavailable(res, kTooManySessions);
            return;
        case SessionCreation::noId:
        case SessionCreation::noStream:
            respondUnavailable(res, kNoSessions);
            return;
    }
}

void SessionRoutes::list(const httplib::Request& req, httplib::Response& res) {
    const auto scope = sessionScopeOf(req);
    const auto now = clock_();
    const auto visible = registry_.list(scope.deviceId, now);

    std::vector<SessionView> views{engineView()};
    std::transform(visible.begin(), visible.end(), std::back_inserter(views),
                   [this, now](const auto& session) { return detachedView(*session, now); });

    respond(res, 200, sessionsDocument(views));
}

void SessionRoutes::read(const httplib::Request& req, httplib::Response& res) {
    const auto scope = sessionScopeOf(req);
    const auto now = clock_();
    const auto found = registry_.find(req.matches[1].str(), scope.deviceId, now);

    switch (found.which) {
        case SessionAnswer::Which::none:
            respondUnknownSession(res);
            return;
        case SessionAnswer::Which::engine:
            respond(res, 200, sessionDocument(engineView()));
            return;
        case SessionAnswer::Which::detached:
            respond(res, 200, sessionDocument(detachedView(*found.session, now)));
            return;
    }
}

// The order is the refusal a client may learn from: the engine before anything is read, and a
// session this device may not see before its body, so a 400 never tells a stranger an id is live.
void SessionRoutes::change(const httplib::Request& req, httplib::Response& res) {
    const auto id = req.matches[1].str();
    if (id == kEngineSessionId) {
        respondError(res, 409, kEngineSessionUnchangeable);
        return;
    }

    const auto scope = sessionScopeOf(req);
    if (scope.deviceId.empty()) {
        respondError(res, 400, kDeviceIdRequired);
        return;
    }

    const auto now = clock_();
    if (registry_.find(id, scope.deviceId, now).which != SessionAnswer::Which::detached) {
        respondUnknownSession(res);
        return;
    }

    const auto request = parseSharing(req.body);
    if (!request.ok()) {
        respondError(res, 400, request.refusal);
        return;
    }

    // A reap or a quit can take the session between the find above and the share, or after it.
    if (registry_.share(id, scope.deviceId, request.shared, now) != SessionShare::done) {
        respondUnknownSession(res);
        return;
    }

    const auto changed = registry_.find(id, scope.deviceId, now);
    if (!changed.session) {
        respondUnknownSession(res);
        return;
    }

    respond(res, 200, sessionDocument(detachedView(*changed.session, now)));
}

}  // namespace jean
