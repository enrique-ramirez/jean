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

// The three writes refuse and answer alike: what the request says, then the budget every
// playlist edit shares, then whatever the player answered.
std::optional<PlaylistResult> AutoPlaylistRoutes::attempt(
    httplib::Response& res, const AutoPlaylistRequest& request,
    const std::function<PlaylistResult()>& ask) {
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
        return std::nullopt;
    }

    if (changes_.refuses()) {
        respondTooFast(res, changes_,
                       refusalDocument(PlaylistRefusal::tooFast, kChangingPlaylistsTooFast));
        return std::nullopt;
    }

    auto result = ask();
    if (result.outcome != PlayerOutcome::done) {
        respondOutcome(res, result.outcome, result.detail);
        return std::nullopt;
    }

    return result;
}

void AutoPlaylistRoutes::addTo(httplib::Server& server) {
    server.Post("/api/autoplaylists/preview", [this](const httplib::Request& req,
                                                     httplib::Response& res) {
        const auto request = parseQueryPreview(req.body);
        if (!request.ok()) {
            respondRefusal(res, request.refusal, request.detail);
            return;
        }

        if (previews_.refuses()) {
            respondTooFast(res, previews_,
                           refusalDocument(PlaylistRefusal::tooFast, kPreviewingTooFast));
            return;
        }

        const auto preview = askIfAvailable(
            autoPlaylists_.preview, previewFailure(PlayerOutcome::unavailable), request.spec.query);
        if (preview.outcome != PlayerOutcome::done) {
            respondOutcome(res, preview.outcome);
            return;
        }

        respond(res, 200, queryPreviewDocument(preview));
    });

    server.Post("/api/autoplaylists", [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto request = parseAutoPlaylist(req.body, Need::required);
        const auto maxAutoPlaylists = settings_.current()->maxAutoPlaylists;

        const auto created = attempt(res, request, [this, &request, maxAutoPlaylists] {
            return askIfAvailable(autoPlaylists_.create,
                                  playlistFailure(PlayerOutcome::unavailable), request.spec,
                                  maxAutoPlaylists);
        });

        if (created)
            respond(res, 200, playlistDocument(created->playlist));
    });

    server.Post(kAutoPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        const auto request = withId(parseAutoPlaylist(req.body, Need::optional), id);

        const auto updated = attempt(res, request, [this, &request, &id] {
            return askIfAvailable(autoPlaylists_.update,
                                  playlistFailure(PlayerOutcome::unavailable), id, request.spec);
        });

        if (updated)
            respond(res, 200, playlistDocument(updated->playlist));
    });

    server.Delete(kAutoPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        const auto request = withId(AutoPlaylistRequest(), id);

        const auto removed = attempt(res, request, [this, &id] {
            return askIfAvailable(autoPlaylists_.remove,
                                  playlistFailure(PlayerOutcome::unavailable), id);
        });

        if (removed)
            respond(res, 200, playlistRemovedDocument(id));
    });
}

}  // namespace jean
