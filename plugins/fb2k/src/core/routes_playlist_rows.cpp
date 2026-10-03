#include "core/routes_playlist_rows.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/playlists.h"
#include "core/requests_playlists.h"
#include "core/text.h"

namespace jean {

namespace {

constexpr char kPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items)";
constexpr char kPlaylistItemChanges[] = R"(/api/playlists/([0-9a-f-]{36})/items/changes)";
constexpr char kCopyPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/copy)";
constexpr char kRemovePlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/remove)";
constexpr char kMovePlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/move)";
constexpr char kSortPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/sort)";

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

}  // namespace

PlaylistRowRoutes::PlaylistRowRoutes(const PlaylistCalls& playlists, const Library* library,
                                     const LiveSettings& settings, Throttle& changes)
    : playlists_(playlists), library_(library), settings_(settings), changes_(changes) {}

// Only POST /playlists/{id}/items calls this. POST /playlists/own/{role}/items resolves its id
// through the role itself, so it never holds a client-supplied one for this guard to check.
// See ARCHITECTURE.md, *The seams*, for when `readRole` is null.
//
// A role the player could not read is refused here rather than passed through: it is not
// evidence that the id names an ordinary playlist, and letting the request continue on it would
// open the scratch playlist to whichever client holds its id at the moment the component is
// struggling.
bool PlaylistRowRoutes::ownPlaylistRefused(const std::string& id, httplib::Response& res) const {
    if (!playlists_.readRole)
        return false;

    const auto read = playlists_.readRole(id);
    if (read.outcome != PlayerOutcome::done) {
        respondOutcome(res, read.outcome);
        return true;
    }

    if (!read.role)
        return false;

    respondOutcome(res, PlayerOutcome::ownPlaylist);
    return true;
}

void PlaylistRowRoutes::fill(const httplib::Request& req, httplib::Response& res) {
    if (playlistWritesRefused(*settings_.current(), res))
        return;

    const auto state = readyLibrary(library_, res);
    if (!state)
        return;

    const auto id = req.matches[1].str();
    if (playlistIdRefused(id, res))
        return;

    const auto request = parseFill(parseJsonObject(req.body), state->trackCount, state->structure,
                                   TitleField::refused, DuplicatesField::allowed);
    if (!request.ok()) {
        respondRequestRefused(res, request);
        return;
    }

    if (!playlists_.fill) {
        respondUnavailable(res, kNoPlaylistWrites);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    if (ownPlaylistRefused(id, res))
        return;

    const auto filled = playlists_.fill(id, std::string{}, request.structure, request.ordinals,
                                        ExistingRows::kept, request.duplicates);
    if (filled.outcome != PlayerOutcome::done) {
        respondOutcome(res, filled.outcome);
        return;
    }

    respond(res, 200, fillResultDocument(id, filled.structure, filled.positions, filled.skipped));
}

void PlaylistRowRoutes::addTo(httplib::Server& server) {
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

        const auto request = parseSourceRows(parseJsonObject(req.body), TitleField::refused,
                                             DuplicatesField::allowed);
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (!playlists_.copyRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        const auto copied =
            playlists_.copyRows(id, request.playlistId, request.positions, request.duplicates);
        if (copied.outcome != PlayerOutcome::done) {
            respondOutcome(res, copied.outcome);
            return;
        }

        respond(res, 200, copiedRowsDocument(copied.structure, copied.positions, copied.skipped));
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

        if (!playlists_.removeRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        const auto removed = playlists_.removeRows(id, request.structure, request.ordinals);
        if (removed.outcome != PlayerOutcome::done) {
            respondOutcome(res, removed.outcome);
            return;
        }

        respond(res, 200, removedRowsDocument(removed.structure));
    });

    server.Post(kMovePlaylistItems, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto request = parseMoveRows(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (!playlists_.moveRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        const auto moved = playlists_.moveRows(id, request.structure, request.ordinals, request.to);
        if (moved.outcome != PlayerOutcome::done) {
            respondOutcome(res, moved.outcome);
            return;
        }

        respond(res, 200, movedRowsDocument(moved.structure));
    });

    server.Post(kSortPlaylistItems, [this](const httplib::Request& req, httplib::Response& res) {
        if (playlistWritesRefused(*settings_.current(), res))
            return;

        const auto id = req.matches[1].str();
        if (playlistIdRefused(id, res))
            return;

        const auto request = parseSortRows(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (!playlists_.sortRows) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        const auto sorted = playlists_.sortRows(id, request.structure, request.pattern);
        if (sorted.outcome != PlayerOutcome::done) {
            respondOutcome(res, sorted.outcome);
            return;
        }

        respond(res, 200, sortedRowsDocument(sorted.structure, sorted.order));
    });
}

}  // namespace jean
