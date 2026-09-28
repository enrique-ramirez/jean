#include "core/selection.h"

#include <algorithm>
#include <string>

using nlohmann::json;

namespace jean {

namespace {

int base64Value(char c) {
    if (c >= 'A' && c <= 'Z')
        return c - 'A';
    if (c >= 'a' && c <= 'z')
        return c - 'a' + 26;
    if (c >= '0' && c <= '9')
        return c - '0' + 52;
    if (c == '+')
        return 62;
    if (c == '/')
        return 63;
    return -1;
}

struct Base64Bytes {
    std::vector<uint8_t> bytes;
    bool ok = false;
};

// The inverse of ui/src/shared/api/fooJean.ts's base64Of: the same alphabet, decoded four
// characters at a time back to up to three bytes, with '=' only where that encoder ever
// writes it, at the end of the last group.
Base64Bytes decodeBase64(const std::string& text) {
    if (text.empty() || text.size() % 4 != 0)
        return {};

    Base64Bytes result;
    for (size_t at = 0; at < text.size(); at += 4) {
        int values[4] = {0, 0, 0, 0};
        int padding = 0;

        for (int part = 0; part < 4; ++part) {
            const char c = text[at + static_cast<size_t>(part)];
            if (c == '=') {
                ++padding;
                continue;
            }

            if (padding > 0)
                return {};

            values[part] = base64Value(c);
            if (values[part] < 0)
                return {};
        }

        if (padding > 2 || (padding > 0 && at + 4 != text.size()))
            return {};

        const auto group =
            (static_cast<uint32_t>(values[0]) << 18U) | (static_cast<uint32_t>(values[1]) << 12U) |
            (static_cast<uint32_t>(values[2]) << 6U) | static_cast<uint32_t>(values[3]);

        result.bytes.push_back(static_cast<uint8_t>(group >> 16U));
        if (padding < 2)
            result.bytes.push_back(static_cast<uint8_t>(group >> 8U));
        if (padding < 1)
            result.bytes.push_back(static_cast<uint8_t>(group));
    }

    result.ok = true;
    return result;
}

}  // namespace

bool namesOneSelectionForm(const json& root) {
    const int forms = (root.contains("runs") ? 1 : 0) + (root.contains("bitset") ? 1 : 0) +
                      (root.contains("ordinals") ? 1 : 0);
    return forms == 1;
}

SelectionResult decodeSelection(const json& root, size_t limit) {
    const auto inRange = [limit](uint64_t ordinal) { return ordinal < limit; };

    SelectionResult result;

    const auto ordinals = root.find("ordinals");
    if (ordinals != root.end()) {
        if (!ordinals->is_array())
            return {PlaylistRefusal::badOrdinals, {}};

        for (const auto& entry : *ordinals) {
            if (!entry.is_number_unsigned())
                return {PlaylistRefusal::badOrdinals, {}};

            const auto value = entry.get<uint64_t>();
            if (!inRange(value))
                return {PlaylistRefusal::badOrdinals, {}};

            result.ordinals.push_back(static_cast<uint32_t>(value));
        }

        return result;
    }

    const auto runs = root.find("runs");
    if (runs != root.end()) {
        if (!runs->is_array())
            return {PlaylistRefusal::badOrdinals, {}};

        // A run's count is a JSON number, so a body of a few dozen bytes can name a set no
        // process could hold. Every count is summed against `limit` before a single run is
        // expanded, so an oversized request costs the sum rather than the allocation.
        uint64_t total = 0;
        for (const auto& run : *runs) {
            if (!run.is_array() || run.size() != 2 || !run[0].is_number_unsigned() ||
                !run[1].is_number_unsigned())
                return {PlaylistRefusal::badOrdinals, {}};

            total += run[1].get<uint64_t>();
            if (total > limit)
                return {PlaylistRefusal::badOrdinals, {}};
        }

        for (const auto& run : *runs) {
            const auto start = run[0].get<uint64_t>();
            const auto count = run[1].get<uint64_t>();

            for (uint64_t at = 0; at < count; ++at) {
                const uint64_t ordinal = start + at;
                if (!inRange(ordinal))
                    return {PlaylistRefusal::badOrdinals, {}};

                result.ordinals.push_back(static_cast<uint32_t>(ordinal));
            }
        }

        std::sort(result.ordinals.begin(), result.ordinals.end());
        return result;
    }

    const auto bitset = root.find("bitset");
    if (bitset == root.end() || !bitset->is_string())
        return {PlaylistRefusal::badOrdinals, {}};

    const auto decoded = decodeBase64(bitset->get<std::string>());
    if (!decoded.ok)
        return {PlaylistRefusal::badOrdinals, {}};

    for (size_t byteIndex = 0; byteIndex < decoded.bytes.size(); ++byteIndex) {
        for (unsigned bit = 0; bit < 8; ++bit) {
            if ((decoded.bytes[byteIndex] & (1U << bit)) == 0U)
                continue;

            const uint64_t ordinal = (byteIndex * 8) + static_cast<uint64_t>(bit);
            if (!inRange(ordinal))
                return {PlaylistRefusal::badOrdinals, {}};

            result.ordinals.push_back(static_cast<uint32_t>(ordinal));
        }
    }

    return result;
}

}  // namespace jean
