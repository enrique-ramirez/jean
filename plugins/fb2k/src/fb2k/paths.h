#pragma once

#include <string>

namespace jean {

std::string componentDir();
std::string configPath();
std::string logPath();
std::string wwwDir();

void ensureComponentDir();

}  // namespace jean
