#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <optional>
#include <vector>

namespace jean {

struct Snapshot;

constexpr uint32_t kNoRow = std::numeric_limits<uint32_t>::max();

struct SpliceStep {
    std::vector<uint32_t> removed;
    std::vector<uint32_t> inserted;
};

struct Retained {
    uint64_t revision = 0;

    std::vector<std::vector<uint32_t>> ordinals;

    std::vector<uint32_t> dictionarySizes;

    std::optional<SpliceStep> splice;
};

enum class Landing { spliced, rearranged, compacted };

struct Merged {
    Landing landing = Landing::rearranged;

    std::shared_ptr<Snapshot> snapshot;

    Retained step;
};

bool sameColumns(const Snapshot& a, const Snapshot& b);

bool sameTrack(const Snapshot& was, size_t wasRow, const Snapshot& is, size_t isRow);

bool worthKeeping(size_t live, size_t dead, size_t bytes, size_t maxBytes);

std::vector<uint32_t> originAfter(const std::vector<uint32_t>& origin,
                                  const std::vector<uint32_t>& removed,
                                  const std::vector<uint32_t>& inserted);

Merged mergeOnto(const Snapshot& was, const Snapshot& next, size_t maxBytes);

}  // namespace jean
