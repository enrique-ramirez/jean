#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace jean {

enum class Need { required, optional };

std::string toLower(std::string value);

// The key a browser gives a tag: trimmed, lower-cased as String.prototype.toLowerCase does, and
// with each run of ECMAScript whitespace replaced by one space.
std::string tagKey(std::string_view tag);

// The bytes of the ECMAScript whitespace (what \s matches) that starts at `at`, or 0 where none
// does, so a scan over UTF-8 needs no decoded copy.
size_t ecmaWhitespaceWidthAt(std::string_view text, size_t at);

size_t endOfEcmaWhitespace(std::string_view text, size_t at);

std::string_view ecmaTrimmed(std::string_view text);

// Text as a browser folds it for a search: lower-cased whole, so a sigma sees its neighbours,
// decomposed, its marks put in canonical order, each character spelled as CLDR's Latin-ASCII
// transform spells it, and every Diacritic dropped. Never trimmed.
std::string fold(std::string_view text);

std::string squash(std::string_view text);

bool searchesMarks(std::string_view query);

std::string glyphs(std::string_view text);

std::string nameKey(std::string_view text);

std::vector<std::string> foldedWords(std::string_view text);

std::vector<std::string> squashedWords(std::string_view text);

std::vector<std::string> nameWords(std::string_view text);

// A browser reads one UTF-16 code unit there, so the second half of a surrogate pair is neither.
bool endsInLetterOrNumber(std::string_view folded, size_t at);

// JavaScript's `<` on two strings, which compares UTF-16 code units: UTF-8's byte order differs for
// a character beyond the Basic Multilingual Plane beside one from U+E000 up. A byte that starts no
// sequence counts as U+FFFD.
bool utf16Before(std::string_view a, std::string_view b);

size_t utf16Length(std::string_view text);

std::string toHex(std::span<const unsigned char> bytes);

// FNV-1a over 64-bit values, a byte at a time, for a digest that moves when any value does.
class ValueDigest {
public:
    ValueDigest();

    void mix(uint64_t value);
    uint64_t digest() const { return digest_; }

private:
    uint64_t digest_;
};

// The non-empty elements of a delimited header field, each trimmed of the optional whitespace
// RFC 9110 allows around it.
std::vector<std::string> splitOn(const std::string& text, char delimiter);

// An allowlist of "rating" that let "RATING" through would not be an allowlist.
bool equalsIgnoringCase(const std::string& a, const std::string& b);

std::string forwardSlashed(std::string path, char separator);

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

// Every position and index a client names is carried in 32 bits.
bool fitsUint32(uint64_t value);

std::optional<uint32_t> readUint32(const std::string& text);

// A strong, quoted ETag for `bytes`, by FNV-1a rather than a cryptographic hash: nothing here
// needs to resist a forged tag, only to notice that the bytes changed. Shared by whatever holds
// bytes with no version number of its own to publish instead, such as an artwork cover or the
// page's own build.
std::string eTagFor(std::string_view bytes);

}  // namespace jean
