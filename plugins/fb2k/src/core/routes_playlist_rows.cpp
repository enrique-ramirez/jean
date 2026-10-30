#include "core/routes_playlist_rows.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/library_paths.h"
#include "core/playlists.h"
#include "core/requests_playlists.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <iterator>
#include <optional>
#include <string_view>
#include <vector>

namespace jean {

namespace {

constexpr std::array<std::string_view, 4> kRowsOwned{"offset", "count", "positions", "columns"};
constexpr std::array<std::string_view, 3> kRowChangesOwned{"structure", "since", "columns"};

constexpr char kPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items)";
constexpr char kPlaylistRuns[] = R"(/api/playlists/([0-9a-f-]{36})/runs)";
constexpr char kPlaylistFind[] = R"(/api/playlists/([0-9a-f-]{36})/find)";
constexpr char kPlaylistItemChanges[] = R"(/api/playlists/([0-9a-f-]{36})/items/changes)";
constexpr char kCopyPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/copy)";
constexpr char kRemovePlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/remove)";
constexpr char kMovePlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/move)";
constexpr char kSortPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/sort)";

// The same gate as columnsDeclared, with the revision the client is catching up from. A
// present but empty `since` is read by parseLibraryRequest as revision zero, and a playlist's
// own `since` has no such zero to fall back to, so an empty value is refused here rather than
// forwarded to it.
LibraryRequest columnsAndSinceDeclared(const httplib::Request& req) {
    const auto asked = columnsAsked(req);
    if (asked.empty())
        return refused<LibraryRequest>(LibraryRefusal::badColumn, kColumnsRequired);

    if (!req.has_param("since") || req.get_param_value("since").empty())
        return refused<LibraryRequest>(LibraryRefusal::badSince, "'since' must be a whole number");

    return parseLibraryRequest(asked, req.get_param_value("since"));
}

std::optional<std::string> paramIfSent(const httplib::Request& req, const char* name) {
    if (!req.has_param(name))
        return std::nullopt;
    return req.get_param_value(name);
}

// cpp-httplib drops an exactly repeated `key=value` pair while parsing a query, so a position
// named twice arrives once, where it was first named.
PlaylistRowsRequest rowsAsked(const httplib::Request& req) {
    return parsePlaylistRows(paramIfSent(req, "offset"), paramIfSent(req, "count"),
                             req.get_param_values("positions"));
}

PlayerOutcome rowsRefusal(ReadOutcome catchUp) {
    return catchUp == ReadOutcome::structureMoved ? PlayerOutcome::rowsMoved
                                                  : PlayerOutcome::rowsRevisionTooOld;
}

}  // namespace

PlaylistRowRoutes::PlaylistRowRoutes(const PlaylistCalls& playlists, const Library* library,
                                     const LiveSettings& settings, Throttle& changes,
                                     LibraryRoutes& libraryRoutes, const RateLimitClock& clock)
    : playlists_(playlists),
      library_(library),
      settings_(settings),
      changes_(changes),
      libraryRoutes_(libraryRoutes),
      rowReads_(kRowsBurst, kRowsRefill),
      clock_(clock) {}

bool PlaylistRowRoutes::readingRowsTooFast(const httplib::Request& req, httplib::Response& res) {
    return perClientTooFast(rowReads_, req.remote_addr, clock_(), kReadingPlaylistRowsTooFast, res);
}

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
    if (failed(read, res))
        return true;

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

    if (unavailable(playlists_.fill, res, kNoPlaylistWrites))
        return;

    if (changingTooFast(changes_, res))
        return;

    if (ownPlaylistRefused(id, res))
        return;

    const auto filled = playlists_.fill(id, std::string{}, request.structure, request.ordinals,
                                        ExistingRows::kept, request.duplicates);
    if (failed(filled, res))
        return;

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

        const auto asked = rowsAsked(req);
        if (!asked.ok()) {
            respondRefusal(res, asked.refusal, asked.detail);
            return;
        }

        const auto roles = rolesAsked(req, kAllRoleNames, kRowsOwned);
        if (!roles.ok()) {
            respondRefusal(res, roles.refusal, roles.detail);
            return;
        }

        if (unavailable(playlists_.readRows, res, kNoPlaylistRows))
            return;

        if (readingRowsTooFast(req, res))
            return;

        auto read = playlists_.readRows(id, asked.rows, declared.columns);
        if (failed(read, res))
            return;

        std::vector<PlaylistRow*> rows;
        std::transform(read.rows.begin(), read.rows.end(), std::back_inserter(rows),
                       [](PlaylistRow& row) { return &row; });
        attachCovers(library_, libraryRoutes_.questions(), roles.expressions, rows);

        respond(res, 200, playlistRowsDocument(read));
    });

    server.Get(kPlaylistRuns, [this](const httplib::Request& req, httplib::Response& res) {
        libraryRoutes_.readPlaylistRuns(req, res, playlists_.readTracks);
    });

    server.Get(kPlaylistFind, [this](const httplib::Request& req, httplib::Response& res) {
        libraryRoutes_.findInPlaylist(req, res, playlists_.readTracks);
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

        const auto roles = rolesAsked(req, kAllRoleNames, kRowChangesOwned);
        if (!roles.ok()) {
            respondRefusal(res, roles.refusal, roles.detail);
            return;
        }

        if (unavailable(playlists_.readChangedRows, res, kNoPlaylistRows))
            return;

        if (readingRowsTooFast(req, res))
            return;

        auto read = playlists_.readChangedRows(id, structure, declared.since, declared.columns);
        if (failed(read, res))
            return;

        if (read.catchUp != ReadOutcome::ok) {
            respondOutcome(res, rowsRefusal(read.catchUp));
            return;
        }

        std::vector<PlaylistRow*> rows;
        std::transform(read.rows.begin(), read.rows.end(), std::back_inserter(rows),
                       [](ChangedPlaylistRow& changed) { return &changed.row; });
        attachCovers(library_, libraryRoutes_.questions(), roles.expressions, rows);

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

        if (unavailable(playlists_.copyRows, res, kNoPlaylistRows))
            return;

        if (changingTooFast(changes_, res))
            return;

        const auto copied =
            playlists_.copyRows(id, request.playlistId, request.positions, request.duplicates);
        if (failed(copied, res))
            return;

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

        if (unavailable(playlists_.removeRows, res, kNoPlaylistRows))
            return;

        if (changingTooFast(changes_, res))
            return;

        const auto removed = playlists_.removeRows(id, request.structure, request.ordinals);
        if (failed(removed, res))
            return;

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

        if (unavailable(playlists_.moveRows, res, kNoPlaylistRows))
            return;

        if (changingTooFast(changes_, res))
            return;

        const auto moved = playlists_.moveRows(id, request.structure, request.ordinals, request.to);
        if (failed(moved, res))
            return;

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

        if (unavailable(playlists_.sortRows, res, kNoPlaylistRows))
            return;

        if (changingTooFast(changes_, res))
            return;

        const auto sorted = playlists_.sortRows(id, request.structure, request.pattern);
        if (failed(sorted, res))
            return;

        respond(res, 200, sortedRowsDocument(sorted.structure, sorted.order));
    });
}

}  // namespace jean
