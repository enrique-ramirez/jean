#pragma once

#include "core/playlists.h"

#include <cstddef>
#include <optional>

// What this component writes on a playlist to know it again: foobar2000 keeps a playlist's
// properties across restarts and renames, so a role or an autoplaylist record survives both.
// Main thread only.
namespace jean {

// The role one of this component's own playlists carries, or nothing for any other playlist.
std::optional<OwnPlaylistRole> roleOf(size_t index);

void markRole(size_t index, OwnPlaylistRole role);

// pfc::infinite_size where no playlist carries `role`.
size_t findOwnPlaylist(OwnPlaylistRole role);

// Whether this component made the playlist as an autoplaylist, and so may change it.
bool ours(size_t index);

// The SDK cannot read an autoplaylist's query back, so this component keeps its own record of
// one: ARCHITECTURE.md, *Facts about the player*.
std::optional<AutoPlaylistSpec> storedAutoPlaylist(size_t index);

void recordAutoPlaylist(size_t index, const AutoPlaylistSpec& spec);

}  // namespace jean
