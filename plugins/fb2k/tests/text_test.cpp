#include "third_party/doctest.h"

#include "core/text.h"
#include "support/summary_cases.h"

#include <array>
#include <initializer_list>
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

// Each entry is what ui/src/shared/lib/text.ts answered for its text in a JavaScript engine, so the
// component folds a tag to the same string a browser folds it to.
namespace {
const nlohmann::json& foldCases() {
    const nlohmann::json& entries =
        jean::testing::casesIn("library_questions_cases.json").at("fold");
    REQUIRE(!entries.empty());
    return entries;
}
}  // namespace

TEST_CASE("every text in the cases file folds to the string a browser folds it to") {
    for (const nlohmann::json& entry : foldCases()) {
        const std::string text = entry.at("text").get<std::string>();
        CAPTURE(text);
        CHECK(fold(text) == entry.at("fold").get<std::string>());
    }
}

TEST_CASE("every text in the cases file squashes to the string a browser squashes it to") {
    for (const nlohmann::json& entry : foldCases()) {
        const std::string text = entry.at("text").get<std::string>();
        CAPTURE(text);
        CHECK(squash(text) == entry.at("squash").get<std::string>());
    }
}

TEST_CASE("every text in the cases file splits into the folded words a browser splits it into") {
    for (const nlohmann::json& entry : foldCases()) {
        const std::string text = entry.at("text").get<std::string>();
        CAPTURE(text);
        CHECK(foldedWords(text) == entry.at("tokenize").get<std::vector<std::string>>());
    }
}

TEST_CASE("every text in the cases file is as long as a browser counts it, in UTF-16 code units") {
    for (const nlohmann::json& entry : foldCases()) {
        const std::string text = entry.at("text").get<std::string>();
        CAPTURE(text);
        CHECK(utf16Length(text) == entry.at("length").get<size_t>());
    }
}

namespace {
constexpr char kCapitalSigma[] = "\xce\xa3";
constexpr char kSmallSigma[] = "\xcf\x83";
constexpr char kFinalSigma[] = "\xcf\x82";
constexpr char kCapitalAlpha[] = "\xce\x91";
constexpr char kSmallAlpha[] = "\xce\xb1";
constexpr char kCombiningAcute[] = "\xcc\x81";
constexpr char kCapitalOdysseus[] =
    "\xce\x9f\xce\x94\xce\xa5\xce\xa3\xce\xa3\xce\x95\xce\xa5\xce\xa3";
constexpr char kSmallOdysseus[] =
    "\xce\xbf\xce\xb4\xcf\x85\xcf\x83\xcf\x83\xce\xb5\xcf\x85\xcf\x82";
constexpr char kCapitalIWithDot[] = "\xc4\xb0";
constexpr char kDotlessI[] = "\xc4\xb1";
constexpr char kDotAboveRight[] = "\xcd\x98";
constexpr char kSmallLetterA[] = "\xcd\xa3";
constexpr char kHan[] = "\xed\x95\x9c";
constexpr char kHanJamo[] = "\xe1\x84\x92\xe1\x85\xa1\xe1\x86\xab";
constexpr char kFullWidthUpper[] =
    "\xef\xbc\xa1\xef\xbc\xa2\xef\xbc\xa3\xef\xbc\x91\xef\xbc\x92\xef\xbc\x93";
constexpr char kFullWidthLower[] =
    "\xef\xbd\x81\xef\xbd\x82\xef\xbd\x83\xef\xbc\x91\xef\xbc\x92\xef\xbc\x93";
constexpr char kZeroWidthSpace[] = "\xe2\x80\x8b";
constexpr char kNextLine[] = "\xc2\x85";
constexpr char kGrinningFace[] = "\xf0\x9f\x98\x80";

std::string spelled(std::initializer_list<std::string_view> parts) {
    std::string text;
    for (const std::string_view part : parts)
        text += part;
    return text;
}
}  // namespace

TEST_CASE(
    "a capital sigma folds to a final sigma at the end of a word, before a space and before a "
    "mark, and to a small sigma alone or inside a word") {
    CHECK(fold(kCapitalSigma) == kSmallSigma);
    CHECK(fold(spelled({kCapitalAlpha, kCapitalSigma})) == spelled({kSmallAlpha, kFinalSigma}));
    CHECK(fold(spelled({kCapitalAlpha, kCapitalSigma, " ", kCapitalAlpha, kCapitalSigma})) ==
          spelled({kSmallAlpha, kFinalSigma, " ", kSmallAlpha, kFinalSigma}));
    CHECK(fold(spelled({kCapitalAlpha, kCapitalSigma, kCombiningAcute})) ==
          spelled({kSmallAlpha, kFinalSigma}));
    CHECK(fold(spelled({kCapitalAlpha, kCapitalSigma, kCapitalAlpha})) ==
          spelled({kSmallAlpha, kSmallSigma, kSmallAlpha}));
}

TEST_CASE("a sigma ending one word of several folds to a final sigma in the folded words") {
    CHECK(foldedWords(spelled({kCapitalOdysseus, " ", kCapitalAlpha, kCapitalSigma})) ==
          std::vector<std::string>{kSmallOdysseus, spelled({kSmallAlpha, kFinalSigma})});
}

TEST_CASE("a Turkish capital I with a dot folds to a plain i, and a dotless i stays dotless") {
    CHECK(fold(kCapitalIWithDot) == "i");
    CHECK(fold(spelled({kCapitalIWithDot, "stanbul"})) == "istanbul");
    CHECK(fold(kDotlessI) == kDotlessI);
}

TEST_CASE("two marks the fold keeps fold to one string whichever order they were typed in") {
    const std::string canonical = spelled({"a", kSmallLetterA, kDotAboveRight});
    CHECK(fold(spelled({"a", kDotAboveRight, kSmallLetterA})) == canonical);
    CHECK(fold(spelled({"a", kSmallLetterA, kDotAboveRight})) == canonical);
    CHECK(fold(spelled({"A", kDotAboveRight, kSmallLetterA, "B"})) == canonical + "b");
}

TEST_CASE("a starter the fold drops still keeps the marks on either side of it in their order") {
    CHECK(fold(spelled({"a", kDotAboveRight, "^", kSmallLetterA})) ==
          spelled({"a", kDotAboveRight, kSmallLetterA}));
}

TEST_CASE("a Hangul syllable folds to its jamo, the same string its jamo fold to") {
    CHECK(fold(kHan) == kHanJamo);
    CHECK(fold(kHanJamo) == kHanJamo);
    CHECK(squash(kHan) == kHanJamo);
    CHECK(utf16Length(kHan) == 1);
}

TEST_CASE("full-width letters fold to full-width small letters and are not narrowed") {
    CHECK(fold(kFullWidthUpper) == kFullWidthLower);
    CHECK(squash(kFullWidthUpper) == kFullWidthLower);
}

TEST_CASE(
    "a no-break space separates folded words, and a zero-width space and a next-line control do "
    "not") {
    CHECK(foldedWords(spelled({"A", kNoBreakSpace, "B"})) == std::vector<std::string>{"a", "b"});
    CHECK(foldedWords(spelled({kNoBreakSpace, "a", kIdeographicSpace})) ==
          std::vector<std::string>{"a"});
    CHECK(foldedWords(spelled({"a", kZeroWidthSpace, "b"})) ==
          std::vector<std::string>{spelled({"a", kZeroWidthSpace, "b"})});
    CHECK(foldedWords(spelled({"a", kNextLine, "b"})) ==
          std::vector<std::string>{spelled({"a", kNextLine, "b"})});
    CHECK(fold(spelled({"A", kNoBreakSpace, "B"})) == spelled({"a", kNoBreakSpace, "b"}));
    CHECK(squash(spelled({"A", kNoBreakSpace, "B"})) == "ab");
}

TEST_CASE(
    "an emoji folds to itself, counts two UTF-16 code units, is a word of its own and squashes "
    "away") {
    CHECK(fold(kGrinningFace) == kGrinningFace);
    CHECK(utf16Length(kGrinningFace) == 2);
    CHECK(foldedWords(spelled({"Party ", kGrinningFace, " Time"})) ==
          std::vector<std::string>{"party", kGrinningFace, "time"});
    CHECK(squash(spelled({"Party ", kGrinningFace, " Time"})) == "partytime");
}

TEST_CASE("an empty text folds and squashes to nothing, holds no words and has no length") {
    CHECK(fold("").empty());
    CHECK(squash("").empty());
    CHECK(foldedWords("").empty());
    CHECK(foldedWords(" \t ").empty());
    CHECK(utf16Length("") == 0);
}

TEST_CASE("a text that is not UTF-8 still folds, squashes, splits and has a length") {
    for (const std::string_view tag :
         {"\xc3", "A\xe2\x82", "\x80\x80", "\xff\xfe", "\xf0\x9f\x8e", "\xf0\x9f", "a\xcc"}) {
        CAPTURE(tag);
        const std::vector<char> bytes(tag.begin(), tag.end());
        const std::string_view text(bytes.data(), bytes.size());
        CHECK_NOTHROW(static_cast<void>(fold(text)));
        CHECK_NOTHROW(static_cast<void>(squash(text)));
        CHECK_NOTHROW(static_cast<void>(foldedWords(text)));
        CHECK_NOTHROW(static_cast<void>(utf16Length(text)));
    }
}
