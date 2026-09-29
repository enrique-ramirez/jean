#pragma once

#include "third_party/httplib.h"

#include "core/library.h"
#include "core/player.h"
#include "core/player_state.h"
#include "core/rate_limit.h"

#include <atomic>
#include <cstdint>
#include <string>

// GET /api/state: what the player is doing and which library generation it holds, ETagged and
// polled.
namespace jean {

class StateRoute {
public:
    // A null `library` is answered as a library not built, a null `playerState` as a stopped
    // player, and a null `checkMainThread` as a main thread answering: GET /state carries a
    // player report on every 200 it gives.
    StateRoute(const Library* library, const PlayerStateStore* playerState,
               const std::atomic<uint64_t>& configGeneration, uint64_t runId, RateLimitClock clock,
               MainThreadCheck checkMainThread);

    void addTo(httplib::Server& server);

private:
    bool pollingTooFast(httplib::Response& res, const std::string& client);

    const Library* const library_;
    const PlayerStateStore* const playerState_;
    const std::atomic<uint64_t>& configGeneration_;
    const uint64_t runId_;
    const RateLimitClock clock_;
    const MainThreadCheck checkMainThread_;

    PerClientRateLimiter polls_;
    OncePerBurst complaints_;
};

}  // namespace jean
