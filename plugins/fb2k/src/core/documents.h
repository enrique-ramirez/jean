#pragma once

#include "core/audience.h"
#include "core/failures.h"
#include "core/library.h"
#include "core/main_thread_watch.h"
#include "core/outputs.h"
#include "core/player_state.h"
#include "core/playlists.h"
#include "core/session.h"
#include "core/settings.h"
#include "core/tag_write.h"
#include "core/timeline.h"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

// Every JSON document this component publishes but the refusals and failures, which
// core/failures.h builds, and the values the player reads them from; see ARCHITECTURE.md, *The
// HTTP contract*.
namespace jean {

std::string statusDocument();

struct PlayerReport;

struct SessionCapacity {
    bool startsStreams = false;
    int maxSessions = 0;
};

bool canStream(const Settings& settings, const std::vector<std::string>& streamFormats);
bool canCreateSessions(const Settings& settings, const std::vector<std::string>& streamFormats,
                       const SessionCapacity& capacity);

// `mutesWhileStreaming` is whether this install actually holds the player's output, not
// whether it was asked to: the setting alone is true on an install with no encoder, where
// there is nothing to hold and DELETE /stream/hold answers 503.
//
// `report` is read once from the player and never changes while it runs, which is why it rides
// this document and not the poll: see GET /state's `PlayerState.volume`, which is a bare number
// in this same range. The document maps each of its playback orders through
// core/playback_modes.h and keeps the ones that answer, so an order this component has no Jean
// name for is offered to a client not at all.
std::string capabilitiesDocument(const Settings& settings, const PlayerReport& report,
                                 const std::vector<std::string>& streamFormats,
                                 bool mutesWhileStreaming, bool servesLibrary,
                                 const SessionCapacity& sessions);

std::vector<std::string> playbackModesOf(const std::vector<std::string>& playbackOrders);

struct SessionView {
    std::string id;
    bool detached = false;
    bool shared = false;
    PlayerState state;
    size_t listeners = 0;
    std::vector<std::string> playbackModes;
    bool chainDropped = false;
    std::vector<SessionReport> reports;
    std::optional<DeviceIdentity> createdBy;
};

std::string sessionDocument(const SessionView& session);
std::string sessionsDocument(const std::vector<SessionView>& sessions);

std::string streamListenersDocument(const std::vector<AudienceMember>& members, int connections,
                                    int maxConnections, bool playerMuted);

std::string streamTicketDocument(const std::string& ticket, int expiresInSeconds);

std::string streamTimelineDocument(double streamTime, const std::vector<StreamMark>& marks);

std::string tagWrittenDocument(const TagWrite& write);

std::string playlistsDocument(const std::vector<PlaylistAnnotation>& playlists);

std::string playlistDocument(const PlaylistAnnotation& playlist);
std::string playlistRemovedDocument(const std::string& id);
std::string queryPreviewDocument(const PreviewResult& preview);

std::string fillResultDocument(const std::string& playlistId, uint64_t structure,
                               const std::vector<size_t>& positions,
                               const std::vector<uint32_t>& skipped);

std::string copiedRowsDocument(uint64_t structure, const std::vector<size_t>& positions,
                               const std::vector<uint32_t>& skipped);
std::string removedRowsDocument(uint64_t structure);
std::string movedRowsDocument(uint64_t structure);
std::string sortedRowsDocument(uint64_t structure, const std::vector<uint32_t>& order);

// One row of a playlist: the columns the client declared, evaluated against the row's own
// handle in the order it declared them, the library path GET /api/artwork?track= takes where
// the media library holds the track, and the subsong of the handle itself, which foobar2000
// carries whether the media library holds the track or not.
struct PlaylistRow {
    std::vector<std::string> columns;
    std::optional<std::string> libraryPath;
    uint32_t subsong = 0;
    std::optional<std::optional<std::string>> cover;
};

// One row of a playlist: a row the media library holds by its ordinal at
// PlaylistTracksRead::libraryStructure and no columns; any other by `columns`, evaluated against
// its own handle.
struct PlaylistTrack {
    std::optional<uint32_t> ordinal;
    std::vector<std::string> columns;
};

// Every row of a playlist, at the playlist's own pair, its handles copied in one main-thread job.
struct PlaylistTracksRead {
    PlayerOutcome outcome = PlayerOutcome::done;
    uint64_t structure = 0;
    uint64_t revision = 0;
    uint64_t libraryStructure = 0;
    std::vector<PlaylistTrack> rows;
};

struct PlaylistRowsRead {
    PlayerOutcome outcome = PlayerOutcome::done;

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
    PlayerOutcome outcome = PlayerOutcome::done;
    ReadOutcome catchUp = ReadOutcome::ok;

    uint64_t revision = 0;

    std::vector<ChangedPlaylistRow> rows;
};

std::string playlistChangesDocument(const PlaylistChangesRead& read);

std::string outputsDocument(const OutputsRead& read);

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

    // Set exactly when the request named roles: the library path of the album's cover track, or
    // null where there is none.
    std::optional<std::optional<std::string>> cover;
};

struct QueueRead {
    PlayerOutcome outcome = PlayerOutcome::done;
    uint64_t revision = 0;
    std::vector<QueuedTrack> entries;
};

std::string queueDocument(const QueueRead& read);

struct QueuePosition {
    uint32_t index = 0;
    uint64_t revision = 0;
};

std::string libraryDocument(const Library::State& state);

struct PlayerRevisions {
    uint64_t queue = 0;
    uint64_t playlists = 0;
    uint64_t timeline = 0;
    uint64_t session = 0;
};

std::string stateDocument(const Library::State& state, const PlayerState& player,
                          std::chrono::steady_clock::time_point now, PlayerRevisions revisions = {},
                          std::optional<uint64_t> configGeneration = std::nullopt,
                          MainThreadHealth mainThread = {});

// One track's declared columns, in the order declared. The address the caller sent is not
// echoed back.
std::string libraryTrackDocument(const std::vector<std::string>& columns);

std::string playingTrackDocument(const std::string& path, uint32_t subsong,
                                 const std::vector<std::string>& columns);

}  // namespace jean
