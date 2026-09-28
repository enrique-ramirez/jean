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

    if (!at->is_number_unsigned() || !fitsUint32(at->get<uint64_t>()))
        return {std::nullopt, PlaylistRefusal::badOrdinals};

    const auto revision = root.find("revision");
    if (revision == root.end() || !revision->is_number_unsigned())
        return {std::nullopt, PlaylistRefusal::badOrdinals};

    QueuePositionField field;
    field.at = QueuePosition{static_cast<uint32_t>(at->get<uint64_t>()), revision->get<uint64_t>()};
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
        if (!entry.is_number_unsigned())
            return refused<QueueRowsRequest>(PlaylistRefusal::badOrdinals);

        const auto value = entry.get<uint64_t>();
        if (!fitsUint32(value))
            return refused<QueueRowsRequest>(PlaylistRefusal::badOrdinals);

        request.positions.push_back(static_cast<uint32_t>(value));
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

    const auto structure = root.find("structure");
    if (structure == root.end() || !structure->is_number_unsigned())
        return refused<QueueTracksRequest>(PlaylistRefusal::malformedBody);

    if (!namesOneSelectionForm(root))
        return refused<QueueTracksRequest>(PlaylistRefusal::badOrdinals);

    QueueTracksRequest request;
    request.structure = structure->get<uint64_t>();

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

    const auto from = root.find("from");
    if (from == root.end() || !from->is_number_unsigned() || !fitsUint32(from->get<uint64_t>()))
        return refused<MoveQueueRequest>(PlaylistRefusal::badOrdinals);

    const auto to = root.find("to");
    if (to == root.end() || !to->is_number_unsigned() || !fitsUint32(to->get<uint64_t>()))
        return refused<MoveQueueRequest>(PlaylistRefusal::badOrdinals);

    const auto revision = root.find("revision");
    if (revision == root.end() || !revision->is_number_unsigned())
        return refused<MoveQueueRequest>(PlaylistRefusal::badOrdinals);

    MoveQueueRequest request;
    request.from = static_cast<uint32_t>(from->get<uint64_t>());
    request.to = static_cast<uint32_t>(to->get<uint64_t>());
    request.revision = revision->get<uint64_t>();
    return request;
}

RemoveQueueRequest parseRemoveQueue(const std::string& indexText, const std::string& revisionText) {
    uint64_t index = 0;
    if (!readDecimal(indexText, index) || !fitsUint32(index))
        return refused<RemoveQueueRequest>(PlaylistRefusal::badOrdinals);

    uint64_t revision = 0;
    if (!readDecimal(revisionText, revision))
        return refused<RemoveQueueRequest>(PlaylistRefusal::badOrdinals);

    RemoveQueueRequest request;
    request.index = static_cast<uint32_t>(index);
    request.revision = revision;
    return request;
}

}  // namespace jean
