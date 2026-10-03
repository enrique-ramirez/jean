#include "core/routes_own_playlists.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/playlists.h"
#include "core/requests_playlists.h"

#include <optional>
#include <string>

namespace jean {

namespace {

constexpr char kOwnItems[] = R"(/api/playlists/own/([^/]+)/items)";

std::optional<OwnPlaylistRole> ownPlaylistRoleFor(const std::string& role) {
    if (role == "scratch")
        return OwnPlaylistRole::scratch;
    return std::nullopt;
}

}  // namespace

OwnPlaylistRoutes::OwnPlaylistRoutes(const PlaylistCalls& playlists, const Library* library,
                                     const LiveSettings& settings, Throttle& changes)
    : playlists_(playlists), library_(library), settings_(settings), changes_(changes) {}

void OwnPlaylistRoutes::fill(const httplib::Request& req, httplib::Response& res) {
    if (playbackRefused(*settings_.current(), res))
        return;

    const auto state = readyLibrary(library_, res);
    if (!state)
        return;

    const auto role = ownPlaylistRoleFor(req.matches[1].str());
    if (!role) {
        respondRefusal(res, PlaylistRefusal::malformedBody);
        return;
    }

    const auto body = parseJsonObject(req.body);
    const auto request = parseFill(body, state->trackCount, state->structure, TitleField::allowed);
    if (!request.ok()) {
        respondRequestRefused(res, request);
        return;
    }

    const auto title = parseTitle(body);
    if (!title.ok()) {
        respondRefusal(res, title.refusal);
        return;
    }

    if (!playlists_.resolveOwn || !playlists_.fill) {
        respondUnavailable(res, kNoOwnPlaylists);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    const auto titled = ownPlaylistTitle(title.value);

    const auto resolved = playlists_.resolveOwn(*role, titled);
    if (resolved.outcome != PlayerOutcome::done) {
        respondOutcome(res, resolved.outcome);
        return;
    }

    const auto filled =
        playlists_.fill(resolved.playlist.id, titled, request.structure, request.ordinals,
                        ExistingRows::replaced, Duplicates::added);
    if (filled.outcome != PlayerOutcome::done) {
        respondOutcome(res, filled.outcome);
        return;
    }

    respond(res, 200,
            fillResultDocument(resolved.playlist.id, filled.structure, filled.positions,
                               filled.skipped));
}

void OwnPlaylistRoutes::empty(const httplib::Request& req, httplib::Response& res) {
    if (playbackRefused(*settings_.current(), res))
        return;

    const auto role = ownPlaylistRoleFor(req.matches[1].str());
    if (!role) {
        respondRefusal(res, PlaylistRefusal::malformedBody);
        return;
    }

    if (!playlists_.emptyOwn) {
        respondUnavailable(res, kNoOwnPlaylists);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    respondCommand(res, playlists_.emptyOwn(*role).outcome);
}

void OwnPlaylistRoutes::addTo(httplib::Server& server) {
    server.Post(kOwnItems,
                [this](const httplib::Request& req, httplib::Response& res) { fill(req, res); });

    server.Delete(kOwnItems,
                  [this](const httplib::Request& req, httplib::Response& res) { empty(req, res); });
}

}  // namespace jean
