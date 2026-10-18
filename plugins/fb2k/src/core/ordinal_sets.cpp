#include "core/ordinal_sets.h"

#include <span>
#include <string>
#include <utility>
#include <vector>

using nlohmann::json;

namespace jean {

namespace {

constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64Of(const std::vector<uint8_t>& bytes) {
    std::string text;
    text.reserve(4 * ((bytes.size() + 2) / 3));

    for (size_t at = 0; at < bytes.size(); at += 3) {
        const size_t left = bytes.size() - at;
        const uint32_t group = (static_cast<uint32_t>(bytes[at]) << 16U) |
                               (left > 1 ? static_cast<uint32_t>(bytes[at + 1]) << 8U : 0U) |
                               (left > 2 ? static_cast<uint32_t>(bytes[at + 2]) : 0U);

        text.push_back(kAlphabet[(group >> 18U) & 63U]);
        text.push_back(kAlphabet[(group >> 12U) & 63U]);
        text.push_back(left > 1 ? kAlphabet[(group >> 6U) & 63U] : '=');
        text.push_back(left > 2 ? kAlphabet[group & 63U] : '=');
    }

    return text;
}

struct Run {
    uint32_t start;
    uint32_t count;
};

std::vector<Run> runsOf(std::span<const uint32_t> ordinals) {
    std::vector<Run> runs;
    for (const uint32_t ordinal : ordinals) {
        if (!runs.empty() && runs.back().start + runs.back().count == ordinal)
            runs.back().count += 1;
        else
            runs.push_back({ordinal, 1});
    }
    return runs;
}

size_t digitsOf(uint32_t number) {
    size_t digits = 1;
    for (; number >= 10; number /= 10)
        digits += 1;
    return digits;
}

size_t jsonLength(const std::vector<Run>& runs) {
    size_t length = 2 + (runs.empty() ? 0 : runs.size() - 1);
    for (const Run& run : runs)
        length += 3 + digitsOf(run.start) + digitsOf(run.count);
    return length;
}

}  // namespace

json ordinalSetDocument(std::span<const uint32_t> ordinals, size_t trackCount) {
    const std::vector<Run> runs = runsOf(ordinals);

    const size_t bitsetBytes = (trackCount + 7) / 8;
    const size_t bitsetLength = 4 * ((bitsetBytes + 2) / 3);
    if (ordinals.empty() || jsonLength(runs) <= bitsetLength) {
        json pairs = json::array();
        for (const Run& run : runs)
            pairs.push_back(json::array({run.start, run.count}));
        return json{{"runs", std::move(pairs)}};
    }

    std::vector<uint8_t> bits(bitsetBytes, 0);
    for (const uint32_t ordinal : ordinals)
        bits[ordinal / 8] = static_cast<uint8_t>(bits[ordinal / 8] | (1U << (ordinal % 8)));

    return json{{"bitset", base64Of(bits)}};
}

}  // namespace jean
