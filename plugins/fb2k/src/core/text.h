#pragma once

#include <string>

namespace jean {

std::string toLower(std::string value);

// An allowlist of "rating" that let "RATING" through would not be an allowlist.
bool equalsIgnoringCase(const std::string& a, const std::string& b);

// No C0 controls and no DEL. Everything a client sends is eventually written somewhere that
// treats those as structure rather than text: a newline forges a line in foo_jean.log, a NUL
// truncates a string inside the SDK, and a carriage return rewrites a playlist tab. UTF-8
// continuation bytes are all >= 0x80 and pass, so accented filenames are unaffected.
bool isPrintable(const std::string& text);

// No early exit: == leaks how much of a guess was right.
bool secureEquals(const std::string& a, const std::string& b);

}  // namespace jean
