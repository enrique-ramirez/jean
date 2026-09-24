#pragma once

#include "core/http_server.h"

#include <optional>
#include <string>
#include <vector>

namespace jean {

std::optional<std::string> readEmbeddedPage(const std::string& path);

std::vector<std::string> embeddedPageNames();

DiskPage readWwwPage(const std::string& path);

}  // namespace jean
