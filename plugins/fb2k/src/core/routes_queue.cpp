#include "core/routes_queue.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/library_paths.h"
#include "core/requests_queue.h"
#include "core/session_scope.h"

#include <algorithm>
#include <array>
#include <iterator>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace jean {

namespace {

constexpr char kQueuePath[] = "/api/queue";
constexpr char kMoveQueuePath[] = "/api/queue/move";

constexpr std::array<std::string_view, 2> kQueueOwned{"session", "deviceId"};

// Matched loosely, on purpose: a non-numeric segment must reach parseRemoveQueue's own 400
// rather than fall through to a generic 404.
constexpr char kQueueEntryPath[] = R"(/api/queue/([^/]+))";

}  // namespace

QueueRoutes::QueueRoutes(const QueueCalls& queue, const SessionCalls& sessions,
                         SessionRegistry& registry, const Library* library,
                         LibraryQuestions& questions, const PlayerStateStore* playerState,
                         const LiveSettings& settings, Throttle& changes,
                         const RateLimitClock& clock)
    : queue_(queue),
      sessions_(sessions),
      registry_(registry),
      library_(library),
      questions_(questions),
      playerState_(playerState),
      settings_(settings),
      changes_(changes),
      clock_(clock) {}

SessionAnswer QueueRoutes::namedSession(const httplib::Request& req, httplib::Response& res) {
    return scopedSession(sessionScopeOf(req), res, registry_, clock_());
}

SessionAnswer QueueRoutes::commandedSession(const httplib::Request& req, httplib::Response& res) {
    return jean::commandedSession(req, res, registry_, clock_(), *settings_.current());
}

// A revision only a route reading it ahead of the player can judge: the store, not the job, is
// what a client's own next poll will see.
bool QueueRoutes::queueMoved(uint64_t revision, httplib::Response& res) const {
    const auto current = playerState_ ? playerState_->read().queueRevision : uint64_t{0};
    if (current == revision)
        return false;

    respondOutcome(res, PlayerOutcome::queueMoved);
    return true;
}

void QueueRoutes::attachCovers(const RolesAsked& roles, std::vector<QueuedTrack>& entries) const {
    std::vector<QueuedTrack*> rows;
    rows.reserve(entries.size());
    std::transform(entries.begin(), entries.end(), std::back_inserter(rows),
                   [](QueuedTrack& entry) { return &entry; });
    jean::attachCovers(library_, questions_, roles.expressions, rows);
}

void QueueRoutes::readSessionQueue(const Session& session, const RolesAsked& roles,
                                   httplib::Response& res) {
    if (!sessions_.readQueue) {
        respondUnavailable(res, kNoQueue);
        return;
    }

    const auto queue = session.queue();
    auto read = sessions_.readQueue(queue.entries);
    if (read.outcome != PlayerOutcome::done) {
        respondOutcome(res, read.outcome);
        return;
    }

    read.revision = queue.revision;
    std::for_each(read.entries.begin(), read.entries.end(),
                  [](QueuedTrack& entry) { entry.location.reset(); });
    attachCovers(roles, read.entries);

    respond(res, 200, queueDocument(read));
}

void QueueRoutes::queueInSession(Session& session, std::optional<QueuePosition> at,
                                 size_t requestedCount,
                                 const std::function<SessionTracksRead()>& take,
                                 httplib::Response& res) {
    if (changingTooFast(changes_, res))
        return;

    if (at && at->revision != session.revisions().queue) {
        respondOutcome(res, PlayerOutcome::queueMoved);
        return;
    }

    if (requestedCount > kMaxSessionQueue) {
        respondError(res, 409, kSessionQueueFull);
        return;
    }

    auto taken = take();
    if (taken.outcome != PlayerOutcome::done) {
        respondCommand(res, taken.outcome);
        return;
    }

    const auto queued = at ? session.enqueueAt(std::move(taken.tracks), at->index, at->revision)
                           : session.enqueue(std::move(taken.tracks));
    if (queued == PlayerOutcome::tooMany) {
        respondError(res, 409, kSessionQueueFull);
        return;
    }

    respondCommand(res, queued);
}

void QueueRoutes::queuePlaylistRows(Session* session, const JsonObject& body,
                                    httplib::Response& res) {
    const auto request = parseQueueRows(body);
    if (!request.ok()) {
        respondRefusal(res, request.refusal);
        return;
    }

    if (session) {
        if (!sessions_.takePlaylist) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        queueInSession(
            *session, request.at, request.positions.size(),
            [this, &request] {
                return sessions_.takePlaylist(request.playlistId, request.positions);
            },
            res);
        return;
    }

    if (!queue_.addPlaylistRows) {
        respondUnavailable(res, kNoQueue);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    if (request.at && queueMoved(request.at->revision, res))
        return;

    respondCommand(res, queue_.addPlaylistRows(request.playlistId, request.positions, request.at));
}

void QueueRoutes::queueLibraryTracks(Session* session, const JsonObject& body,
                                     httplib::Response& res) {
    const auto state = readyLibrary(library_, res);
    if (!state)
        return;

    const auto request = parseQueueTracks(body, state->trackCount, state->structure);
    if (!request.ok()) {
        respondRequestRefused(res, request);
        return;
    }

    if (session) {
        if (!sessions_.takeLibrary) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        queueInSession(
            *session, request.at, request.ordinals.size(),
            [this, &request] { return sessions_.takeLibrary(request.structure, request.ordinals); },
            res);
        return;
    }

    if (!queue_.addLibraryTracks) {
        respondUnavailable(res, kNoQueue);
        return;
    }

    if (changingTooFast(changes_, res))
        return;

    if (request.at && queueMoved(request.at->revision, res))
        return;

    respondCommand(res, queue_.addLibraryTracks(request.structure, request.ordinals, request.at));
}

void QueueRoutes::addTo(httplib::Server& server) {
    server.Get(kQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
        const auto named = namedSession(req, res);
        if (named.which == SessionAnswer::Which::none)
            return;

        const auto roles = rolesAsked(req, kAllRoleNames, kQueueOwned);
        if (!roles.ok()) {
            respondRefusal(res, roles.refusal, roles.detail);
            return;
        }

        if (named.session) {
            readSessionQueue(*named.session, roles, res);
            return;
        }

        if (!queue_.read) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        auto read = queue_.read();
        if (read.outcome != PlayerOutcome::done) {
            respondOutcome(res, read.outcome);
            return;
        }
        attachCovers(roles, read.entries);

        respond(res, 200, queueDocument(read));
    });

    server.Post(kQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
        const auto named = commandedSession(req, res);
        if (named.which == SessionAnswer::Which::none)
            return;

        const auto body = parseJsonObject(req.body);
        switch (queueSourceOf(body)) {
            case QueueSource::playlistRows:
                queuePlaylistRows(named.session.get(), body, res);
                return;
            case QueueSource::libraryTracks:
                queueLibraryTracks(named.session.get(), body, res);
                return;
            case QueueSource::invalid:
                respondRefusal(res, PlaylistRefusal::malformedBody);
                return;
        }
    });

    server.Delete(kQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
        const auto named = commandedSession(req, res);
        if (named.which == SessionAnswer::Which::none)
            return;

        if (named.session) {
            if (changingTooFast(changes_, res))
                return;

            named.session->clearQueue();
            respondCommand(res, PlayerOutcome::done);
            return;
        }

        if (!queue_.clear) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        respondCommand(res, queue_.clear());
    });

    server.Post(kMoveQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
        const auto named = commandedSession(req, res);
        if (named.which == SessionAnswer::Which::none)
            return;

        const auto request = parseMoveQueue(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (named.session) {
            if (changingTooFast(changes_, res))
                return;

            respondCommand(res,
                           named.session->moveQueued(request.from, request.to, request.revision));
            return;
        }

        if (!queue_.moveEntry) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        if (queueMoved(request.revision, res))
            return;

        respondCommand(res, queue_.moveEntry(request.from, request.to, request.revision));
    });

    server.Delete(kQueueEntryPath, [this](const httplib::Request& req, httplib::Response& res) {
        const auto named = commandedSession(req, res);
        if (named.which == SessionAnswer::Which::none)
            return;

        const auto request =
            parseRemoveQueue(req.matches[1].str(), req.get_param_value("revision"));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (named.session) {
            if (changingTooFast(changes_, res))
                return;

            respondCommand(res, named.session->removeQueued(request.index, request.revision));
            return;
        }

        if (!queue_.removeEntry) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        if (queueMoved(request.revision, res))
            return;

        respondCommand(res, queue_.removeEntry(request.index, request.revision));
    });
}

}  // namespace jean
