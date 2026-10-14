#pragma once

#include "core/assets.h"
#include "core/player.h"

#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace jean {

namespace generated {
std::span<const EmbeddedFile> embeddedUiFiles();
}  // namespace generated

std::optional<std::string_view> readEmbeddedPage(const std::string& path);

std::vector<std::string> embeddedPageNames();

DiskPage readWwwPage(const std::string& path);

}  // namespace jean
