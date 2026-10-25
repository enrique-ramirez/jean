#pragma once

#include "core/documents.h"
#include "core/library.h"
#include "core/library_entities.h"
#include "core/library_roles.h"

#include <cstdint>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace jean {

std::vector<std::string> playlistFindColumns(const Snapshot& snapshot, const LibraryRoles& roles);

std::vector<uint32_t> playlistMatches(const Snapshot& snapshot, const LibraryRoles& roles,
                                      const SearchText& folded, const SearchText& glyphs,
                                      std::span<const PlaylistTrack> rows, std::string_view query);

}  // namespace jean
