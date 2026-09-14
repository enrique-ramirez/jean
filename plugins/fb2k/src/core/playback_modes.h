#pragma once

#include <optional>
#include <string>

// Jean's own names for a playback order, and the map to and from whatever foobar2000 calls its
// own. foobar2000's own order names are extensible -- a component can register one of its own --
// so the map is a lookup rather than an enum, and a name on neither side is absent rather than
// guessed at.
namespace jean {

std::optional<std::string> jeanModeFor(const std::string& playerOrder);
std::optional<std::string> playerOrderFor(const std::string& jeanMode);

}  // namespace jean
