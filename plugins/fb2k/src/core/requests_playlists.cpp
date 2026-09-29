#include "core/requests_playlists.h"

#include "core/failures.h"
#include "core/json.h"
#include "core/selection.h"
#include "core/text.h"

#include <algorithm>
#include <array>

namespace jean {

namespace {

// Exactly the fields contract/openapi.yaml declares for each request body below.
constexpr std::array<const char*, 4> kFillFields{"structure", "runs", "bitset", "ordinals"};
constexpr char kTitleField[] = "title";

constexpr char kSourceField[] = "source";
constexpr std::array<const char*, 2> kSourceRowsFields{kSourceField, "runs"};

constexpr char kIndexField[] = "index";
constexpr std::array<const char*, 1> kMovePlaylistFields{kIndexField};

}  // namespace

PlaylistPageRequest parsePlaylistPage(const std::string& offsetText, const std::string& countText) {
    uint64_t offset = 0;
    if (!readDecimal(offsetText, offset) || !fitsUint32(offset))
        return refused<PlaylistPageRequest>(PlaylistRefusal::badOrdinals);

    uint64_t count = 0;
    if (!readDecimal(countText, count) || !fitsUint32(count))
        return refused<PlaylistPageRequest>(PlaylistRefusal::badOrdinals);

    PlaylistPageRequest request;
    request.offset = static_cast<uint32_t>(offset);
    request.count = static_cast<uint32_t>(count);
    return request;
}

PlayRowRequest parsePlayRow(const std::string& id, const std::string& indexText) {
    if (!isPlaylistId(id))
        return refused<PlayRowRequest>(PlaylistRefusal::badId);

    uint64_t index = 0;
    if (!readDecimal(indexText, index) || !fitsUint32(index))
        return refused<PlayRowRequest>(PlaylistRefusal::badOrdinals);

    PlayRowRequest request;
    request.playlistId = id;
    request.index = static_cast<uint32_t>(index);
    return request;
}

FillRequest parseFill(const JsonObject& body, size_t trackCount,
                      std::optional<uint64_t> expectedStructure, TitleField title) {
    if (!body.ok())
        return refused<FillRequest>(PlaylistRefusal::malformedBody);

    const auto& root = body.value;

    std::vector<const char*> fields(kFillFields.begin(), kFillFields.end());
    if (title == TitleField::allowed)
        fields.push_back(kTitleField);
    if (!declaresOnly(root, fields))
        return refused<FillRequest>(PlaylistRefusal::malformedBody);

    const auto structure = root.find("structure");
    if (structure == root.end() || !structure->is_number_unsigned())
        return refused<FillRequest>(PlaylistRefusal::malformedBody);

    if (!namesOneSelectionForm(root))
        return refused<FillRequest>(PlaylistRefusal::badOrdinals);

    FillRequest request;
    request.structure = structure->get<uint64_t>();

    if (expectedStructure && request.structure != *expectedStructure) {
        request.outcome = PlayerOutcome::structureMoved;
        return request;
    }

    const auto selection = decodeSelection(root, trackCount);
    if (!selection.ok())
        return refused<FillRequest>(PlaylistRefusal::badOrdinals);

    request.ordinals = selection.ordinals;
    return request;
}

RemoveRowsRequest parseRemoveRows(const JsonObject& body) {
    if (!body.ok())
        return refused<RemoveRowsRequest>(PlaylistRefusal::malformedBody);

    const auto& root = body.value;

    if (!declaresOnly(root, kFillFields))
        return refused<RemoveRowsRequest>(PlaylistRefusal::malformedBody);

    const auto structure = root.find("structure");
    RemoveRowsRequest request;
    if (structure == root.end() || !structure->is_string() ||
        !readDecimal(structure->get<std::string>(), request.structure))
        return refused<RemoveRowsRequest>(PlaylistRefusal::malformedBody);

    if (!namesOneSelectionForm(root))
        return refused<RemoveRowsRequest>(PlaylistRefusal::badOrdinals);

    const auto selection = decodeSelection(root, kMaxPlaylistPositionRows);
    if (!selection.ok())
        return refused<RemoveRowsRequest>(PlaylistRefusal::badOrdinals);

    request.ordinals = selection.ordinals;
    return request;
}

NewPlaylistSet newPlaylistSetOf(const JsonObject& body) {
    const auto& root = body.value;

    if (root.contains(kSourceField))
        return NewPlaylistSet::playlistRows;

    const bool namesTracks =
        std::any_of(kFillFields.begin(), kFillFields.end(),
                    [&root](const char* field) { return root.contains(field); });

    return namesTracks ? NewPlaylistSet::libraryTracks : NewPlaylistSet::none;
}

SourceRowsRequest parseSourceRows(const JsonObject& body, TitleField title) {
    if (!body.ok())
        return refused<SourceRowsRequest>(PlaylistRefusal::malformedBody);

    const auto& root = body.value;

    std::vector<const char*> fields(kSourceRowsFields.begin(), kSourceRowsFields.end());
    if (title == TitleField::allowed)
        fields.push_back(kTitleField);
    if (!declaresOnly(root, fields))
        return refused<SourceRowsRequest>(PlaylistRefusal::malformedBody);

    const auto source = root.find(kSourceField);
    if (source == root.end() || !source->is_string() || !isPlaylistId(source->get<std::string>()))
        return refused<SourceRowsRequest>(PlaylistRefusal::badId);

    const auto selection = decodeSelection(root, kMaxPlaylistPositionRows);
    if (!selection.ok())
        return refused<SourceRowsRequest>(PlaylistRefusal::badOrdinals);

    SourceRowsRequest request;
    request.playlistId = source->get<std::string>();
    request.positions = selection.ordinals;
    return request;
}

MovePlaylistRequest parseMovePlaylist(const JsonObject& body) {
    if (!body.ok())
        return refused<MovePlaylistRequest>(PlaylistRefusal::malformedBody);

    const auto& root = body.value;

    if (!declaresOnly(root, kMovePlaylistFields))
        return refused<MovePlaylistRequest>(PlaylistRefusal::malformedBody);

    const auto index = root.find(kIndexField);
    if (index == root.end() || !index->is_number_unsigned() || !fitsUint32(index->get<uint64_t>()))
        return refused<MovePlaylistRequest>(PlaylistRefusal::badOrdinals);

    MovePlaylistRequest request;
    request.index = static_cast<uint32_t>(index->get<uint64_t>());
    return request;
}

TitleRequest parseTitle(const JsonObject& body, OtherFields others) {
    if (!body.ok())
        return refused<TitleRequest>(PlaylistRefusal::malformedBody);

    const std::array<const char*, 1> onlyTheTitle{kTitleField};
    if (others == OtherFields::refused && !declaresOnly(body.value, onlyTheTitle))
        return refused<TitleRequest>(PlaylistRefusal::malformedBody);

    const auto title = readText(body.value, kTitleField, kMaxTitle, Need::required);
    if (!title.ok())
        return refused<TitleRequest>(PlaylistRefusal::badTitle);

    TitleRequest request;
    request.value = title.value;
    return request;
}

}  // namespace jean
