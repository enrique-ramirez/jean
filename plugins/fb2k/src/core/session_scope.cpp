#include "core/session_scope.h"

#include "core/device.h"
#include "core/http_responses.h"

namespace jean {

SessionScope sessionScopeOf(const httplib::Request& req) {
    SessionScope scope;
    scope.session = req.get_param_value("session");
    scope.deviceId = sanitised(DeviceIdentity{req.get_param_value("deviceId"), {}}).id;
    return scope;
}

SessionAnswer scopedSession(const SessionScope& scope, httplib::Response& res,
                            SessionRegistry& sessions, SessionRegistry::Clock::time_point now,
                            Naming naming) {
    // Answered without the registry, whose find() sweeps first and can join a reaped session's
    // decoder inside the player's own transport.
    if (scope.session.empty() || scope.session == kEngineSessionId)
        return {SessionAnswer::Which::engine, nullptr};

    auto found = sessions.find(scope.session, scope.deviceId, now, naming);
    if (found.which == SessionAnswer::Which::none)
        respondUnknownSession(res);
    return found;
}

SessionAnswer commandedSession(const httplib::Request& req, httplib::Response& res,
                               SessionRegistry& sessions, SessionRegistry::Clock::time_point now,
                               const Settings& settings) {
    auto named = scopedSession(sessionScopeOf(req), res, sessions, now);
    if (named.which == SessionAnswer::Which::engine && playbackRefused(settings, res))
        return {};
    return named;
}

}  // namespace jean
