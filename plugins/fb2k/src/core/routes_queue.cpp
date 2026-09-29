#include "core/routes_queue.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/requests_queue.h"

namespace jean {

namespace {

constexpr char kQueuePath[] = "/api/queue";
constexpr char kMoveQueuePath[] = "/api/queue/move";

// Matched loosely, on purpose: a non-numeric segment must reach parseRemoveQueue's own 400
// rather than fall through to a generic 404.
constexpr char kQueueEntryPath[] = R"(/api/queue/([^/]+))";

}  // namespace

QueueRoutes::QueueRoutes(const QueueCalls& queue, const Library* library,
                         const PlayerStateStore* playerState, const LiveSettings& settings,
                         Throttle& changes)
    : queue_(queue),
      library_(library),
      playerState_(playerState),
      settings_(settings),
      changes_(changes) {}

// A revision only a route reading it ahead of the player can judge: the store, not the job, is
// what a client's own next poll will see.
bool QueueRoutes::queueMoved(uint64_t revision, httplib::Response& res) const {
    const auto current = playerState_ ? playerState_->read().queueRevision : uint64_t{0};
    if (current == revision)
        return false;

    respondOutcome(res, PlayerOutcome::queueMoved);
    return true;
}

void QueueRoutes::queuePlaylistRows(const JsonObject& body, httplib::Response& res) {
    const auto request = parseQueueRows(body);
    if (!request.ok()) {
        respondRefusal(res, request.refusal);
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

void QueueRoutes::queueLibraryTracks(const JsonObject& body, httplib::Response& res) {
    const auto state = readyLibrary(library_, res);
    if (!state)
        return;

    const auto request = parseQueueTracks(body, state->trackCount, state->structure);
    if (!request.ok()) {
        respondRequestRefused(res, request);
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
    server.Get(kQueuePath, [this](const httplib::Request&, httplib::Response& res) {
        if (!queue_.read) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        const auto read = queue_.read();
        if (read.outcome != PlayerOutcome::done) {
            respondOutcome(res, read.outcome);
            return;
        }

        respond(res, 200, queueDocument(read));
    });

    server.Post(kQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        const auto body = parseJsonObject(req.body);
        switch (queueSourceOf(body)) {
            case QueueSource::playlistRows:
                queuePlaylistRows(body, res);
                return;
            case QueueSource::libraryTracks:
                queueLibraryTracks(body, res);
                return;
            case QueueSource::invalid:
                respondRefusal(res, PlaylistRefusal::malformedBody);
                return;
        }
    });

    server.Delete(kQueuePath, [this](const httplib::Request&, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        if (!queue_.clear) {
            respondUnavailable(res, kNoQueue);
            return;
        }

        if (changingTooFast(changes_, res))
            return;

        respondCommand(res, queue_.clear());
    });

    server.Post(kMoveQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        const auto request = parseMoveQueue(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
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
        if (playbackRefused(*settings_.current(), res))
            return;

        const auto request =
            parseRemoveQueue(req.matches[1].str(), req.get_param_value("revision"));
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
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
