#pragma once

#include "core/artwork.h"
#include "core/audience.h"
#include "core/documents.h"
#include "core/library.h"
#include "core/player.h"
#include "core/player_state.h"
#include "core/rate_limit.h"
#include "core/reload.h"
#include "core/settings.h"
#include "core/stream_ticket.h"

#include <cstddef>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace httplib {
class TaskQueue;
}

namespace jean {

struct ListenerStatus {
    bool listening = false;

    std::string error;

    // Separate because it is the one failure with a specific remedy.
    bool portInUse = false;

    // After a wildcard bind where the operating system's bind is not exclusive: another program
    // can bind one of this machine's addresses on the port and take the connections to it.
    bool portIsShared = false;

    std::vector<std::string> heldAddresses;
};

std::string heldAddressError(const std::vector<std::string>& heldAddresses, int port);

std::string sharedPortNotice(int port);

constexpr size_t kMaxBodyBytes = size_t{256} * 1024;

// Each connection is served on a pool thread: `threads` start with the server, the pool
// grows to `maxThreads` while every one is busy, and a connection accepted past that waits in a
// queue at most `queued` deep. One accepted past the queue is closed unanswered.
struct ConnectionPool {
    size_t threads = 0;
    size_t maxThreads = 0;
    size_t queued = 0;
};

ConnectionPool connectionPoolFor(unsigned hardwareThreads);

// The one place the connection queue is built: `HttpServer` installs it through `new_task_queue`
// and the burst test drives it, so both run the same sizing. The caller owns it.
httplib::TaskQueue* connectionQueueFor(const ConnectionPool& pool);

// Swapped whole on a reload, so a handler that takes one copy at the top of its own run never
// sees a Settings with some fields from the file and some from before it.
class LiveSettings {
public:
    explicit LiveSettings(Settings settings);

    std::shared_ptr<const Settings> current() const;

    void replace(Settings next);

private:
    mutable std::mutex lock_;
    std::shared_ptr<const Settings> current_;
};

class HttpServer {
public:
    // `audience`, `library`, `playerState` and `nowPlayingArtwork` outlive the server: a
    // connection unwinds through the first as it closes, and reads the other three from a
    // connection thread. A null `library` is how an install with the feature off says so, and
    // every library route then answers 503. A null `playerState` is answered from a stopped
    // default, because a player report is never optional: GET /state carries one on every 200
    // it gives. A null `nowPlayingArtwork` is read the same as one holding nothing yet.
    HttpServer(Settings settings, Audience& audience, Player player = {}, TicketMint mint = {},
               Library* library = nullptr, PlayerStateStore* playerState = nullptr,
               NowPlayingArtwork* nowPlayingArtwork = nullptr,
               const RateLimitClock& rateLimitClock = steadyNow);
    ~HttpServer();

    // Call once.
    ListenerStatus start();

    // Idempotent, and safe to call from the main thread during shutdown.
    void stop();

    // Safe to call from any thread; a request already in flight keeps whatever snapshot it
    // already took.
    void applyReload(const ReloadDecision& decision);

    HttpServer(const HttpServer&) = delete;
    HttpServer& operator=(const HttpServer&) = delete;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace jean
