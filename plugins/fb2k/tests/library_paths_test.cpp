#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_paths.h"
#include "support/fixtures.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

constexpr char kTitle[] = "%title%";

std::vector<std::string> track(const std::string& directory, const std::string& filename,
                               const std::string& title, uint32_t subsong = 0) {
    return {directory, filename, std::to_string(subsong), title};
}

// Ordinal order as foobar2000 sorts it: two library roots holding one relative path sit next to
// each other, and a cue sheet's subsongs follow the lowest ordinal of their file.
Snapshot spine() {
    return snapshotOf({kTitle}, {
                                    track("Band/Record/", "01.flac", "One"),
                                    track("Band/Record/", "02.flac", "Two, first root"),
                                    track("Band/Record/", "02.flac", "Two, second root"),
                                    track("Band/Record/", "set.cue.flac", "Opening", 1),
                                    track("Band/Record/", "set.cue.flac", "Middle", 2),
                                    track("Band/Record/", "set.cue.flac", "Closing", 3),
                                    track("Other Band/", "03.flac", "Three"),
                                });
}

Snapshot retitled() {
    return snapshotOf({kTitle}, {
                                    track("Band/Record/", "01.flac", "One, retitled"),
                                    track("Band/Record/", "02.flac", "Two, first root"),
                                    track("Band/Record/", "02.flac", "Two, second root"),
                                    track("Band/Record/", "set.cue.flac", "Opening", 1),
                                    track("Band/Record/", "set.cue.flac", "Middle", 2),
                                    track("Band/Record/", "set.cue.flac", "Closing", 3),
                                    track("Other Band/", "03.flac", "Three"),
                                });
}

Snapshot behindTwo() {
    return snapshotOf({kTitle}, {
                                    track("Abba/", "1.flac", "Added"),
                                    track("Abba/", "2.flac", "Added too"),
                                    track("Band/Record/", "01.flac", "One"),
                                    track("Band/Record/", "02.flac", "Two, first root"),
                                    track("Band/Record/", "02.flac", "Two, second root"),
                                    track("Band/Record/", "set.cue.flac", "Opening", 1),
                                    track("Band/Record/", "set.cue.flac", "Middle", 2),
                                    track("Band/Record/", "set.cue.flac", "Closing", 3),
                                    track("Other Band/", "03.flac", "Three"),
                                });
}

}  // namespace

TEST_CASE("each path the snapshot holds answers its ordinal, joined as directory then filename") {
    const LibraryPaths paths(spine());

    CHECK(paths.firstOrdinalOf("Band/Record/01.flac") == 0U);
    CHECK(paths.firstOrdinalOf("Other Band/03.flac") == 6U);
}

TEST_CASE("a path two tracks share answers the lower of their ordinals") {
    const LibraryPaths paths(spine());

    CHECK(paths.firstOrdinalOf("Band/Record/02.flac") == 1U);
    CHECK(paths.firstOrdinalOf("Band/Record/set.cue.flac") == 3U);
}

// A track address is looked up exactly as sent: CONTRIBUTING.md, *Security rules*.
TEST_CASE("a path the snapshot does not hold answers nothing, however near one it holds") {
    const LibraryPaths paths(spine());

    for (const char* missing :
         {"Band/Record/never-added.flac", "band/record/01.flac", "Band/Record/01.flac/",
          "Band/Record/", "01.flac", "Band/Record01.flac", ""}) {
        INFO("path: '", missing, "'");
        CHECK_FALSE(paths.firstOrdinalOf(missing).has_value());
        CHECK_FALSE(paths.ordinalOf(missing, 0).has_value());
    }
}

TEST_CASE("a path and a subsong answer the ordinal of that track inside the file") {
    const LibraryPaths paths(spine());

    CHECK(paths.ordinalOf("Band/Record/set.cue.flac", 1) == 3U);
    CHECK(paths.ordinalOf("Band/Record/set.cue.flac", 2) == 4U);
    CHECK(paths.ordinalOf("Band/Record/set.cue.flac", 3) == 5U);
    CHECK(paths.ordinalOf("Other Band/03.flac", 0) == 6U);

    // foobar2000 numbers a cue sheet's subsongs from 1, so the file holds no subsong 0.
    CHECK_FALSE(paths.ordinalOf("Band/Record/set.cue.flac", 0).has_value());
    CHECK_FALSE(paths.ordinalOf("Band/Record/set.cue.flac", 4).has_value());
    CHECK_FALSE(paths.ordinalOf("Other Band/03.flac", 1).has_value());
}

// `heldTwice` is what turns a path the library holds into a 409 rather than a 404.
TEST_CASE("resolving a path tells a missing track from one two roots hold") {
    const LibraryPaths paths(spine());

    struct Resolved {
        const char* what;
        const char* path;
        uint32_t subsong;
        std::optional<uint32_t> ordinal;
        bool heldTwice;
    };
    const std::vector<Resolved> resolved{
        {"one track at the subsong, inside a file of three", "Band/Record/set.cue.flac", 2, 4U,
         false},
        {"one track at the subsong, alone in its file", "Other Band/03.flac", 0, 6U, false},
        {"two roots holding the path at the subsong", "Band/Record/02.flac", 0, std::nullopt, true},
        {"a path nobody holds", "Band/Record/never-added.flac", 0, std::nullopt, false},
        {"a path one root holds, at a subsong it does not", "Band/Record/set.cue.flac", 4,
         std::nullopt, false},
        // Two roots hold the path, but neither at this subsong: there is nothing to tell apart.
        {"a path two roots hold, at a subsong neither does", "Band/Record/02.flac", 1, std::nullopt,
         false},
    };

    for (const auto& asked : resolved) {
        INFO(std::string(asked.what));
        const auto resolution = paths.resolve(asked.path, asked.subsong);
        CHECK(resolution.ordinal == asked.ordinal);
        CHECK(resolution.heldTwice == asked.heldTwice);
    }
}

TEST_CASE("an empty snapshot answers nothing for any path") {
    const LibraryPaths paths(Snapshot{});

    CHECK_FALSE(paths.firstOrdinalOf("Band/Record/01.flac").has_value());
    CHECK_FALSE(paths.ordinalOf("Band/Record/01.flac", 0).has_value());
}

TEST_CASE("a library never built answers a map that holds no path") {
    const Library library;

    const auto paths = library.paths();
    REQUIRE(paths != nullptr);
    CHECK(paths->structure() == library.state().structure);
    CHECK_FALSE(paths->firstOrdinalOf("Band/Record/01.flac").has_value());
}

TEST_CASE("the library's map answers at the structure the library reports") {
    Library library;
    library.replace(spine());

    const auto paths = library.paths();
    REQUIRE(paths != nullptr);
    CHECK(paths->structure() == library.state().structure);
    CHECK(paths->firstOrdinalOf("Other Band/03.flac") == 6U);
}

TEST_CASE("tracks added ahead of a path move its ordinal in the map the library answers next") {
    Library library;
    library.replace(spine());
    const auto before = library.paths();
    const auto structureBefore = library.state().structure;

    library.replace(behindTwo());
    REQUIRE(library.state().structure != structureBefore);

    const auto after = library.paths();
    REQUIRE(after != nullptr);
    CHECK(after->structure() == library.state().structure);
    CHECK(after->firstOrdinalOf("Band/Record/01.flac") == 2U);
    CHECK(after->firstOrdinalOf("Band/Record/02.flac") == 3U);
    CHECK(after->ordinalOf("Band/Record/set.cue.flac", 2) == 6U);
    CHECK(after->firstOrdinalOf("Abba/1.flac") == 0U);

    CHECK(before->structure() == structureBefore);
    CHECK(before->firstOrdinalOf("Band/Record/01.flac") == 0U);
    CHECK_FALSE(before->firstOrdinalOf("Abba/1.flac").has_value());
}

// `revision` moves about once per track played, and building the map walks every path in the
// library, so a map rebuilt on a revision is a walk of the whole library per play.
TEST_CASE("a value changing in place keeps the map the library answered, a rebuild included") {
    Library library;
    library.replace(spine());
    const auto built = library.paths();
    const auto structure = library.state().structure;
    const auto revision = library.state().revision;

    SUBCASE("a row change") {
        library.apply({{0, track("Band/Record/", "01.flac", "One, played")}});
    }

    SUBCASE("a rebuild that moved no track") {
        library.replace(retitled());
    }

    REQUIRE(library.state().structure == structure);
    REQUIRE(library.state().revision != revision);
    CHECK(library.paths().get() == built.get());
}

// Read on a connection thread while the snapshot worker replaces the library, which is the one
// thread that does. ThreadSanitizer is what judges this case.
TEST_CASE("the map is read on many threads while the library is replaced under them") {
    Library library;
    library.replace(spine());

    constexpr int kReaders = 4;
    constexpr int kReplacements = 50;
    std::atomic<bool> done{false};
    std::atomic<int> misses{0};

    std::vector<std::thread> readers;
    readers.reserve(kReaders);
    for (int reader = 0; reader < kReaders; ++reader) {
        readers.emplace_back([&library, &done, &misses] {
            while (!done.load()) {
                const auto paths = library.paths();
                const auto found = paths->firstOrdinalOf("Band/Record/01.flac");
                if (!found || (*found != 0 && *found != 2))
                    misses.fetch_add(1);
            }
        });
    }

    for (int replacement = 0; replacement < kReplacements; ++replacement)
        library.replace(replacement % 2 == 0 ? behindTwo() : spine());
    done.store(true);
    for (auto& reader : readers)
        reader.join();

    CHECK(misses.load() == 0);
}
