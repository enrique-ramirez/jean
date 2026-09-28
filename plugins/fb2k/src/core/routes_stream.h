#pragma once

#include "third_party/httplib.h"

#include "core/audience.h"
#include "core/http_server.h"
#include "core/player.h"
#include "core/stream_ticket.h"

// The live encode of the player's output: tickets, the stream itself, who is listening, the
// timeline and the output hold.
namespace jean {

class StreamRoutes {
public:
    // `audience` outlives the server: a connection unwinds through it as it closes.
    StreamRoutes(const StreamCalls& stream, Audience& audience, const LiveSettings& settings,
                 TicketMint mint);

    void addTo(httplib::Server& server);

private:
    bool streamingAvailable() const;
    const char* streamingRefusal() const;

    void openStream(const httplib::Request& req, httplib::Response& res);

    const StreamCalls& stream_;
    Audience& audience_;
    const LiveSettings& settings_;
    TicketStore tickets_;
};

}  // namespace jean
