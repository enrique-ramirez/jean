#pragma once

#include "core/documents.h"
#include "core/library.h"
#include "core/library_roles.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace jean {

std::vector<std::string> playlistRunsColumns(const Snapshot& snapshot, const LibraryRoles& roles);

struct PlaylistRuns {
    std::vector<uint32_t> lengths;
    double mostPlays = 0;
    size_t albumCount = 0;
    size_t trackCount = 0;
    double seconds = 0;
    std::optional<double> earliestYear;
    std::optional<double> latestYear;

    bool operator==(const PlaylistRuns&) const = default;
};

PlaylistRuns playlistRunsOf(const Snapshot& snapshot, const LibraryRoles& roles,
                            const std::vector<PlaylistTrack>& rows);

uint64_t playlistRunsHash(const PlaylistRuns& runs);

class HeldPlaylistRuns {
public:
    HeldPlaylistRuns();
    ~HeldPlaylistRuns();

    HeldPlaylistRuns(const HeldPlaylistRuns&) = delete;
    HeldPlaylistRuns& operator=(const HeldPlaylistRuns&) = delete;

    std::shared_ptr<const PlaylistRuns> of(const std::string& playlistId,
                                           const PlaylistTracksRead& read, const Snapshot& snapshot,
                                           const LibraryRoles& roles);

    size_t builds() const;

    struct Held;

private:
    std::unique_ptr<Held> held_;
};

}  // namespace jean
