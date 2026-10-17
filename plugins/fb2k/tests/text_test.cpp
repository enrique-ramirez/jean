#include "third_party/doctest.h"

#include "core/text.h"
#include "support/summary_cases.h"

#include <array>
#include <span>
#include <string>
#include <string_view>
#include <vector>

using namespace jean;

TEST_CASE("32 bytes are written as their 64 lowercase hex digits, and no bytes as nothing") {
    constexpr std::array<unsigned char, 32> kBytes{
        0x00, 0x01, 0x0f, 0x10, 0x7f, 0x80, 0x9a, 0xa9, 0xbc, 0xcb, 0xde,
        0xed, 0xf0, 0xfe, 0xff, 0x5a, 0xa5, 0x09, 0x90, 0x0a, 0xa0, 0x3c,
        0xc3, 0x6b, 0xb6, 0x2d, 0xd2, 0x4e, 0xe4, 0x1f, 0xf1, 0x77,
    };

    CHECK(toHex(kBytes) ==
          "00010f107f809aa9bccbdeedf0feff5a"
          "a509900aa03cc36bb62dd24ee41ff177");
    CHECK(toHex(std::span<const unsigned char>()).empty());
}

// foobar2000 hands a path over in the operating system's own spelling, so `\` separates folders
// on Windows and is an ordinary character of a file name on macOS.
TEST_CASE(
    "a path's separators become forward slashes, and a backslash that separates nothing "
    "stays") {
    CHECK(forwardSlashed("a\\b\\c.mp3", '\\') == "a/b/c.mp3");
    CHECK(forwardSlashed("a\\b\\c.mp3", '/') == "a\\b\\c.mp3");
    CHECK(forwardSlashed("dir/a\\b.mp3", '/') == "dir/a\\b.mp3");
    CHECK(forwardSlashed("dir/a\\b.mp3", '\\') == "dir/a/b.mp3");

    CHECK(forwardSlashed("\\a\\b\\", '\\') == "/a/b/");
    CHECK(forwardSlashed("\\a\\b\\", '/') == "\\a\\b\\");

    CHECK(forwardSlashed("loose.mp3", '\\') == "loose.mp3");
    CHECK(forwardSlashed("loose.mp3", '/') == "loose.mp3");
    CHECK(forwardSlashed("", '\\').empty());
    CHECK(forwardSlashed("", '/').empty());
}

// Spelled as bytes: MSVC reads a source file without a byte order mark in the system code page, and
// a universal character name in a narrow literal is converted to that page.
namespace {
constexpr char kNoBreakSpace[] = "\xc2\xa0";
constexpr char kIdeographicSpace[] = "\xe3\x80\x80";
constexpr char kCombiningDotAbove[] = "\xcc\x87";
}  // namespace

// Each verdict is a JavaScript engine's, from String.prototype.toLowerCase and ECMAScript's \s, so
// a browser and foo_jean put the same tags in one album.
TEST_CASE("two tags share a key exactly when the cases file says they match") {
    const nlohmann::json& pairs = jean::testing::librarySummaryCases().at("keys");
    REQUIRE(!pairs.empty());

    for (const nlohmann::json& pair : pairs) {
        const std::string a = pair.at("a").get<std::string>();
        const std::string b = pair.at("b").get<std::string>();
        CAPTURE(a);
        CAPTURE(b);
        CAPTURE(tagKey(a));
        CAPTURE(tagKey(b));
        CHECK((tagKey(a) == tagKey(b)) == pair.at("match").get<bool>());
    }
}

TEST_CASE("a tag's key is trimmed, lower-cased and has one space for each run of whitespace") {
    CHECK(tagKey("  Été  ") == "été");
    CHECK(tagKey("A\t\tB") == "a b");
    CHECK(tagKey(std::string("a") + kNoBreakSpace + kIdeographicSpace + "b") == "a b");
    CHECK(tagKey(std::string(kNoBreakSpace) + "a" + kIdeographicSpace) == "a");
    CHECK(tagKey("").empty());
}

TEST_CASE("a tag lower-cases as ECMAScript's toLowerCase does, past the one-to-one letters") {
    CHECK(tagKey("ΟΔΥΣΣΕΥΣ") == "οδυσσευς");
    CHECK(tagKey("İ") == std::string("i") + kCombiningDotAbove);
    CHECK(tagKey("ẞ") == "ß");
    CHECK(tagKey("🎵") == "🎵");
}

// A tag is whatever bytes foobar2000 read from the file, and nothing guarantees they are UTF-8.
// Each tag sits in a heap block of exactly its own size, the only place AddressSanitizer marks the
// byte after the last one: a short std::string keeps its bytes inside the object.
TEST_CASE("a tag that is not UTF-8 still gets a key") {
    for (const std::string_view tag :
         {"\xc3", "A\xe2\x82", "\x80\x80", "\xff\xfe", "\xf0\x9f\x8e", "\xf0\x9f"}) {
        CAPTURE(tag);
        const std::vector<char> bytes(tag.begin(), tag.end());
        CHECK_NOTHROW(static_cast<void>(tagKey(std::string_view(bytes.data(), bytes.size()))));
    }
}
