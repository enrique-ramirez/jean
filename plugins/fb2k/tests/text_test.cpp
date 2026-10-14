#include "third_party/doctest.h"

#include "core/text.h"

#include <array>
#include <span>

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
