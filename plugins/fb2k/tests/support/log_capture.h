#pragma once

#include <string>
#include <vector>

namespace jean::testing {

std::vector<std::string> loggedLines();
bool logged(const std::string& fragment);
void clearLog();

}  // namespace jean::testing
