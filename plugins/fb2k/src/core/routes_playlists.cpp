#include "core/routes_playlists.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/playlists.h"
#include "core/requests_playlists.h"

namespace jean {

namespace {

constexpr char kPlaylistById[] = R"(/api/playlists/([0-9a-f-]{36}))";
constexpr char kMovePlaylist[] = R"(/api/playlists/([0-9a-f-]{36})/move)";

}  // namespace

PlaylistRoutes::PlaylistRoutes(const PlaylistCalls& playlists, const Library* library,
                               const LiveSettings& settings, Throttle& changes)
    : playlists_(playlists), library_(library), settings_(settings), changes_(changes) {}

std::optional<NewPlaylistRows> PlaylistRoutes::newPlaylistRows(const JsonObject& body,
                                                               httplib::Response& res) const {
    NewPlaylistRows rows;

    switch (newPlaylistSetOf(body)) {
        case NewPlaylistSet::libraryTracks: {
            const auto state = readyLibrary(library_, res);
            if (!state)
                return std::nullopt;

            const auto request =
                parseFill(body, state->trackCount, state->structure, TitleField::allowed);
            if (!request.ok()) {
                respondRequestRefused(res, request);
                return std::nullopt;
            }

            rows.structure = request.structure;
            rows.ordinals = request.ordinals;
            break;
        }
        case NewPlaylistSet::playlistRows: {
            const auto request = parseSourceRows(body, TitleField::allowed);
            if (!request.ok()) {
                respondRefusal(res, request.refusal);
                return std::nullopt;
            }

            rows.sourcePlaylistId = request.playlistId;
            rows.positions = request.positions;
            break;
        }
        case NewPlaylistSet::none:
            break;
    }

    return rows;
}

void PlaylistRoutes::create(const httplib::Request& req, httplib::Response& res) {
    if (playlistWritesRefused(*settings_.current(), res))
        return;

    const auto body = parseJsonObject(req.body);
    const bool namesNoSet = newPlaylistSetOf(body) == NewPlaylistSet::none;
    const auto title = parseTitle(body, namesNoSet ? OtherFields::refused : OtherFields::allowed);
    if (!title.ok()) {
        respondRefusal(res, title.refusal);
        return;
    }

    const auto rows = newPlaylistRows(body, res);
    if (!rows)
        return;

    if (!playlists_.create) {
        respondUnavailable(res, kNoPlaylistWrites);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    const auto made = playlists_.create(title.value, *rows);
    if (made.outcome != PlayerOutcome::done) {
        respondOutcome(res, made.outcome, made.detail);
        return;
    }

    respond(res, 200, playlistDocument(made.playlist));
}

void PlaylistRoutes::addTo(httplib::Server& server) {
    server.Get("/api/playlists", [this](const httplib::Request&, httplib::Response& res) {
        if (!playlists_.list) {
            respondOutcome(res, PlayerOutcome::unavailable);
            return;
        }

        const auto result = playlists_.list();
        if (result.outcome != PlayerOutcome::done) {
            respondOutcome(res, result.outcome);
            return;
        }

        respond(res, 200, playlistsDocument(result.playlists));
    });

    server.Post("/api/playlists",
                [this](const httplib::Request& req, httplib::Response& res) { create(req, res); });

    server.Post(kPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto title = parseTitle(parseJsonObject(req.body), OtherFields::refused);
        if (!title.ok()) {
            respondRefusal(res, title.refusal);
            return;
        }

        if (!playlists_.rename) {
            respondUnavailable(res, kNoPlaylistWrites);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        const auto renamed = playlists_.rename(id, title.value);
        respondCommand(res, renamed.outcome, renamed.detail);
    });

    server.Delete(kPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        if (!playlists_.remove) {
            respondUnavailable(res, kNoPlaylistWrites);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        const auto removed = playlists_.remove(id);
        respondCommand(res, removed.outcome, removed.detail);
    });

    server.Post(kMovePlaylist, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto request = parseMovePlaylist(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (!playlists_.move) {
            respondUnavailable(res, kNoPlaylistWrites);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        const auto moved = playlists_.move(id, request.index);
        respondCommand(res, moved.outcome, moved.detail);
    });
}

}  // namespace jean
