// The half of tag writing that turns a POST body into an address and a set of fields, or into a
// refusal that says why. tag_route_test.cpp covers what a client sees over a socket.

#include "third_party/doctest.h"

#include "core/api.h"
#include "core/artwork.h"
#include "core/tag_write.h"
#include "support/fixtures.h"

#include <string>

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

// What a client would read off this request, which is the whole of what it learns about an
// address the route will not take.
int statusOf(const std::string& body, const Settings& settings = ratingOnly()) {
    return httpStatusFor(parse(body, settings).refusal);
}

// The library-relative, forward-slashed address GET /api/artwork?track= takes.
constexpr char kLibraryAddress[] = "Someone/A Record/01 A Song.flac";

std::string quoted(const std::string& text) {
    return "\"" + text + "\"";
}

std::string addressing(const std::string& track) {
    return R"({"track": ")" + track + R"(", "fields": {"rating": "4"}})";
}

std::string addressingRow(const std::string& playlist, const std::string& index,
                          const std::string& structure) {
    return R"({"playlist": )" + playlist + R"(, "index": )" + index + R"(, "structure": )" +
           structure + R"(, "fields": {"rating": "4"}})";
}

std::string addressingOrdinal(const std::string& ordinal, const std::string& structure) {
    return R"({"ordinal": )" + ordinal + R"(, "structure": )" + structure +
           R"(, "fields": {"rating": "4"}})";
}

std::string writing(const std::string& fields) {
    return R"({"track": ")" + std::string(kLibraryAddress) + R"(", "fields": )" + fields + "}";
}

}  // namespace

TEST_CASE("the library form is read as written") {
    const auto request = parse(R"({"track": ")" + std::string(kLibraryAddress) +
                               R"(", "subsong": 2, "fields": {"rating": "4"}})");

    REQUIRE(request.ok());
    REQUIRE(request.write.track.library.has_value());
    CHECK(request.write.track.library->track == kLibraryAddress);
    CHECK(request.write.track.library->subsong == 2);
    CHECK_FALSE(request.write.track.playlist.has_value());
    CHECK(request.write.fields.at("rating") == "4");
}

TEST_CASE("the library form's subsong is the first subsong of the file when it is left out") {
    const auto request = parse(writing(R"({"rating": "4"})"));

    REQUIRE(request.ok());
    REQUIRE(request.write.track.library.has_value());
    CHECK(request.write.track.library->subsong == 0);
}

TEST_CASE("the playlist form is read as written, generation and all") {
    const auto request = parse(addressingRow(quoted(kPlaylistId), "4", quoted("7")));

    REQUIRE(request.ok());
    REQUIRE(request.write.track.playlist.has_value());
    CHECK(request.write.track.playlist->playlistId == kPlaylistId);
    CHECK(request.write.track.playlist->index == 4);
    CHECK(request.write.track.playlist->structure == 7);
    CHECK_FALSE(request.write.track.library.has_value());
}

// The generation is the whole of what tells a write the snapshot has not been rebuilt under the
// client since it read the position, so a form that parsed the ordinal and dropped the number
// beside it would resolve every stale address it was handed.
TEST_CASE("the ordinal form is read as written, generation and all") {
    const auto request = parse(addressingOrdinal("5", "12"));

    REQUIRE(request.ok());
    REQUIRE(request.write.track.ordinal.has_value());
    CHECK(request.write.track.ordinal->ordinal == 5);
    CHECK(request.write.track.ordinal->structure == 12);
    CHECK_FALSE(request.write.track.library.has_value());
    CHECK_FALSE(request.write.track.playlist.has_value());
}

TEST_CASE("a request naming no address at all is refused about its address") {
    const std::string bodies[] = {
        R"({"fields": {"rating": "4"}})",
        R"({"subsong": 2, "fields": {"rating": "4"}})",

        // Half a playlist address is not an address: a position with no generation to hold it
        // against is the write this route exists to refuse.
        R"({"playlist": ")" + std::string(kPlaylistId) + R"(", "fields": {"rating": "4"}})",
        R"({"playlist": ")" + std::string(kPlaylistId) +
            R"(", "index": 4, "fields": {"rating": "4"}})",
        R"({"index": 4, "structure": "7", "fields": {"rating": "4"}})",
    };

    for (const auto& body : bodies) {
        INFO("body: ", body);
        CHECK(parse(body).refusal == TagWriteRefusal::badAddress);
        CHECK(statusOf(body) == 400);
    }
}

// A stray key says nothing about the address, and every other body in this component refuses
// one through declaresOnly. A filesystem path is the case worth holding: it looks like an
// address, and it lands here because `path` is a key nothing declares.
TEST_CASE("a field the body does not declare is refused as a malformed body, not as an address") {
    const std::string bodies[] = {
        R"({"track": ")" + std::string(kLibraryAddress) +
            R"(", "fields": {"rating": "4"}, "bogus": 1})",
        R"({"path": "F:\\Music\\a.mp3", "fields": {"rating": "4"}})",
        R"({"playlist": ")" + std::string(kPlaylistId) +
            R"(", "index": 4, "structure": "7", "title": "x", "fields": {"rating": "4"}})",
    };

    for (const auto& body : bodies) {
        INFO("body: ", body);
        CHECK(parse(body).refusal == TagWriteRefusal::malformedBody);
        CHECK(statusOf(body) == 400);
    }
}

TEST_CASE("a request naming both addresses is a 400, because nothing says which one wins") {
    const auto body = R"({"track": ")" + std::string(kLibraryAddress) + R"(", "playlist": )" +
                      quoted(kPlaylistId) +
                      R"(, "index": 4, "structure": "7", "fields": {"rating": "4"}})";

    CHECK(statusOf(body) == 400);
}

// An ordinal is a position in the media library snapshot, so the generation that says it still
// names the track the client read it from is the library's own. That one is a number on the
// wire where a playlist's is a string, which is the one difference between the two forms that
// both carry a `structure`.
TEST_CASE("an ordinal and the generation it was read at is a third address, never a second") {
    CHECK(parse(addressingOrdinal("5", "12")).ok());

    CHECK(statusOf(addressingOrdinal("5", quoted("12"))) == 400);
    CHECK(statusOf(addressingOrdinal(quoted("5"), "12")) == 400);
    CHECK(statusOf(addressingOrdinal("-1", "12")) == 400);
    CHECK(statusOf(addressingOrdinal("4.5", "12")) == 400);
    CHECK(statusOf(R"({"ordinal": 5, "fields": {"rating": "4"}})") == 400);

    CHECK(statusOf(R"({"track": ")" + std::string(kLibraryAddress) +
                   R"(", "ordinal": 5, "structure": 12, "fields": {"rating": "4"}})") == 400);
    CHECK(statusOf(R"({"ordinal": 5, "playlist": ")" + std::string(kPlaylistId) +
                   R"(", "index": 4, "structure": "7", "fields": {"rating": "4"}})") == 400);
}

TEST_CASE("an address of the wrong type is a 400 rather than a guess") {
    CHECK(statusOf(R"({"track": 42, "fields": {"rating": "4"}})") == 400);
    CHECK(statusOf(R"({"track": ["a.flac"], "fields": {"rating": "4"}})") == 400);
    CHECK(statusOf(R"({"track": "a.flac", "subsong": -1, "fields": {"rating": "4"}})") == 400);
    CHECK(statusOf(R"({"track": "a.flac", "subsong": "2", "fields": {"rating": "4"}})") == 400);

    CHECK(statusOf(addressingRow(quoted("not-a-guid"), "4", quoted("7"))) == 400);
    CHECK(statusOf(addressingRow("42", "4", quoted("7"))) == 400);
    CHECK(statusOf(addressingRow(quoted(kPlaylistId), quoted("4"), quoted("7"))) == 400);
    CHECK(statusOf(addressingRow(quoted(kPlaylistId), "-1", quoted("7"))) == 400);
    CHECK(statusOf(addressingRow(quoted(kPlaylistId), "4", "7")) == 400);
    CHECK(statusOf(addressingRow(quoted(kPlaylistId), "4", quoted("seven"))) == 400);
}

// A library's root never appears in an address, so a share and a local drive send the same
// string. Each spelling below is one the component used to refuse before it looked, which is
// what kept a library on a network share from ever being rated.
TEST_CASE("no address is refused for its shape, so a library on a network share can be rated") {
    CHECK(statusOf(addressing(kLibraryAddress)) == 200);
    CHECK(statusOf(addressing("a.mp3")) == 200);
    CHECK(statusOf(addressing("../../etc/passwd")) == 200);
    CHECK(statusOf(addressing(R"(Album\\a.mp3)")) == 200);
    CHECK(statusOf(addressing(R"(\\\\nas\\share\\a.mp3)")) == 200);
    CHECK(statusOf(addressing("//nas/share/a.mp3")) == 200);
    CHECK(statusOf(addressing("unpack://zip|0|a.zip|b.mp3")) == 200);
    CHECK(statusOf(addressing(R"(F:\\Music\\a.mp3)")) == 200);
}

// The address is echoed into a line-oriented log when the player turns out not to hold it, so
// length and printability are what is left of the check the two address routes share.
TEST_CASE("an address that is empty, over-long or unprintable is still a 400") {
    CHECK(statusOf(addressing("")) == 400);
    CHECK(statusOf(addressing(std::string(kMaxTrackAddressLength + 1, 'a'))) == 400);
    CHECK(statusOf(addressing(R"(Album/a\nb.flac)")) == 400);
    CHECK(statusOf(addressing(R"(Album/a\u0000b.flac)")) == 400);
}

TEST_CASE("a whole number is as good as a string") {
    const auto request = parse(writing(R"({"rating": 4})"));

    REQUIRE(request.ok());
    CHECK(request.write.fields.at("rating") == "4");
}

TEST_CASE("an empty value is kept, because clearing a tag is a real instruction") {
    const auto request = parse(writing(R"({"rating": ""})"));

    REQUIRE(request.ok());
    CHECK(request.write.fields.at("rating") == "");
}

TEST_CASE("a field outside the allowlist is refused and named") {
    const auto request = parse(writing(R"({"artist": "Someone Else"})"));

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::fieldNotAllowed);
    CHECK(request.detail == "artist");
}

TEST_CASE("the allowlist matches a field name however it is capitalised") {
    for (const char* spelling : {"rating", "RATING", "Rating", "rAtInG"}) {
        const auto request = parse(writing(std::string(R"({")") + spelling + R"(": "4"})"));

        INFO("spelling: ", spelling);
        CHECK(request.ok());
    }
}

TEST_CASE("one forbidden field poisons the whole request") {
    const auto request = parse(writing(R"({"rating": "4", "artist": "Someone"})"));

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::fieldNotAllowed);
}

TEST_CASE("an empty allowlist permits nothing at all") {
    Settings nothing;
    nothing.allowedFields.clear();

    const auto request = parse(writing(R"({"rating": "4"})"), nothing);

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::fieldNotAllowed);
}

TEST_CASE("a wider allowlist permits what it says and no more") {
    Settings wider;
    wider.allowedFields = {"rating", "comment"};

    CHECK(parse(writing(R"({"comment": "hi"})"), wider).ok());
    CHECK_FALSE(parse(writing(R"({"genre": "Jazz"})"), wider).ok());
}

// foobar2000 tag names are case-insensitive, so this is two instructions for one tag.
TEST_CASE("a field named twice differing only in case is refused rather than guessed") {
    const auto request = parse(writing(R"({"rating": "4", "RATING": "5"})"));

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
        parse(writing(R"({"album": "X", "RATING": "5", "rating": "4"})"), wider);

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::malformedBody);
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

TEST_CASE("a request with nothing to write is refused rather than performed") {
    CHECK(parse(R"({"track": ")" + std::string(kLibraryAddress) + R"("})").refusal ==
          TagWriteRefusal::noFields);
    CHECK(parse(writing("{}")).refusal == TagWriteRefusal::noFields);
    CHECK(parse(writing(R"("rating")")).refusal == TagWriteRefusal::noFields);
}

TEST_CASE("a value that is not text or a whole number is refused and named") {
    const auto request = parse(writing(R"({"rating": {"n": 1}})"));

    CHECK_FALSE(request.ok());
    CHECK(request.refusal == TagWriteRefusal::malformedBody);
    CHECK(request.detail.find("rating") != std::string::npos);
}

TEST_CASE("booleans and nulls are not values, however tempting") {
    CHECK_FALSE(parse(writing(R"({"rating": true})")).ok());
    CHECK_FALSE(parse(writing(R"({"rating": null})")).ok());
    CHECK_FALSE(parse(writing(R"({"rating": 4.5})")).ok());
}

// Driven by bodies rather than by the enumeration, so a refusal added later is covered by the
// case that provokes it instead of by somebody remembering to extend a list.
TEST_CASE("every refusal has something to say for itself") {
    const std::string bodies[] = {
        "not json at all {{{",
        R"({"fields": {"rating": "4"}})",
        addressing(""),
        addressingRow(quoted("not-a-guid"), "4", quoted("7")),
        writing("{}"),
        writing(R"({"artist": "Someone Else"})"),
    };

    for (const auto& body : bodies) {
        const auto request = parse(body);

        INFO("body: ", body);
        REQUIRE_FALSE(request.ok());
        CHECK_FALSE(describe(request.refusal).empty());
        CHECK(describe(request.refusal) != "unknown");
    }
}
