#include "core/requests_queue.h"

#include "core/failures.h"
#include "core/json.h"
#include "core/selection.h"
#include "core/text.h"

#include <array>

namespace jean {

namespace {

// Exactly the fields contract/openapi.yaml declares for each request body below.
constexpr std::array<const char*, 4> kQueueRowsFields{"playlistId", "positions", "at", "revision"};
constexpr std::array<const char*, 6> kQueueTracksFields{"structure", "runs", "bitset",
                                                        "ordinals",  "at",   "revision"};
constexpr std::array<const char*, 3> kMoveQueueFields{"from", "to", "revision"};

struct QueuePositionField {
    std::optional<QueuePosition> at;
    PlaylistRefusal refusal = PlaylistRefusal::none;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

QueuePositionField readQueuePosition(const nlohmann::json& root) {
    const auto at = root.find("at");
    if (at == root.end())
        return {};

    const auto position = uint32Of(*at);
    const auto revision = readUint64(root, "revision");
    if (!position || !revision)
        return {std::nullopt, PlaylistRefusal::badOrdinals};

    QueuePositionField field;
    field.at = QueuePosition{*position, *revision};
    return field;
}

}  // namespace

QueueRowsRequest parseQueueRows(const JsonObject& body) {
    if (!body.ok())
        return refused<QueueRowsRequest>(PlaylistRefusal::malformedBody);

    const auto& root = body.value;

    if (!declaresOnly(root, kQueueRowsFields))
        return refused<QueueRowsRequest>(PlaylistRefusal::malformedBody);

    const auto playlistId = root.find("playlistId");
    if (playlistId == root.end() || !playlistId->is_string())
        return refused<QueueRowsRequest>(PlaylistRefusal::badId);

    const auto id = playlistId->get<std::string>();
    if (!isPlaylistId(id))
        return refused<QueueRowsRequest>(PlaylistRefusal::badId);

    const auto positions = root.find("positions");
    if (positions == root.end() || !positions->is_array() || positions->empty())
        return refused<QueueRowsRequest>(PlaylistRefusal::badOrdinals);

    QueueRowsRequest request;
    request.playlistId = id;

    for (const auto& entry : *positions) {
        const auto position = uint32Of(entry);
        if (!position)
            return refused<QueueRowsRequest>(PlaylistRefusal::badOrdinals);

        request.positions.push_back(*position);
    }

    const auto position = readQueuePosition(root);
    if (!position.ok())
        return refused<QueueRowsRequest>(position.refusal);
    request.at = position.at;

    return request;
}

QueueTracksRequest parseQueueTracks(const JsonObject& body, size_t trackCount,
                                    std::optional<uint64_t> expectedStructure) {
    if (!body.ok())
        return refused<QueueTracksRequest>(PlaylistRefusal::malformedBody);

    const auto& root = body.value;

    if (!declaresOnly(root, kQueueTracksFields))
        return refused<QueueTracksRequest>(PlaylistRefusal::malformedBody);

    const auto structure = readUint64(root, "structure");
    if (!structure)
        return refused<QueueTracksRequest>(PlaylistRefusal::malformedBody);

    if (!namesOneSelectionForm(root))
        return refused<QueueTracksRequest>(PlaylistRefusal::badOrdinals);

    QueueTracksRequest request;
    request.structure = *structure;

    if (expectedStructure && request.structure != *expectedStructure) {
        request.outcome = PlayerOutcome::structureMoved;
        return request;
    }

    const auto selection = decodeSelection(root, trackCount);
    if (!selection.ok() || selection.ordinals.empty())
        return refused<QueueTracksRequest>(PlaylistRefusal::badOrdinals);

    request.ordinals = selection.ordinals;

    const auto position = readQueuePosition(root);
    if (!position.ok())
        return refused<QueueTracksRequest>(position.refusal);
    request.at = position.at;

    return request;
}

QueueSource queueSourceOf(const JsonObject& body) {
    const auto& root = body.value;

    const bool namesRows = root.contains("playlistId") || root.contains("positions");
    const bool namesTracks = root.contains("structure") || root.contains("ordinals") ||
                             root.contains("runs") || root.contains("bitset");

    if (namesRows == namesTracks)
        return QueueSource::invalid;

    return namesRows ? QueueSource::playlistRows : QueueSource::libraryTracks;
}

MoveQueueRequest parseMoveQueue(const JsonObject& body) {
    if (!body.ok())
        return refused<MoveQueueRequest>(PlaylistRefusal::malformedBody);

    const auto& root = body.value;

    if (!declaresOnly(root, kMoveQueueFields))
        return refused<MoveQueueRequest>(PlaylistRefusal::malformedBody);

    const auto from = readUint32(root, "from");
    const auto to = readUint32(root, "to");
    const auto revision = readUint64(root, "revision");
    if (!from || !to || !revision)
        return refused<MoveQueueRequest>(PlaylistRefusal::badOrdinals);

    MoveQueueRequest request;
    request.from = *from;
    request.to = *to;
    request.revision = *revision;
    return request;
}

RemoveQueueRequest parseRemoveQueue(const std::string& indexText, const std::string& revisionText) {
    const auto index = readUint32(indexText);
    if (!index)
        return refused<RemoveQueueRequest>(PlaylistRefusal::badOrdinals);

    uint64_t revision = 0;
    if (!readDecimal(revisionText, revision))
        return refused<RemoveQueueRequest>(PlaylistRefusal::badOrdinals);

    RemoveQueueRequest request;
    request.index = *index;
    request.revision = revision;
    return request;
}

}  // namespace jean
