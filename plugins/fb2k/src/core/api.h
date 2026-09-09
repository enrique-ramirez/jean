#pragma once

#include "core/audience.h"
#include "core/playlists.h"
#include "core/settings.h"
#include "core/tag_write.h"
#include "core/timeline.h"

#include <string>

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
                                 bool mutesWhileStreaming);

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

}  // namespace jean
