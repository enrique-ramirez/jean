#include "core/text.h"

#include <algorithm>
#include <cctype>
#include <functional>
#include <numeric>

namespace jean {

namespace {

std::string trimmed(const std::string& text) {
    const size_t first = text.find_first_not_of(" \t");
    if (first == std::string::npos)
        return {};

    return text.substr(first, text.find_last_not_of(" \t") - first + 1);
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

}  // namespace jean
