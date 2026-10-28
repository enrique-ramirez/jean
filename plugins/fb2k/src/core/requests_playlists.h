#pragma once

#include "core/documents.h"
#include "core/player_outcome.h"
#include "core/playlists.h"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

// What a playlist route's request asks for, decoded and refused before the player is asked
// anything. Never throws: a malformed request is routine for the HTTP handler that calls these.
namespace jean {

struct JsonObject;

// How many rows one `positions` query may name. The route is a GET, and cpp-httplib refuses a
// request line over 8192 bytes, so the ceiling keeps a full list beside a whole declaration and
// every role inside it.
constexpr size_t kMaxPositionsAsked = 128;

struct PlaylistRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string detail;
    PlaylistRowsAsked rows;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

PlaylistRowsRequest parsePlaylistRows(const std::optional<std::string>& offsetText,
                                      const std::optional<std::string>& countText,
                                      const std::vector<std::string>& positionTexts);

struct PlayRowRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string playlistId;
    uint32_t index = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Both halves of the address arrive as URL segments, so a client's typo is
// routine here rather than a 404. How far the index sits past the end is the player's to
// answer, since nothing in core/ knows how many rows a playlist holds.
PlayRowRequest parsePlayRow(const std::string& id, const std::string& indexText);

// The library ordinals a fill inserts, decoded from whichever one of the three wire forms
// the request body carried; see contract/openapi.yaml, `FillPlaylistRequest`. `ordinals`
// is already in the order the fill must insert at: as given for the `ordinals` form,
// ascending for `runs` and `bitset`, because neither of those can carry any other order.
struct FillRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    PlayerOutcome outcome = PlayerOutcome::done;

    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;
    Duplicates duplicates = Duplicates::added;

    bool ok() const { return refusal == PlaylistRefusal::none && outcome == PlayerOutcome::done; }
};

// Whether the schema a body is held to declares `title` beside the fields a reader decodes. A
// body carrying `title` where it is not declared is refused with any other undeclared field.
enum class TitleField { refused, allowed };

enum class DuplicatesField { refused, allowed };

// `trackCount` bounds what an ordinal may name; one at or past it is refused rather than
// dropped, because narrowing the set silently is not what the caller asked for.
//
// `title` is allowed by `FillOwnPlaylistRequest` and `CreatePlaylistRequest` alone.
//
// `expectedStructure` is `std::nullopt` only where there is no snapshot to check against,
// such as a test exercising the decode on its own.
FillRequest parseFill(const JsonObject& body, size_t trackCount,
                      std::optional<uint64_t> expectedStructure,
                      TitleField title = TitleField::refused,
                      DuplicatesField duplicates = DuplicatesField::refused);

// The row ceiling `parseRemoveRows` and `parseSourceRows` hold a selection against, in place
// of the real playlist length, which core/ does not have at parse time. A playlist's rows are
// not bounded by the library: the same track can repeat any number of times through queueing,
// repeated adds or a deliberate repeat. This is an engineered ceiling on what one request may
// resolve to, set far above any selection a person makes in a playlist view; the real playlist
// length is checked again on the main thread once the player has answered.
constexpr size_t kMaxPlaylistPositionRows = 1500000;

// `POST /api/playlists/{id}/items/remove`'s body. `structure` names the playlist's own
// generation, so it arrives as a run of decimal digits rather than the number a fill's does;
// see contract/openapi.yaml, `RemovePlaylistRowsRequest`. Whether it still matches the
// playlist's current generation is for the caller to ask the player, not this.
struct RemoveRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;

    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

RemoveRowsRequest parseRemoveRows(const JsonObject& body);

// `POST /api/playlists/{id}/items/move`'s body: the rows as `runs` or `ordinals`, never
// `bitset`, and where the first lands; see contract/openapi.yaml, `MovePlaylistRowsRequest`.
// `structure` is read as `RemoveRowsRequest`'s is.
struct MoveRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;

    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;
    uint32_t to = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

MoveRowsRequest parseMoveRows(const JsonObject& body);

struct SortRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;

    uint64_t structure = 0;
    std::string pattern;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

SortRowsRequest parseSortRows(const JsonObject& body);

// Which of the two sets a create carries, or neither; see contract/openapi.yaml,
// `CreatePlaylistRequest`. A body naming both is read as naming a source playlist, and the
// library fields it also carries are then fields that form does not declare.
enum class NewPlaylistSet { none, libraryTracks, playlistRows };

NewPlaylistSet newPlaylistSetOf(const JsonObject& body);

// The rows of another playlist a create copies, by position, ascending regardless of the
// order `runs` named them in: decodeSelection sorts before returning.
struct SourceRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;

    std::string playlistId;
    std::vector<uint32_t> positions;
    Duplicates duplicates = Duplicates::added;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// `title` is allowed by `CreatePlaylistRequest` alone: a copy names a playlist that already has
// a title.
SourceRowsRequest parseSourceRows(const JsonObject& body, TitleField title = TitleField::refused,
                                  DuplicatesField duplicates = DuplicatesField::refused);

struct MovePlaylistRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    uint32_t index = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

MovePlaylistRequest parseMovePlaylist(const JsonObject& body);

// A title every writing route reads through the check parseAutoPlaylist's title takes, since a
// value the contract calls unusable there is unusable here for the same reason.
struct TitleRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string value;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Whether the schema a title is read from declares anything beside it. contract/openapi.yaml
// declares nothing beside title for the rename and for a create naming no set. A create naming
// one, and the own-playlist fill that shares this reader, are held to their own wider field list
// by parseFill or parseSourceRows, so they allow the others here.
enum class OtherFields { refused, allowed };

TitleRequest parseTitle(const JsonObject& body, OtherFields others = OtherFields::allowed);

}  // namespace jean
