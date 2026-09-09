#pragma once

#include <string>

// Whole strings rather than a printf format, so a client-supplied format string is not a
// mistake available here.
namespace jean {

void logInfo(const std::string& message);
void logError(const std::string& message);

}  // namespace jean
