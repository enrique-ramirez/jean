#pragma once

#include "core/audience.h"
#include "core/library.h"
#include "core/player_state.h"
#include "core/playlists.h"
#include "core/settings.h"
#include "core/tag_write.h"
#include "core/timeline.h"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <vector>

// Every JSON document this component publishes, in one place; see ARCHITECTURE.md, *The
// HTTP contract*.
namespace jean {

struct ListenerStatus {
    bool listening = false;

    std::string error;

    // Separate because it is the one failure with a specific remedy.
    bool portInUse = false;
};

std::string statusDocument();

// `mutesWhileStreaming` is whether this install actually holds the player's output, not
// whether it was asked to: the setting alone is true on an install with no encoder, where
// there is nothing to hold and DELETE /stream/hold answers 503.
//
// `playerName`, `playerVersion`, `volumeMin`, `volumeMax` and `volumeUnit` are read once from
// the player and never change while it runs, which is why they ride this document and not the
// poll: see GET /state's `PlayerState.volume`, which is a bare number in this same range.
//
// `playbackOrders` is the player's own listing of its playback orders, in its own order; the
// document maps each through core/playback_modes.h and keeps the ones that answer, so an order
// this component has no Jean name for is offered to a client not at all.
std::string capabilitiesDocument(const Settings& settings,
                                 const std::vector<std::string>& streamFormats,
                                 bool mutesWhileStreaming, bool servesLibrary,
                                 const std::string& playerName, const std::string& playerVersion,
                                 double volumeMin, double volumeMax, const std::string& volumeUnit,
                                 const std::vector<std::string>& playbackOrders);

std::string streamListenersDocument(const std::vector<AudienceMember>& members, int connections,
                                    int maxConnections, bool playerMuted);

// Anyone who can reach beefweb can read this, so it carries neither the token nor the
// field allowlist.
std::string discoveryDocument(const Settings& settings, const ListenerStatus& status);

std::string errorDocument(const std::string& message);

std::string streamTicketDocument(const std::string& ticket, int expiresInSeconds);

// The only document that carries the token.
std::string pairedDocument(const std::string& token);

std::string streamTimelineDocument(double streamTime, const std::vector<StreamMark>& marks);

std::string tagWrittenDocument(const TagWrite& write);
std::string tagRefusedDocument(const TagWriteRequest& request);
std::string tagFailedDocument(TagWriteOutcome outcome);

int httpStatusFor(TagWriteRefusal refusal);
int httpStatusFor(TagWriteOutcome outcome);

std::string playlistsDocument(const std::vector<PlaylistAnnotation>& playlists);

std::string playlistDocument(const PlaylistAnnotation& playlist);
std::string playlistRemovedDocument(const std::string& id);
std::string playlistRefusedDocument(const AutoPlaylistRequest& request);
std::string playlistFailedDocument(const PlaylistResult& result);
std::string queryPreviewDocument(const PreviewResult& preview);

int httpStatusFor(PlaylistRefusal refusal);
int httpStatusFor(PlaylistOutcome outcome);

std::string fillResultDocument(const std::string& playlistId, const std::string& beefwebId,
                               const std::vector<size_t>& positions);

std::string copiedRowsDocument(uint64_t structure, const std::vector<size_t>& positions);
std::string removedRowsDocument(uint64_t structure);

// One row of a playlist: the columns the client declared, evaluated against the row's own
// handle in the order it declared them, and the library path GET /api/artwork?track= takes
// where the media library holds the track.
struct PlaylistRow {
    std::vector<std::string> columns;
    std::optional<std::string> libraryPath;
};

struct PlaylistRowsRead {
    PlaylistOutcome outcome = PlaylistOutcome::done;

    uint64_t structure = 0;
    uint64_t revision = 0;
    size_t totalCount = 0;

    std::vector<PlaylistRow> rows;
};

std::string playlistRowsDocument(const PlaylistRowsRead& read);

struct ChangedPlaylistRow {
    uint32_t position = 0;
    PlaylistRow row;
};

struct PlaylistChangesRead {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    DeltaOutcome catchUp = DeltaOutcome::ok;

    uint64_t revision = 0;

    std::vector<ChangedPlaylistRow> rows;
};

std::string playlistChangesDocument(const PlaylistChangesRead& read);

struct PlaylistPageRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    uint32_t offset = 0;
    uint32_t count = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

PlaylistPageRequest parsePlaylistPage(const std::string& offsetText, const std::string& countText);

struct PlayRowRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string playlistId;
    uint32_t index = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Never throws: both halves of the address arrive as URL segments, so a client's typo is
// routine here rather than a 404. How far the index sits past the end is the player's to
// answer, since nothing in core/ knows how many rows a playlist holds.
PlayRowRequest parsePlayRow(const std::string& id, const std::string& indexText);

// One entry in the play queue, as a client draws a row: the fixed fields a row shows, the
// library path GET /api/artwork?track= takes where the media library holds the track, and
// where the track sits in a playlist where it still has a position. `location` is unset for a
// library track queued by handle and for a playlist row whose position the player has lost.
struct QueuedTrack {
    std::string title;
    std::string artist;
    std::string album;
    std::string albumArtist;
    double duration = 0;

    std::optional<std::string> libraryPath;
    std::optional<PlayingLocation> location;
};

struct QueueRead {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    uint64_t revision = 0;
    std::vector<QueuedTrack> entries;
};

std::string queueDocument(const QueueRead& read);

struct QueuePosition {
    uint32_t index = 0;
    uint64_t revision = 0;
};

struct QueueRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string playlistId;
    std::vector<uint32_t> positions;
    std::optional<QueuePosition> at;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Never throws: a malformed body is routine for the HTTP handler that calls this.
QueueRowsRequest parseQueueRows(const std::string& body);

struct QueueTracksRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    PlaylistOutcome outcome = PlaylistOutcome::done;

    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;
    std::optional<QueuePosition> at;

    bool ok() const { return refusal == PlaylistRefusal::none && outcome == PlaylistOutcome::done; }
};

// Never throws.
QueueTracksRequest parseQueueTracks(const std::string& body, size_t trackCount,
                                    std::optional<uint64_t> expectedStructure);

enum class QueueSource { invalid, playlistRows, libraryTracks };

QueueSource queueSourceOf(const std::string& body);

struct MoveQueueRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    uint32_t from = 0;
    uint32_t to = 0;
    uint64_t revision = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Never throws: a malformed body is routine for the HTTP handler that calls this.
MoveQueueRequest parseMoveQueue(const std::string& body);

struct RemoveQueueRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    uint32_t index = 0;
    uint64_t revision = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Never throws: the index arrives as a URL segment and the revision as a query parameter, so
// a client's typo is routine here rather than a 404 or an unhandled exception.
RemoveQueueRequest parseRemoveQueue(const std::string& indexText, const std::string& revisionText);

// The library ordinals a fill inserts, decoded from whichever one of the three wire forms
// the request body carried; see contract/openapi.yaml, `FillPlaylistRequest`. `ordinals`
// is already in the order the fill must insert at: as given for the `ordinals` form,
// ascending for `runs` and `bitset`, because neither of those can carry any other order.
struct FillRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    PlaylistOutcome outcome = PlaylistOutcome::done;

    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;

    bool ok() const { return refusal == PlaylistRefusal::none && outcome == PlaylistOutcome::done; }
};

// `trackCount` bounds what an ordinal may name; one at or past it is refused rather than
// dropped, because narrowing the set silently is not what the caller asked for.
//
// `allowsTitle` is `FillOwnPlaylistRequest`'s alone: `title` is declared there and nowhere
// else, so a body carrying it against `FillPlaylistRequest` is refused with any other field
// neither schema declares.
//
// `expectedStructure` is `std::nullopt` only where there is no snapshot to check against,
// such as a test exercising the decode on its own.
FillRequest parseFill(const std::string& body, size_t trackCount,
                      std::optional<uint64_t> expectedStructure, bool allowsTitle = false);

constexpr size_t kAnyRowPosition = std::numeric_limits<uint32_t>::max();

// Which of the two sets a create carries, or neither; see contract/openapi.yaml,
// `CreatePlaylistRequest`. A body naming both is read as naming a source playlist, and the
// library fields it also carries are then fields that form does not declare.
enum class NewPlaylistSet { none, libraryTracks, playlistRows };

NewPlaylistSet newPlaylistSetOf(const std::string& body);

// The rows of another playlist a create copies, by position, ascending regardless of the
// order `runs` named them in: decodeSelection sorts before returning.
struct SourceRowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;

    std::string playlistId;
    std::vector<uint32_t> positions;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Never throws. `allowsTitle` is `CreatePlaylistRequest`'s alone, on the same terms parseFill
// takes it: a copy names a playlist that already has a title, so a body carrying one is
// refused with any other field the schema does not declare.
SourceRowsRequest parseSourceRows(const std::string& body, bool allowsTitle = false);

struct MovePlaylistRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    uint32_t index = 0;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// Never throws.
MovePlaylistRequest parseMovePlaylist(const std::string& body);

std::string libraryDocument(const Library::State& state);

std::string stateDocument(const Library::State& state, const PlayerState& player,
                          std::chrono::steady_clock::time_point now,
                          uint64_t queueRevision = 0, uint64_t playlistsRevision = 0);

std::string libraryRefusedDocument(const LibraryRequest& request);
std::string libraryFailedDocument(DeltaOutcome outcome);

int httpStatusFor(LibraryRefusal refusal);
int httpStatusFor(DeltaOutcome outcome);

}  // namespace jean
