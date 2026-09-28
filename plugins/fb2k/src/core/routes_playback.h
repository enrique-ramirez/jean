#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/player.h"
#include "core/rate_limit.h"

// Playback commands: transport, seeking, the playback mode, the volume, starting a playlist row,
// and reading the playing track.
namespace jean {

class PlaybackRoutes {
public:
    PlaybackRoutes(const PlaybackCalls& playback, const PlayerReport& report,
                   const LiveSettings& settings, const RateLimitClock& clock);

    void addTo(httplib::Server& server);

private:
    void addTransportRoute(httplib::Server& server, const char* path, Transport command);
    void addVolumeRoute(httplib::Server& server);
    void addPlayingTrackRoute(httplib::Server& server);

    void setMode(const httplib::Request& req, httplib::Response& res);

    const PlaybackCalls& playback_;
    const PlayerReport& report_;
    const LiveSettings& settings_;

    Throttle playingTrackReads_;
};

}  // namespace jean
