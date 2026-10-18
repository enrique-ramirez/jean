#pragma once

#include <cstddef>
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

constexpr size_t kMostCodePointsADecompositionTakes = 4;

struct Decomposition {
    uint32_t from;
    uint32_t to[kMostCodePointsADecompositionTakes];
};

struct MarkRankRange {
    uint32_t first;
    uint32_t last;
    uint32_t rank;
};

constexpr size_t kMostCharactersAnAsciiFoldingTakes = 7;

struct AsciiFolding {
    uint32_t from;
    char to[kMostCharactersAnAsciiFoldingTakes + 1];
};

std::span<const LowerMapping> lowerMappings();
std::span<const Decomposition> decompositions();
std::span<const MarkRankRange> markRanks();
std::span<const CodePointRange> casedRanges();
std::span<const CodePointRange> caseIgnorableRanges();
std::span<const CodePointRange> diacriticRanges();
std::span<const CodePointRange> letterRanges();
std::span<const CodePointRange> numberRanges();
std::span<const AsciiFolding> asciiFoldings();

}  // namespace jean
