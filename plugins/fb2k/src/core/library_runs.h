#pragma once

#include "core/library.h"
#include "core/library_roles.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

namespace jean {

struct LibraryRuns {
    std::vector<uint32_t> lengths;
    std::vector<uint32_t> covers;
    std::vector<uint32_t> untagged;

    bool operator==(const LibraryRuns&) const = default;
};

LibraryRuns libraryRunsOf(const Snapshot& snapshot, const LibraryRoles& roles);

uint64_t runsHash(const LibraryRuns& runs);

class HeldLibraryRuns {
public:
    HeldLibraryRuns();
    ~HeldLibraryRuns();

    HeldLibraryRuns(const HeldLibraryRuns&) = delete;
    HeldLibraryRuns& operator=(const HeldLibraryRuns&) = delete;

    std::shared_ptr<const LibraryRuns> of(const Snapshot& snapshot, const LibraryRoles& roles);

    size_t builds() const;

    struct Held;

private:
    std::unique_ptr<Held> held_;
};

}  // namespace jean
