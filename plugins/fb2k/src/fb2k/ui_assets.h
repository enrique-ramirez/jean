#pragma once

#include "core/player.h"

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace jean {

std::optional<std::string_view> readEmbeddedPage(const std::string& path);

std::vector<std::string> embeddedPageNames();

DiskPage readWwwPage(const std::string& path);

}  // namespace jean
