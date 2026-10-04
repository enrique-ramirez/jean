#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/library.h"
#include "core/player.h"
#include "core/rate_limit.h"
#include "core/session_registry.h"

#include <string>
#include <vector>

namespace jean {

class PlaybackRoutes {
public:
    PlaybackRoutes(const PlaybackCalls& playback, const SessionCalls& sessions,
                   SessionRegistry& registry, const Library* library, const PlayerReport& report,
                   const LiveSettings& settings, const RateLimitClock& clock);

    void addTo(httplib::Server& server);

private:
    void addTransportRoute(httplib::Server& server, const char* path, Transport command);
    void addVolumeRoute(httplib::Server& server);
    void addPlayingTrackRoute(httplib::Server& server);
    bool readingPlayingTrackTooFast(httplib::Response& res);
    void readSessionTrack(const Session& session, const std::vector<std::string>& columns,
                          httplib::Response& res);

    SessionAnswer commandedSession(const httplib::Request& req, httplib::Response& res);

    void seek(const httplib::Request& req, httplib::Response& res);
    void setMode(const httplib::Request& req, httplib::Response& res);
    void playRow(const httplib::Request& req, httplib::Response& res);
    void playRowIn(Session& session, const std::string& playlistId, uint32_t index,
                   httplib::Response& res);
    void playSet(const httplib::Request& req, httplib::Response& res);

    const PlaybackCalls& playback_;
    const SessionCalls& sessions_;
    SessionRegistry& registry_;
    const Library* const library_;
    const PlayerReport& report_;
    const LiveSettings& settings_;
    const RateLimitClock clock_;

    Throttle playingTrackReads_;
};

}  // namespace jean
