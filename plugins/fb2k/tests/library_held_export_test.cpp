#include "third_party/doctest.h"

#include "core/library.h"
#include "support/fixtures.h"
#include "support/test_server.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

using Held = std::weak_ptr<const std::string>;

constexpr char kTitle[] = "%title%";

const ExportPart kTitlesAlone{.only = {kTitle}, .spine = false};

Held heldBody(const Library& library, const ExportPart& part = {}) {
    const SharedBytes bytes = library.exported(part).bytes;
    REQUIRE(bytes);
    return bytes;
}

std::vector<std::string> playedRow(size_t ordinal) {
    return {"Artist/Album/", std::to_string(ordinal) + ".flac", "0",
            builtTrackTitle(ordinal) + " (played)"};
}

}  // namespace

TEST_CASE("a play releases every export body of the revision before it") {
    Library library;
    buildLibrary(library);
    const Held whole = heldBody(library);
    const Held part = heldBody(library, kTitlesAlone);

    const uint64_t revision = library.state().revision;
    REQUIRE(library.apply({{0, playedRow(0)}}) == revision + 1);

    CHECK(whole.expired());
    CHECK(part.expired());
}

TEST_CASE("a rebuild that moves the structure releases every export body of the one before") {
    Library library;
    buildLibrary(library);
    const Held whole = heldBody(library);
    const Held part = heldBody(library, kTitlesAlone);

    moveLibraryStructure(library);

    CHECK(whole.expired());
    CHECK(part.expired());
}

TEST_CASE("a row change that moves nothing keeps the current export body") {
    Library library;
    buildLibrary(library);
    const SharedBytes before = library.exported().bytes;
    REQUIRE(before);

    library.apply({{0, {"Artist/Album/", "0.flac", "0", builtTrackTitle(0)}}});

    CHECK(library.exported().bytes == before);
}

TEST_CASE("after a play, the export route holds no body of the revision before it") {
    Library library;
    buildLibrary(library);
    const TestServer server(servingSettings(), Player{}, &library);
    auto client = undecoding(server);

    const auto whole = client.Get("/api/library/export?columns=%25title%25", accepting("gzip"));
    const auto part = client.Get(
        "/api/library/export?columns=%25title%25&only=%25title%25&spine=false", accepting("gzip"));
    REQUIRE(whole);
    REQUIRE(part);
    REQUIRE(whole->status == 200);
    REQUIRE(part->status == 200);
    REQUIRE(isGzip(whole->body));
    REQUIRE(isGzip(part->body));

    REQUIRE(library.exported().bytes == library.exported().bytes);
    const Held wholeHeld = heldBody(library);
    const Held partHeld = heldBody(library, kTitlesAlone);

    library.apply({{0, playedRow(0)}});

    CHECK(wholeHeld.expired());
    CHECK(partHeld.expired());
}
