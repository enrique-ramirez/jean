#include "core/text.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <functional>
#include <limits>
#include <numeric>

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

uint64_t fold(const std::string& bytes) {
    uint64_t digest = kFoldBasis;
    for (const char byte : bytes) {
        digest ^= static_cast<unsigned char>(byte);
        digest *= kFoldPrime;
    }
    return digest;
}

std::string quotedHex(uint64_t digest) {
    constexpr char kDigits[] = "0123456789abcdef";

    std::string text(sizeof(digest) * kHexDigitsPerByte, '0');
    for (size_t at = text.size(); at > 0; --at) {
        text[at - 1] = kDigits[digest & 0xFU];
        digest >>= 4U;
    }

    return "\"" + text + "\"";
}

}  // namespace

std::string toLower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
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
               return std::tolower(x) == std::tolower(y);
           });
}

bool isPrintable(const std::string& text) {
    return std::none_of(text.begin(), text.end(),
                        [](unsigned char c) { return c < 0x20 || c == 0x7f; });
}

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

std::string eTagFor(const std::string& bytes) {
    return quotedHex(fold(bytes));
}

}  // namespace jean
