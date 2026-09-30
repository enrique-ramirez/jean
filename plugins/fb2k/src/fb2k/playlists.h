#pragma once

#include "core/player_state.h"
#include "core/playlists.h"

#include <foobar2000/SDK/foobar2000.h>

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

// What every playlist file here shares: finding a playlist, naming it, and describing it the way
// GET /api/playlists does. Main thread only, like every playlist_manager call.
namespace jean {

// The SDK offers a count and a getter rather than a range; this turns that into something
// foldable.
std::vector<size_t> playlistIndices();

// pfc::infinite_size when nothing matches. pfc::GUID_from_text never reports a failure, so after
// the shape check in core/playlists.h this is the only thing that can say "no such playlist".
size_t findPlaylist(const std::string& id);

// GUID, lowercased, dashed, no braces.
std::string playlistId(size_t index);

std::string playlistTitle(size_t index);

std::optional<PlayingLocation> queuedLocationOf(const t_playback_queue_item& item);

// The counts and the two versions are read in one main-thread turn, which is also where the
// version callbacks run, so they describe one state of the player rather than two.
PlaylistAnnotation annotate(size_t index, const PlaylistVersions& versions);

std::vector<PlaylistAnnotation> everyPlaylist(const PlaylistVersions& versions);

// foobar2000 holds a playlist's lock as a mask of the edits it refuses (filter_add,
// filter_remove, filter_rename, filter_remove_playlist), so it is read rather than inferred from
// a failed call.
bool lockRefuses(size_t index, uint32_t filter);

// `kind` names the playlist in the log line.
PlaylistResult removePlaylistAt(size_t index, const std::string& kind);

}  // namespace jean
