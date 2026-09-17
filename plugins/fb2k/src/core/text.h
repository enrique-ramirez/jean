#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace jean {

std::string toLower(std::string value);

// The non-empty elements of a delimited header field, each trimmed of the optional whitespace
// RFC 9110 allows around it.
std::vector<std::string> splitOn(const std::string& text, char delimiter);

// An allowlist of "rating" that let "RATING" through would not be an allowlist.
bool equalsIgnoringCase(const std::string& a, const std::string& b);

// No C0 controls and no DEL. Everything a client sends is eventually written somewhere that
// treats those as structure rather than text: a newline forges a line in foo_jean.log, a NUL
// truncates a string inside the SDK, and a carriage return rewrites a playlist tab. UTF-8
// continuation bytes are all >= 0x80 and pass, so accented filenames are unaffected.
bool isPrintable(const std::string& text);

// No early exit: == leaks how much of a guess was right.
bool secureEquals(const std::string& a, const std::string& b);

// For text that arrives outside JSON's own number type, from a URL segment or a query
// parameter, where nothing upstream has already ruled out a sign, a fraction or an overflow.
bool readDecimal(const std::string& text, uint64_t& value);

}  // namespace jean
