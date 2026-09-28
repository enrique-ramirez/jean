#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/player.h"

// The player's output devices: listing them and switching between them.
namespace jean {

// Neither route is rate limited: a device switch is a deliberate act nobody repeats in a burst,
// unlike a playlist edit. Which device is playing rides GET /api/state instead of these routes'
// own answers, so a switch made here writes nothing to PlayerState: it reaches a client through
// the same output callback a switch made at the player does.
class OutputRoutes {
public:
    OutputRoutes(const OutputCalls& outputs, const LiveSettings& settings);

    void addTo(httplib::Server& server);

private:
    void setActive(const httplib::Request& req, httplib::Response& res);

    const OutputCalls& outputs_;
    const LiveSettings& settings_;
};

}  // namespace jean
