#pragma once

#include <cstdint>
#include <string>

// Text files through foobar2000's own filesystem, which the path form from paths.h requires.
namespace jean {

std::string readTextFile(const std::string& path, size_t maxBytes);

void writeTextFile(const std::string& path, const std::string& text);

void appendTextFile(const std::string& path, const std::string& text, uint64_t limitBytes);

}  // namespace jean
