#pragma once

#include <map>
#include <optional>
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

std::optional<std::string> repositoryFileText(const std::string& path);

}  // namespace jean::testing
