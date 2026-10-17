#pragma once

#include <cstdint>
#include <span>

namespace jean {

// What String.prototype.toLowerCase turns `from` into: `first`, then `second` unless it is zero.
struct LowerMapping {
    uint32_t from;
    uint32_t first;
    uint32_t second;
};

struct CodePointRange {
    uint32_t first;
    uint32_t last;
};

std::span<const LowerMapping> lowerMappings();
std::span<const CodePointRange> casedRanges();
std::span<const CodePointRange> caseIgnorableRanges();

}  // namespace jean
