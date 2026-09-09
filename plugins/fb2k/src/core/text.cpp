#include "core/text.h"

#include <algorithm>
#include <cctype>
#include <functional>
#include <numeric>

namespace jean {

std::string toLower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
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
