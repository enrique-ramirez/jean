#pragma once

#include "core/api.h"
#include "core/artwork.h"
#include "core/audience.h"
#include "core/library.h"
#include "core/player.h"
#include "core/player_state.h"
#include "core/reload.h"
#include "core/settings.h"
#include "core/stream_ticket.h"

#include <chrono>
#include <cstddef>
#include <functional>
#include <memory>

namespace jean {

constexpr size_t kMaxBodyBytes = size_t{256} * 1024;

// The one response too big for kMaxBodyBytes to say anything about, which bounds a request.
// A library of a quarter of a million tracks serialises to a few tens of megabytes, so this
// leaves room above that and still refuses before a client's memory is the thing that fails.
// It bounds the serialised body, before any content coding: gzip is what crosses the wire, and
// what a client has to hold once it has decoded is the number this caps.
constexpr size_t kMaxLibraryBytes = size_t{64} * 1024 * 1024;

// cpp-httplib serves each connection on a pool thread: `threads` start with the server, the pool
// grows to `maxThreads` while every one is busy, and a connection accepted past that waits in a
// queue at most `queued` deep. One accepted past the queue is closed unanswered.
struct ConnectionPool {
    size_t threads = 0;
    size_t maxThreads = 0;
    size_t queued = 0;
};

ConnectionPool connectionPoolFor(unsigned hardwareThreads);

using RateLimitClock = std::function<std::chrono::steady_clock::time_point()>;

inline std::chrono::steady_clock::time_point steadyNow() {
    return std::chrono::steady_clock::now();
}

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
               RateLimitClock rateLimitClock = steadyNow);
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
