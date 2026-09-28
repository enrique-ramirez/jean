#pragma once

#include "core/documents.h"
#include "core/player_outcome.h"
#include "core/playlists.h"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

// What a queue route's request asks for, decoded and refused before the player is asked
// anything. Never throws: a malformed request is routine for the HTTP handler that calls these.
namespace jean {

struct JsonObject;

struct QueueRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string playlistId;
    std::vector<uint32_t> positions;
    std::optional<QueuePosition> at;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

QueueRowsRequest parseQueueRows(const JsonObject& body);

struct QueueTracksRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    PlayerOutcome outcome = PlayerOutcome::done;

    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;
    std::optional<QueuePosition> at;

    bool ok() const { return refusal == PlaylistRefusal::none && outcome == PlayerOutcome::done; }
};

QueueTracksRequest parseQueueTracks(const JsonObject& body, size_t trackCount,
                                    std::optional<uint64_t> expectedStructure);

enum class QueueSource { invalid, playlistRows, libraryTracks };

QueueSource queueSourceOf(const JsonObject& body);

struct MoveQueueRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    uint32_t from = 0;
    uint32_t to = 0;
    uint64_t revision = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

MoveQueueRequest parseMoveQueue(const JsonObject& body);

struct RemoveQueueRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    uint32_t index = 0;
    uint64_t revision = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// The index arrives as a URL segment and the revision as a query parameter, so
// a client's typo is routine here rather than a 404 or an unhandled exception.
RemoveQueueRequest parseRemoveQueue(const std::string& indexText, const std::string& revisionText);

}  // namespace jean
