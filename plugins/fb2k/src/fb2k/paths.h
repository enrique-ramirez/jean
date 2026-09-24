#pragma once

#include <string>

namespace jean {

std::string componentDir();
std::string configPath();
std::string logPath();
std::string wwwDir();

void ensureComponentDir();

std::string discoveryRecordPath();
bool beefwebPresent();

}  // namespace jean
