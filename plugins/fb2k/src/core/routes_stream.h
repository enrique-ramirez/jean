#pragma once

#include "third_party/httplib.h"

#include "core/audience.h"
#include "core/http_server.h"
#include "core/player.h"
#include "core/rate_limit.h"
#include "core/session_registry.h"
#include "core/stream_ticket.h"

// The live encode of the player's output: tickets, the stream itself, who is listening, the
// timeline and the output hold.
namespace jean {

class StreamRoutes {
public:
    // `audience` and `registry` outlive the server: a connection unwinds through them as it
    // closes.
    StreamRoutes(const StreamCalls& stream, Audience& audience, SessionRegistry& registry,
                 const LiveSettings& settings, TicketMint mint, RateLimitClock clock);

    void addTo(httplib::Server& server);

private:
    bool streamingAvailable() const;
    const char* streamingRefusal() const;

    void issueTicket(const httplib::Request& req, httplib::Response& res);
    void listeners(const httplib::Request& req, httplib::Response& res);
    void leave(const httplib::Request& req, httplib::Response& res);
    void openStream(const httplib::Request& req, httplib::Response& res);

    const StreamCalls& stream_;
    Audience& audience_;
    SessionRegistry& registry_;
    const LiveSettings& settings_;
    const RateLimitClock clock_;
    TicketStore tickets_;
};

}  // namespace jean
