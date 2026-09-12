#pragma once

#include "core/audience.h"
#include "core/library.h"
#include "core/playlists.h"
#include "core/settings.h"
#include "core/tag_write.h"
#include "core/timeline.h"

#include <cstddef>
#include <cstdint>
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
std::string capabilitiesDocument(const Settings& settings,
                                 const std::vector<std::string>& streamFormats,
                                 bool mutesWhileStreaming, bool servesLibrary);

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

// The small document a client polls for both generations. The snapshot itself is not JSON:
// core/library.h serialises it, and contract/openapi.yaml describes the bytes.
std::string libraryDocument(const Library::State& state);

std::string libraryRefusedDocument(const LibraryRequest& request);
std::string libraryFailedDocument(DeltaOutcome outcome);

int httpStatusFor(LibraryRefusal refusal);
int httpStatusFor(DeltaOutcome outcome);

}  // namespace jean
