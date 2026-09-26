#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace jean::testing {

std::vector<std::string> loggedLines();
bool logged(const std::string& fragment);
void clearLog();

size_t errorLinesContaining(const std::string& fragment);

size_t refusalBursts(const std::vector<int>& statuses);

}  // namespace jean::testing
