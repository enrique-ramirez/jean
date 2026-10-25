#pragma once

#include "core/library.h"
#include "support/wire.h"

#include <cstdint>
#include <map>
#include <span>
#include <string>
#include <vector>

namespace jean::testing {

using Cells = std::map<std::string, std::vector<std::string>>;

Cells cellsOf(const Wire& rows);

Cells cellsAt(const Snapshot& snapshot, std::span<const uint32_t> ordinals);

std::vector<std::string> usedValues(const std::vector<std::string>& cells);

}  // namespace jean::testing
