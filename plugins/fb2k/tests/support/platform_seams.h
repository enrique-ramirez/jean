#pragma once

#include <map>
#include <set>
#include <string>

namespace jean::testing {

enum class Seam {
    conditional,
    systemHeader,
    platformName,
};

const char* seamName(Seam seam);

std::set<Seam> seamsOf(const std::string& path, const std::string& text);

std::map<std::string, std::set<Seam>> seamsUnderSource();

}  // namespace jean::testing
