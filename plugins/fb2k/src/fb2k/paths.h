#pragma once

#include <filesystem>
#include <string>

namespace jean {

std::string componentDir();
std::string configPath();
std::string logPath();
std::string wwwDir();

void ensureComponentDir();

// core_api::pathInProfile answers a "file://" path, and std::filesystem needs the form Windows
// itself resolves symlinks and junctions against.
std::filesystem::path nativePathOf(const std::string& profilePath);

}  // namespace jean
