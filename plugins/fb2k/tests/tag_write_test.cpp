// The half of tag writing that decides whether somebody may rewrite a file, which runs before
// anything touches a disk. tag_route_test.cpp covers what a client sees over a socket.

#include "third_party/doctest.h"

#include "core/tag_write.h"
#include "support/fixtures.h"

using namespace jean;
using namespace jean::testing;

namespace {

Settings ratingOnly() {
    Settings settings;
    settings.allowedFields = {"rating"};
    return settings;
}

TagWriteRequest parse(const std::string& body, const Settings& settings = ratingOnly()) {
    return parseTagWrite(body, settings);
}

}  // namespace

TEST_CASE("a well-formed request is accepted and read as written") {
    const auto request = parse(kRatingWrite);

    REQUIRE(request.ok());
    CHECK(request.write.track.path == kRatingWritePath);
    CHECK(request.write.track.subsong == 0);
    CHECK(request.write.fields.at("rating") == "4");
}

TEST_CASE("a whole number is as good as a string") {
    const auto request = parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": 4}})");

    REQUIRE(request.ok());
    CHECK(request.write.fields.at("rating") == "4");
}

TEST_CASE("an empty value is kept, because clearing a tag is a real instruction") {
    const auto request = parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": ""}})");

    REQUIRE(request.ok());
    CHECK(request.write.fields.at("rating") == "");
}

TEST_CASE("subsong is read when given and defaults to zero") {
    const auto request =
        parse(R"({"path": "F:\\a\\b.mp3", "subsong": 3, "fields": {"rating": "4"}})");

    REQUIRE(request.ok());
    CHECK(request.write.track.subsong == 3);
}

TEST_CASE("a field outside the allowlist is refused and named") {
    const auto request = parse(R"({"path": "F:\\a\\b.mp3", "fields": {"artist": "Someone Else"}})");

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::fieldNotAllowed);
    CHECK(request.detail == "artist");
}

TEST_CASE("the allowlist matches a field name however it is capitalised") {
    for (const char* spelling : {"rating", "RATING", "Rating", "rAtInG"}) {
        const auto body =
            std::string(R"({"path": "F:\\a\\b.mp3", "fields": {")") + spelling + R"(": "4"}})";
        const auto request = parse(body);

        INFO("spelling: ", spelling);
        CHECK(request.ok());
    }
}

TEST_CASE("one forbidden field poisons the whole request") {
    const auto request =
        parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": "4", "artist": "Someone"}})");

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::fieldNotAllowed);
}

TEST_CASE("an empty allowlist permits nothing at all") {
    Settings nothing;
    nothing.allowedFields.clear();

    const auto request = parse(kRatingWrite, nothing);

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::fieldNotAllowed);
}

TEST_CASE("a wider allowlist permits what it says and no more") {
    Settings wider;
    wider.allowedFields = {"rating", "comment"};

    CHECK(parse(R"({"path": "F:\\a\\b.mp3", "fields": {"comment": "hi"}})", wider).ok());
    CHECK_FALSE(parse(R"({"path": "F:\\a\\b.mp3", "fields": {"genre": "Jazz"}})", wider).ok());
}

// foobar2000 tag names are case-insensitive, so this is two instructions for one tag.
TEST_CASE("a field named twice differing only in case is refused rather than guessed") {
    const auto request =
        parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": "4", "RATING": "5"}})");

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::malformedBody);
    CHECK(request.detail.find("rating") != std::string::npos);
}

// The map is ordered by byte value, so the two spellings are not neighbours and an
// adjacent-pair check would miss this.
TEST_CASE("a case collision is caught even when other fields sort between them") {
    Settings wider;
    wider.allowedFields = {"rating", "album"};

    const auto request =
        parse(R"({"path": "F:\\a\\b.mp3", "fields": {"album": "X", "RATING": "5", "rating": "4"}})",
              wider);

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::malformedBody);
}

TEST_CASE("plain absolute local paths are acceptable") {
    CHECK(isSafeTrackPath(R"(F:\Music\a.mp3)"));
    CHECK(isSafeTrackPath("F:/Music/a.mp3"));
    CHECK(isSafeTrackPath("/Users/someone/Music/a.mp3"));
    CHECK(isSafeTrackPath(R"(F:\Music\Rock en Español\Una mañana.m4a)"));
}

TEST_CASE("a relative path is refused, because we have no directory to resolve it against") {
    CHECK_FALSE(isSafeTrackPath("a.mp3"));
    CHECK_FALSE(isSafeTrackPath(R"(Music\a.mp3)"));
    CHECK_FALSE(isSafeTrackPath("./a.mp3"));
}

TEST_CASE("a parent-directory escape is refused with either separator") {
    CHECK_FALSE(isSafeTrackPath(R"(F:\Music\..\..\Windows\System32\config\SAM)"));
    CHECK_FALSE(isSafeTrackPath("F:/Music/../secret.mp3"));
    CHECK_FALSE(isSafeTrackPath("/Users/someone/../../etc/passwd"));
}

// The guard is on the ".." segment rather than on the characters.
TEST_CASE("dots inside a filename are not an escape") {
    CHECK(isSafeTrackPath(R"(F:\Music\..of Montreal\a.mp3)"));
    CHECK(isSafeTrackPath(R"(F:\Music\a..b.mp3)"));
    CHECK(isSafeTrackPath(R"(F:\Music\...And Justice For All\a.mp3)"));
}

TEST_CASE("a URL scheme is refused rather than parsed") {
    CHECK_FALSE(isSafeTrackPath("http://evil.example/a.mp3"));
    CHECK_FALSE(isSafeTrackPath(R"(file://F:\Music\a.mp3)"));
    CHECK_FALSE(isSafeTrackPath("unpack://zip|0|F:/a.zip|b.mp3"));
}

TEST_CASE("a UNC path is refused, so no caller can send us at a network share") {
    CHECK_FALSE(isSafeTrackPath(R"(\\evil.example\share\a.mp3)"));

    // Windows reads either separator, so every spelling of the same share is one path.
    CHECK_FALSE(isSafeTrackPath("//evil.example/share/a.mp3"));
    CHECK_FALSE(isSafeTrackPath(R"(//evil.example\share\a.mp3)"));
    CHECK_FALSE(isSafeTrackPath(R"(\/evil.example/share/a.mp3)"));
    CHECK_FALSE(isSafeTrackPath(R"(/\evil.example/share/a.mp3)"));
}

TEST_CASE("an embedded NUL is refused rather than silently truncated") {
    // sizeof - 1 rather than a counted length, because the literal contains a NUL.
    constexpr char kSplitByNul[] = "F:\\a.mp3\0F:\\b.mp3";
    CHECK_FALSE(isSafeTrackPath(std::string(kSplitByNul, sizeof(kSplitByNul) - 1)));
}

// The path is echoed into a line-oriented log when the player does not know the track.
TEST_CASE("a path carrying a line break is refused, because the log is a line format") {
    CHECK_FALSE(isSafeTrackPath("F:\\a.mp3\n[info] nothing to see here"));
    CHECK_FALSE(isSafeTrackPath("F:\\a.mp3\r\n[info] nothing to see here"));
    CHECK_FALSE(isSafeTrackPath("F:\\a.mp3\tb.mp3"));

    // Not a blanket ban on high bytes: every UTF-8 continuation byte is above 0x7f.
    CHECK(isSafeTrackPath("F:\\Music\\Rock en Espa\u00f1ol\\Una ma\u00f1ana.m4a"));
}

TEST_CASE("an absurdly long path is refused") {
    CHECK_FALSE(isSafeTrackPath("F:\\" + std::string(5000, 'a') + ".mp3"));
}

TEST_CASE("an unacceptable path is refused by the parser, not just by the predicate") {
    const auto request = parse(R"({"path": "..\\..\\etc\\passwd", "fields": {"rating": "4"}})");

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::unsafePath);
}

TEST_CASE("a body that is not JSON is refused rather than thrown") {
    const auto request = parse("not json at all {{{");

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::malformedBody);
}

TEST_CASE("a body that is not an object is refused") {
    CHECK(parse("[1, 2, 3]").refusal == TagWriteRefusal::malformedBody);
    CHECK(parse("\"just a string\"").refusal == TagWriteRefusal::malformedBody);
    CHECK(parse("null").refusal == TagWriteRefusal::malformedBody);
}

TEST_CASE("a missing or unusable path is named as such") {
    CHECK(parse(R"({"fields": {"rating": "4"}})").refusal == TagWriteRefusal::missingPath);
    CHECK(parse(R"({"path": "", "fields": {"rating": "4"}})").refusal ==
          TagWriteRefusal::missingPath);
    CHECK(parse(R"({"path": 42, "fields": {"rating": "4"}})").refusal ==
          TagWriteRefusal::missingPath);
}

TEST_CASE("a request with nothing to write is refused rather than performed") {
    CHECK(parse(R"({"path": "F:\\a\\b.mp3"})").refusal == TagWriteRefusal::noFields);
    CHECK(parse(R"({"path": "F:\\a\\b.mp3", "fields": {}})").refusal == TagWriteRefusal::noFields);
    CHECK(parse(R"({"path": "F:\\a\\b.mp3", "fields": "rating"})").refusal ==
          TagWriteRefusal::noFields);
}

TEST_CASE("a value that is not text or a whole number is refused and named") {
    const auto request = parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": {"n": 1}}})");

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::malformedBody);
    CHECK(request.detail.find("rating") != std::string::npos);
}

TEST_CASE("booleans and nulls are not values, however tempting") {
    CHECK_FALSE(parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": true}})").ok());
    CHECK_FALSE(parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": null}})").ok());
    CHECK_FALSE(parse(R"({"path": "F:\\a\\b.mp3", "fields": {"rating": 4.5}})").ok());
}

TEST_CASE("a negative subsong is refused") {
    const auto request =
        parse(R"({"path": "F:\\a\\b.mp3", "subsong": -1, "fields": {"rating": "4"}})");

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::malformedBody);
}

TEST_CASE("every refusal has something to say for itself") {
    for (const auto refusal :
         {TagWriteRefusal::malformedBody, TagWriteRefusal::missingPath, TagWriteRefusal::unsafePath,
          TagWriteRefusal::noFields, TagWriteRefusal::fieldNotAllowed}) {
        CHECK_FALSE(describe(refusal).empty());
        CHECK(describe(refusal) != "unknown");
    }
}
