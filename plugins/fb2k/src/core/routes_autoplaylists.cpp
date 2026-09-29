#include "core/routes_autoplaylists.h"

#include "core/documents.h"
#include "core/http_responses.h"

#include <chrono>
#include <string>

namespace jean {

namespace {

// A preview runs a query over the whole library on the player's main thread. Somebody typing
// into an editor that does not debounce stays under this, and a client stuck in a loop does not.
constexpr int kPreviewBurst = 30;
constexpr auto kPreviewRefill = std::chrono::milliseconds(200);

constexpr char kAutoPlaylistById[] = R"(/api/autoplaylists/([0-9a-f-]{36}))";

AutoPlaylistRequest withId(AutoPlaylistRequest request, const std::string& id) {
    if (request.ok() && !isPlaylistId(id)) {
        request.refusal = PlaylistRefusal::badId;
        request.detail = "the playlist id must be one this component reported";
    }
    return request;
}

}  // namespace

AutoPlaylistRoutes::AutoPlaylistRoutes(const AutoPlaylistCalls& autoPlaylists,
                                       const LiveSettings& settings, Throttle& changes,
                                       const RateLimitClock& clock)
    : autoPlaylists_(autoPlaylists),
      settings_(settings),
      changes_(changes),
      previews_(kPreviewBurst, kPreviewRefill,
                "refusing query previews: they are arriving faster than this component will run "
                "them, which usually means a client is looping",
                clock) {}

bool AutoPlaylistRoutes::refusedBeforeAsking(httplib::Response& res,
                                             const AutoPlaylistRequest& request,
                                             bool playerCanAnswer) {
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
        return true;
    }

    if (!playerCanAnswer) {
        respondOutcome(res, PlayerOutcome::unavailable);
        return true;
    }

    return changingTooFast(changes_, res, kChangingPlaylistsTooFast);
}

bool AutoPlaylistRoutes::previewingTooFast(httplib::Response& res) {
    if (!previews_.refuses())
        return false;

    respondTooFast(res, previews_, refusalDocument(PlaylistRefusal::tooFast, kPreviewingTooFast));
    return true;
}

void AutoPlaylistRoutes::preview(const httplib::Request& req, httplib::Response& res) {
    const auto request = parseQueryPreview(req.body);
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
        return;
    }

    if (!autoPlaylists_.preview) {
        respondOutcome(res, PlayerOutcome::unavailable);
        return;
    }

    if (previewingTooFast(res))
        return;

    const auto counted = autoPlaylists_.preview(request.spec.query);
    if (counted.outcome != PlayerOutcome::done) {
        respondOutcome(res, counted.outcome);
        return;
    }

    respond(res, 200, queryPreviewDocument(counted));
}

void AutoPlaylistRoutes::addTo(httplib::Server& server) {
    server.Post("/api/autoplaylists/preview",
                [this](const httplib::Request& req, httplib::Response& res) { preview(req, res); });

    server.Post("/api/autoplaylists", [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto request = parseAutoPlaylist(req.body, Need::required);
        if (refusedBeforeAsking(res, request, autoPlaylists_.create != nullptr))
            return;

        const auto created =
            autoPlaylists_.create(request.spec, settings_.current()->maxAutoPlaylists);
        if (created.outcome != PlayerOutcome::done) {
            respondOutcome(res, created.outcome, created.detail);
            return;
        }

        respond(res, 200, playlistDocument(created.playlist));
    });

    server.Post(kAutoPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        const auto request = withId(parseAutoPlaylist(req.body, Need::optional), id);
        if (refusedBeforeAsking(res, request, autoPlaylists_.update != nullptr))
            return;

        const auto updated = autoPlaylists_.update(id, request.spec);
        if (updated.outcome != PlayerOutcome::done) {
            respondOutcome(res, updated.outcome, updated.detail);
            return;
        }

        respond(res, 200, playlistDocument(updated.playlist));
    });

    server.Delete(kAutoPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        const auto request = withId(AutoPlaylistRequest(), id);
        if (refusedBeforeAsking(res, request, autoPlaylists_.remove != nullptr))
            return;

        const auto removed = autoPlaylists_.remove(id);
        if (removed.outcome != PlayerOutcome::done) {
            respondOutcome(res, removed.outcome, removed.detail);
            return;
        }

        respond(res, 200, playlistRemovedDocument(id));
    });
}

}  // namespace jean
