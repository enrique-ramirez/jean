#pragma once

#include <string>

namespace jean {

// Empty on failure, and on any platform with no decided source of real randomness.
std::string mintTicket();

}  // namespace jean
