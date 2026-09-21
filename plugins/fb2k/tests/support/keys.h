#pragma once

#include "third_party/json.hpp"

#include <set>
#include <string>

namespace jean::testing {

using Keys = std::set<std::string>;

Keys keysOf(const nlohmann::json& object);
Keys keysOf(const std::string& document);

}  // namespace jean::testing
