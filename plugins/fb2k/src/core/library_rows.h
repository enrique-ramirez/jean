#pragma once

#include "core/library.h"
#include "core/playlists.h"

#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace jean {

constexpr size_t kMaxRowsPerAnswer = 4096;

struct RowsRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    LibraryRequest declaration;
    uint64_t structure = 0;
    std::vector<uint32_t> ordinals;
};

RowsRequest parseRowsRequest(const std::string& body);

// The rows at `ordinals`, in that order and repeats kept, as a JLIB body. Each column's
// dictionary holds only the values those rows use, in bytewise order, under ids of the width that
// dictionary needs; the header's `distinct`, `hasUnresolved` and `allUnresolved` still describe the
// whole library. Every ordinal MUST be below `snapshot.trackCount()`.
std::string serialiseRows(const Snapshot& snapshot, std::span<const uint32_t> ordinals);

}  // namespace jean
