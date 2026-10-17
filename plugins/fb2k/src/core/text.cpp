#include "core/text.h"

#include "core/unicode_lower.h"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <limits>
#include <numeric>
#include <optional>
#include <span>
#include <utility>

namespace jean {

namespace {

std::string trimmed(const std::string& text) {
    const size_t first = text.find_first_not_of(" \t");
    if (first == std::string::npos)
        return {};

    return text.substr(first, text.find_last_not_of(" \t") - first + 1);
}

// FNV-1a. The basis and the prime are the algorithm's own and not a choice made here.
constexpr uint64_t kFoldBasis = 14695981039346656037ULL;
constexpr uint64_t kFoldPrime = 1099511628211ULL;

constexpr size_t kHexDigitsPerByte = 2;
constexpr char kHexDigits[] = "0123456789abcdef";

// macOS's tolower maps 0xC3 to 0xE3 under a UTF-8 LC_CTYPE, which would corrupt the lead byte of
// a UTF-8 sequence, so the fold is written out and answers to no locale.
unsigned char foldAscii(unsigned char c) {
    return c >= 'A' && c <= 'Z' ? static_cast<unsigned char>(c + ('a' - 'A')) : c;
}

uint64_t fold(std::string_view bytes) {
    uint64_t digest = kFoldBasis;
    for (const char byte : bytes) {
        digest ^= static_cast<unsigned char>(byte);
        digest *= kFoldPrime;
    }
    return digest;
}

std::string quotedHex(uint64_t digest) {
    std::string text(sizeof(digest) * kHexDigitsPerByte, '0');
    for (size_t at = text.size(); at > 0; --at) {
        text[at - 1] = kHexDigits[digest & 0xFU];
        digest >>= 4U;
    }

    return "\"" + text + "\"";
}

constexpr char32_t kRawByteBase = 0x110000;
constexpr char32_t kCapitalSigma = 0x03A3;
constexpr char32_t kSmallSigma = 0x03C3;
constexpr char32_t kFinalSigma = 0x03C2;
constexpr char32_t kSpace = 0x20;

// ECMAScript's WhiteSpace and LineTerminator productions, which is what \s matches.
bool isEcmaWhitespace(char32_t c) {
    return (c >= 0x09 && c <= 0x0D) || c == kSpace || c == 0xA0 || c == 0x1680 ||
           (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 || c == 0x202F ||
           c == 0x205F || c == 0x3000 || c == 0xFEFF;
}

std::optional<std::pair<char32_t, size_t>> decodeSequence(std::string_view bytes) {
    const auto at = [&](size_t index) { return static_cast<unsigned char>(bytes[index]); };
    const auto continues = [&](size_t index) {
        return index < bytes.size() && (at(index) & 0xC0U) == 0x80U;
    };

    const unsigned lead = at(0);
    if (lead < 0x80)
        return std::pair{static_cast<char32_t>(lead), size_t{1}};

    size_t length = 0;
    char32_t minimum = 0;
    if (lead >= 0xC2 && lead <= 0xDF) {
        length = 2;
        minimum = 0x80;
    } else if (lead >= 0xE0 && lead <= 0xEF) {
        length = 3;
        minimum = 0x800;
    } else if (lead >= 0xF0 && lead <= 0xF4) {
        length = 4;
        minimum = 0x10000;
    } else {
        return std::nullopt;
    }

    char32_t point = lead & (0xFFU >> (length + 1));
    for (size_t index = 1; index < length; ++index) {
        if (!continues(index))
            return std::nullopt;
        point = (point << 6U) | (at(index) & 0x3FU);
    }

    const bool surrogate = point >= 0xD800 && point <= 0xDFFF;
    if (point < minimum || point > 0x10FFFF || surrogate)
        return std::nullopt;

    return std::pair{point, length};
}

std::vector<char32_t> decodeLenient(std::string_view bytes) {
    std::vector<char32_t> points;
    points.reserve(bytes.size());
    for (size_t at = 0; at < bytes.size();) {
        if (const auto sequence = decodeSequence(bytes.substr(at))) {
            points.push_back(sequence->first);
            at += sequence->second;
        } else {
            points.push_back(kRawByteBase + static_cast<unsigned char>(bytes[at]));
            ++at;
        }
    }
    return points;
}

void appendUtf8(std::string& out, char32_t point) {
    const auto put = [&](char32_t value) { out.push_back(static_cast<char>(value & 0xFFU)); };

    if (point >= kRawByteBase) {
        put(point - kRawByteBase);
    } else if (point < 0x80) {
        put(point);
    } else if (point < 0x800) {
        put(0xC0U | (point >> 6U));
        put(0x80U | (point & 0x3FU));
    } else if (point < 0x10000) {
        put(0xE0U | (point >> 12U));
        put(0x80U | ((point >> 6U) & 0x3FU));
        put(0x80U | (point & 0x3FU));
    } else {
        put(0xF0U | (point >> 18U));
        put(0x80U | ((point >> 12U) & 0x3FU));
        put(0x80U | ((point >> 6U) & 0x3FU));
        put(0x80U | (point & 0x3FU));
    }
}

bool inRanges(std::span<const CodePointRange> ranges, char32_t point) {
    const auto above = std::lower_bound(
        ranges.begin(), ranges.end(), point,
        [](const CodePointRange& range, char32_t value) { return range.last < value; });
    return above != ranges.end() && above->first <= point;
}

bool casedBeyondIgnorables(const std::vector<char32_t>& points, size_t from, bool backwards) {
    for (size_t at = from; at < points.size(); backwards ? --at : ++at) {
        if (inRanges(caseIgnorableRanges(), points[at])) {
            if (backwards && at == 0)
                return false;
            continue;
        }
        return inRanges(casedRanges(), points[at]);
    }
    return false;
}

// The Final_Sigma condition of the Unicode Standard's SpecialCasing, which ECMA-262 defers to.
bool isFinalSigma(const std::vector<char32_t>& points, size_t at) {
    return at > 0 && casedBeyondIgnorables(points, at - 1, true) &&
           !casedBeyondIgnorables(points, at + 1, false);
}

void appendLowered(std::string& out, const std::vector<char32_t>& points, size_t at) {
    const char32_t point = points[at];
    if (point == kCapitalSigma) {
        appendUtf8(out, isFinalSigma(points, at) ? kFinalSigma : kSmallSigma);
        return;
    }
    if (point >= kRawByteBase) {
        appendUtf8(out, point);
        return;
    }

    const auto mappings = lowerMappings();
    const auto found = std::lower_bound(
        mappings.begin(), mappings.end(), point,
        [](const LowerMapping& mapping, char32_t value) { return mapping.from < value; });
    if (found == mappings.end() || found->from != point) {
        appendUtf8(out, point);
        return;
    }

    appendUtf8(out, found->first);
    if (found->second != 0)
        appendUtf8(out, found->second);
}

}  // namespace

std::string toLower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(foldAscii(c)); });
    return value;
}

std::string tagKey(std::string_view tag) {
    const std::vector<char32_t> points = decodeLenient(tag);

    size_t first = 0;
    size_t last = points.size();
    while (first < last && isEcmaWhitespace(points[first]))
        ++first;
    while (last > first && isEcmaWhitespace(points[last - 1]))
        --last;

    std::string key;
    key.reserve(tag.size());
    bool inSpace = false;
    for (size_t at = first; at < last; ++at) {
        if (isEcmaWhitespace(points[at])) {
            if (!inSpace)
                appendUtf8(key, kSpace);
            inSpace = true;
            continue;
        }

        inSpace = false;
        appendLowered(key, points, at);
    }
    return key;
}

std::string toHex(std::span<const unsigned char> bytes) {
    std::string text;
    text.reserve(bytes.size() * kHexDigitsPerByte);
    for (const unsigned char byte : bytes) {
        text.push_back(kHexDigits[byte >> 4U]);
        text.push_back(kHexDigits[byte & 0xFU]);
    }
    return text;
}

std::string forwardSlashed(std::string path, char separator) {
    std::replace(path.begin(), path.end(), separator, '/');
    return path;
}

std::vector<std::string> splitOn(const std::string& text, char delimiter) {
    std::vector<std::string> elements;

    for (size_t at = 0; at <= text.size();) {
        const size_t next = std::min(text.find(delimiter, at), text.size());

        auto element = trimmed(text.substr(at, next - at));
        if (!element.empty())
            elements.push_back(std::move(element));

        at = next + 1;
    }

    return elements;
}

bool equalsIgnoringCase(const std::string& a, const std::string& b) {
    return a.size() == b.size() &&
           std::equal(a.begin(), a.end(), b.begin(), [](unsigned char x, unsigned char y) {
               return foldAscii(x) == foldAscii(y);
           });
}

bool isPrintable(const std::string& text) {
    return std::none_of(text.begin(), text.end(),
                        [](unsigned char c) { return c < 0x20 || c == 0x7f; });
}

// The C++ standard defines std::inner_product as a visit to every element, where std::equal and
// std::mismatch are specified as at most that many applications and may stop at the first
// difference.
bool secureEquals(const std::string& a, const std::string& b) {
    const auto shared = static_cast<std::ptrdiff_t>(std::min(a.size(), b.size()));
    const auto seed = static_cast<unsigned>(a.size() ^ b.size());

    const auto differences =
        std::inner_product(a.begin(), a.begin() + shared, b.begin(), seed, std::bit_or<unsigned>(),
                           [](char lhs, char rhs) {
                               return static_cast<unsigned>(static_cast<unsigned char>(lhs) ^
                                                            static_cast<unsigned char>(rhs));
                           });

    return differences == 0;
}

bool readDecimal(const std::string& text, uint64_t& value) {
    constexpr size_t kMaxDigits = 20;

    if (text.empty() || text.size() > kMaxDigits)
        return false;

    uint64_t result = 0;
    for (const char digit : text) {
        if (digit < '0' || digit > '9')
            return false;

        const auto step = static_cast<uint64_t>(digit - '0');
        if (result > (std::numeric_limits<uint64_t>::max() - step) / 10)
            return false;

        result = (result * 10) + step;
    }

    value = result;
    return true;
}

bool fitsUint32(uint64_t value) {
    return value <= std::numeric_limits<uint32_t>::max();
}

std::string eTagFor(std::string_view bytes) {
    return quotedHex(fold(bytes));
}

}  // namespace jean
