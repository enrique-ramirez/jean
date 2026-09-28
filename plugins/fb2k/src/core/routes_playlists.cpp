#include "core/routes_playlists.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/playlists.h"
#include "core/requests_playlists.h"
#include "core/text.h"

#include <algorithm>

namespace jean {

namespace {

constexpr char kPlaylistById[] = R"(/api/playlists/([0-9a-f-]{36}))";
constexpr char kMovePlaylist[] = R"(/api/playlists/([0-9a-f-]{36})/move)";
constexpr char kPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items)";
constexpr char kPlaylistItemChanges[] = R"(/api/playlists/([0-9a-f-]{36})/items/changes)";
constexpr char kCopyPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/copy)";
constexpr char kRemovePlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/remove)";
constexpr char kOwnItems[] = R"(/api/playlists/own/([^/]+)/items)";

// The same gate as columnsDeclared, with the revision the client is catching up from. Unlike
// GET /api/library/changes, where a present but empty `since` is read as revision zero, a
// playlist's own `since` has no such zero to fall back to, so an empty value is refused here
// rather than forwarded to parseLibraryRequest's library reading of it.
LibraryRequest columnsAndSinceDeclared(const httplib::Request& req) {
    const auto asked = columnsAsked(req);
    if (asked.empty())
        return refused<LibraryRequest>(LibraryRefusal::badColumn, kColumnsRequired);

    if (!req.has_param("since") || req.get_param_value("since").empty())
        return refused<LibraryRequest>(LibraryRefusal::badSince, "'since' must be a whole number");

    return parseLibraryRequest(asked, req.get_param_value("since"));
}

PlayerOutcome rowsRefusal(DeltaOutcome catchUp) {
    return catchUp == DeltaOutcome::structureChanged ? PlayerOutcome::rowsMoved
                                                     : PlayerOutcome::rowsRevisionTooOld;
}

std::optional<OwnPlaylistRole> ownPlaylistRoleFor(const std::string& role) {
    if (role == "scratch")
        return OwnPlaylistRole::scratch;
    return std::nullopt;
}

bool playlistIdRefused(const std::string& id, httplib::Response& res) {
    if (isPlaylistId(id))
        return false;

    respondRefusal(res, PlaylistRefusal::badId);
    return true;
}

}  // namespace

PlaylistRoutes::PlaylistRoutes(const PlaylistCalls& playlists, const Library* library,
                               const LiveSettings& settings, Throttle& changes)
    : playlists_(playlists), library_(library), settings_(settings), changes_(changes) {}

// Only POST /playlists/{id}/items calls this. POST /playlists/own/{role}/items resolves its id
// through the role itself, so it never holds a client-supplied one for this guard to check.
//
// `!playlists_.list` is unreachable with a real player: component.cpp wires it
// unconditionally. The escape exists only for a fake built to model some other route, free to
// leave the field unset because it never claims to answer for playlist roles.
//
// A listing the player could not answer is refused here rather than passed through: it is not
// evidence that the id names an ordinary playlist, and letting the request continue on it would
// open the scratch playlist to whichever client holds its id at the moment the component is
// struggling.
bool PlaylistRoutes::ownPlaylistRefused(const std::string& id, httplib::Response& res) const {
    if (!playlists_.list)
        return false;

    const auto listed = playlists_.list();
    if (listed.outcome != PlayerOutcome::done) {
        respondOutcome(res, listed.outcome);
        return true;
    }

    const auto found =
        std::find_if(listed.playlists.begin(), listed.playlists.end(),
                     [&id](const PlaylistAnnotation& playlist) { return playlist.id == id; });

    if (found == listed.playlists.end() || !found->role)
        return false;

    respondOutcome(res, PlayerOutcome::ownPlaylist);
    return true;
}

std::optional<NewPlaylistRows> PlaylistRoutes::newPlaylistRows(const JsonObject& body,
                                                               httplib::Response& res) const {
    NewPlaylistRows rows;

    switch (newPlaylistSetOf(body)) {
        case NewPlaylistSet::libraryTracks: {
            const auto state = readyLibrary(library_, res);
            if (!state)
                return std::nullopt;

            const auto request = parseFill(body, state->trackCount, state->structure, true);
            if (!request.ok()) {
                respondRequestRefused(res, request);
                return std::nullopt;
            }

            rows.structure = request.structure;
            rows.ordinals = request.ordinals;
            break;
        }
        case NewPlaylistSet::playlistRows: {
            const auto request = parseSourceRows(body, true);
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
    const auto title = parseTitle(body, newPlaylistSetOf(body) == NewPlaylistSet::none);
    if (!title.ok()) {
        respondRefusal(res, title.refusal);
        return;
    }

    const auto rows = newPlaylistRows(body, res);
    if (!rows)
        return;

    if (changingTooFast(changes_, res))
        return;

    if (!playlists_.create) {
        respondUnavailable(res, kNoPlaylistWrites);
        return;
    }

    const auto made = playlists_.create(title.value, *rows);
    if (made.outcome != PlayerOutcome::done) {
        respondOutcome(res, made.outcome, made.detail);
        return;
    }

    respond(res, 200, playlistDocument(made.playlist));
}

void PlaylistRoutes::fill(const httplib::Request& req, httplib::Response& res) {
    if (playlistWritesRefused(*settings_.current(), res))
        return;

    const auto state = readyLibrary(library_, res);
    if (!state)
        return;

    const auto id = req.matches[1].str();
    if (playlistIdRefused(id, res))
        return;

    if (ownPlaylistRefused(id, res))
        return;

    const auto request = parseFill(parseJsonObject(req.body), state->trackCount, state->structure);
    if (!request.ok()) {
        respondRequestRefused(res, request);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    if (!playlists_.fill) {
        respondUnavailable(res, kNoPlaylistWrites);
        return;
    }

    const auto filled =
        playlists_.fill(id, std::string{}, request.structure, request.ordinals, false);
    if (filled.outcome != PlayerOutcome::done) {
        respondOutcome(res, filled.outcome);
        return;
    }

    respond(res, 200, fillResultDocument(id, filled.structure, filled.positions));
}

void PlaylistRoutes::fillOwn(const httplib::Request& req, httplib::Response& res) {
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
    const auto request = parseFill(body, state->trackCount, state->structure, true);
    if (!request.ok()) {
        respondRequestRefused(res, request);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    const auto title = parseTitle(body);
    if (!title.ok()) {
        respondRefusal(res, title.refusal);
        return;
    }

    if (!playlists_.resolveOwn || !playlists_.fill) {
        respondUnavailable(res, kNoOwnPlaylists);
        return;
    }

    const auto titled = ownPlaylistTitle(title.value);

    const auto resolved = playlists_.resolveOwn(*role, titled);
    if (resolved.outcome != PlayerOutcome::done) {
        respondOutcome(res, resolved.outcome);
        return;
    }

    const auto filled =
        playlists_.fill(resolved.playlist.id, titled, request.structure, request.ordinals, true);
    if (filled.outcome != PlayerOutcome::done) {
        respondOutcome(res, filled.outcome);
        return;
    }

    respond(res, 200, fillResultDocument(resolved.playlist.id, filled.structure, filled.positions));
}

void PlaylistRoutes::addTo(httplib::Server& server) {
    addListRoutes(server);
    addRowRoutes(server);
    addOwnPlaylistRoutes(server);
}

void PlaylistRoutes::addListRoutes(httplib::Server& server) {
    server.Get("/api/playlists", [this](const httplib::Request&, httplib::Response& res) {
        const auto result =
            askIfAvailable(playlists_.list, PlaylistsResult{PlayerOutcome::unavailable, {}});
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

        const auto title = parseTitle(parseJsonObject(req.body), kOnlyTitle);
        if (!title.ok()) {
            respondRefusal(res, title.refusal);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        if (!playlists_.rename) {
            respondUnavailable(res, kNoPlaylistWrites);
            return;
        }

        const auto renamed = playlists_.rename(id, title.value);
        respondCommand(res, renamed.outcome, renamed.detail);
    });

    server.Delete(kPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        if (changingTooFast(changes_, res))
            return;

        if (!playlists_.remove) {
            respondUnavailable(res, kNoPlaylistWrites);
            return;
        }

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

        if (changingTooFast(changes_, res))
            return;

        if (!playlists_.move) {
            respondUnavailable(res, kNoPlaylistWrites);
            return;
        }

        const auto moved = playlists_.move(id, request.index);
        respondCommand(res, moved.outcome, moved.detail);
    });
}

void PlaylistRoutes::addRowRoutes(httplib::Server& server) {
    server.Post(kPlaylistItems,
                [this](const httplib::Request& req, httplib::Response& res) { fill(req, res); });

    server.Get(kPlaylistItems, [this](const httplib::Request& req, httplib::Response& res) {
        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto declared = columnsDeclared(req);
        if (!declared.ok()) {
            respondRefusal(res, declared.refusal, declared.detail);
            return;
        }

        const auto page =
            parsePlaylistPage(req.get_param_value("offset"), req.get_param_value("count"));
        if (!page.ok()) {
            respondRefusal(res, page.refusal);
            return;
        }

        if (!playlists_.readRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        const auto read = playlists_.readRows(id, page.offset, page.count, declared.columns);
        if (read.outcome != PlayerOutcome::done) {
            respondOutcome(res, read.outcome);
            return;
        }

        respond(res, 200, playlistRowsDocument(read));
    });

    server.Get(kPlaylistItemChanges, [this](const httplib::Request& req, httplib::Response& res) {
        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto declared = columnsAndSinceDeclared(req);
        if (!declared.ok()) {
            respondRefusal(res, declared.refusal, declared.detail);
            return;
        }

        uint64_t structure = 0;
        if (!readDecimal(req.get_param_value("structure"), structure)) {
            respondRefusal(res, PlaylistRefusal::badOrdinals);
            return;
        }

        if (!playlists_.readChangedRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        const auto read =
            playlists_.readChangedRows(id, structure, declared.since, declared.columns);
        if (read.outcome != PlayerOutcome::done) {
            respondOutcome(res, read.outcome);
            return;
        }

        if (read.catchUp != DeltaOutcome::ok) {
            respondOutcome(res, rowsRefusal(read.catchUp));
            return;
        }

        respond(res, 200, playlistChangesDocument(read));
    });

    server.Post(kCopyPlaylistItems, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto request = parseSourceRows(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        if (!playlists_.copyRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        const auto copied = playlists_.copyRows(id, request.playlistId, request.positions);
        if (copied.outcome != PlayerOutcome::done) {
            respondOutcome(res, copied.outcome);
            return;
        }

        respond(res, 200, copiedRowsDocument(copied.structure, copied.positions));
    });

    server.Post(kRemovePlaylistItems, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto request = parseRemoveRows(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        if (!playlists_.removeRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        const auto removed = playlists_.removeRows(id, request.structure, request.ordinals);
        if (removed.outcome != PlayerOutcome::done) {
            respondOutcome(res, removed.outcome);
            return;
        }

        respond(res, 200, removedRowsDocument(removed.structure));
    });
}

void PlaylistRoutes::addOwnPlaylistRoutes(httplib::Server& server) {
    server.Post(kOwnItems,
                [this](const httplib::Request& req, httplib::Response& res) { fillOwn(req, res); });

    server.Delete(kOwnItems, [this](const httplib::Request& req, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        const auto role = ownPlaylistRoleFor(req.matches[1].str());
        if (!role) {
            respondRefusal(res, PlaylistRefusal::malformedBody);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        if (!playlists_.emptyOwn) {
            respondUnavailable(res, kNoOwnPlaylists);
            return;
        }

        respondCommand(res, playlists_.emptyOwn(*role).outcome);
    });
}

}  // namespace jean
