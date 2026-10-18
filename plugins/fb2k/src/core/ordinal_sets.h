#pragma once

#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <span>

namespace jean {

nlohmann::json ordinalSetDocument(std::span<const uint32_t> ordinals, size_t trackCount);

}  // namespace jean
