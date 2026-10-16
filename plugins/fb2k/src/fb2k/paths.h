#pragma once

#include <filesystem>
#include <string>

namespace jean {

std::string componentDir();
std::string configPath();
std::string logPath();
std::string wwwDir();

std::string displayConfigPath();

void ensureComponentDir();

// core_api::pathInProfile answers a "file://" path, and std::filesystem needs the form the
// operating system itself resolves symlinks and junctions against: a drive path on Windows, and
// on macOS an absolute one, where g_get_display_path would answer "~/...".
std::filesystem::path nativePathOf(const std::string& profilePath);

}  // namespace jean
