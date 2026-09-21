#include "support/keys.h"

#include <algorithm>
#include <iterator>

namespace jean::testing {

Keys keysOf(const nlohmann::json& object) {
    const auto fields = object.items();

    Keys keys;
    std::transform(fields.begin(), fields.end(), std::inserter(keys, keys.end()),
                   [](const auto& field) { return field.key(); });
    return keys;
}

Keys keysOf(const std::string& document) {
    return keysOf(nlohmann::json::parse(document));
}

}  // namespace jean::testing
