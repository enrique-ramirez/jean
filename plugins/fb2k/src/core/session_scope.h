#pragma once

#include "third_party/httplib.h"

#include "core/session_registry.h"
#include "core/settings.h"

#include <string>

namespace jean {

struct SessionScope {
    std::string session;
    std::string deviceId;
};

SessionScope sessionScopeOf(const httplib::Request& req);

SessionAnswer scopedSession(const SessionScope& scope, httplib::Response& res,
                            SessionRegistry& sessions, SessionRegistry::Clock::time_point now,
                            Naming naming = Naming::passing);

SessionAnswer commandedSession(const httplib::Request& req, httplib::Response& res,
                               SessionRegistry& sessions, SessionRegistry::Clock::time_point now,
                               const Settings& settings);

}  // namespace jean
