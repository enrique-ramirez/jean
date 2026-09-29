#include "core/routes_state.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/log.h"

#include <chrono>
#include <utility>

namespace jean {

namespace {

constexpr int kPollBurst = 30;
constexpr auto kPollRefill = std::chrono::milliseconds(100);

constexpr char kRetryPollAfterSeconds[] = "1";

std::string buildTag(const Library::State& state) {
    if (!state.build)
        return {};

    return "-b" + std::to_string(static_cast<int>(state.build->phase)) + ":" +
           std::to_string(state.build->formatted) + "/" + std::to_string(state.build->total);
}

}  // namespace

StateRoute::StateRoute(const Library* library, const PlayerStateStore* playerState,
                       const std::atomic<uint64_t>& configGeneration, uint64_t runId,
                       RateLimitClock clock, MainThreadCheck checkMainThread)
    : library_(library),
      playerState_(playerState),
      configGeneration_(configGeneration),
      runId_(runId),
      clock_(std::move(clock)),
      checkMainThread_(std::move(checkMainThread)),
      polls_(kPollBurst, kPollRefill) {}

bool StateRoute::pollingTooFast(httplib::Response& res, const std::string& client) {
    if (polls_.allow(client, clock_())) {
        complaints_.allowed(client);
        return false;
    }

    if (complaints_.refused(client)) {
        logError("refusing state polls from " + client +
                 ": they are arriving faster than this component will answer them, which "
                 "usually means a client is looping");
    }

    res.set_header("Retry-After", kRetryPollAfterSeconds);
    respondError(res, 429, kPollingTooFast);
    return true;
}

void StateRoute::addTo(httplib::Server& server) {
    server.Get("/api/state", [this](const httplib::Request& req, httplib::Response& res) {
        // cpp-httplib gives one pooled thread the whole life of a socket, not just one request
        // on it, so a poller left on keep-alive would hold that thread idle between ticks;
        // closing the connection here frees it for the next client instead.
        res.set_header("Connection", "close");

        if (pollingTooFast(res, req.remote_addr))
            return;

        const auto generation = configGeneration_.load(std::memory_order_relaxed);
        const auto state = library_ ? library_->state() : Library::State{};
        const auto published = playerState_ ? playerState_->read() : PlayerStateStore::Published{};
        const auto mainThread = checkMainThread_ ? checkMainThread_(clock_()) : MainThreadHealth{};
        const auto tag = snapshotTag(state, runId_, published.version) + "-c" +
                         std::to_string(generation) + buildTag(state) +
                         (mainThread.answering ? "" : "-stalled");

        sendIfChanged(req, res, tag, "application/json",
                      [&state, &published, generation, &mainThread] {
                          return stateDocument(
                              state, published.state, std::chrono::steady_clock::now(),
                              PlayerRevisions{published.queueRevision, published.playlistsRevision,
                                              published.timelineRevision},
                              generation, mainThread);
                      });
    });
}

}  // namespace jean
