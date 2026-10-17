// The library snapshot, its wire format and the requests it will accept, all of it before
// foobar2000 is involved. The tests decode the wire format the way a browser would, because
// an offset that is right in the header and wrong in the blob reads as success everywhere else.

#include "third_party/doctest.h"

#include "core/failures.h"
#include "core/library.h"
#include "support/eventually.h"
#include "support/test_server.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <atomic>
#include <functional>
#include <iterator>
#include <map>
#include <random>
#include <string>
#include <thread>
#include <tuple>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

bool namesAnOffset(const std::string& pointer) {
    const std::string suffix = "/offset";
    return pointer.size() >= suffix.size() &&
           pointer.compare(pointer.size() - suffix.size(), suffix.size(), suffix) == 0;
}

// Every offset in the document, wherever it sits, is one a client hands a typed-array
// constructor, and it hands it the absolute position rather than the one in the header.
void checkAlignment(const std::string& message) {
    const Wire wire = decode(message);
    CHECK(wire.blobStart % 4 == 0);

    const json flat = wire.header.flatten();
    for (const auto& leaf : flat.items()) {
        if (namesAnOffset(leaf.key()))
            CHECK((wire.blobStart + leaf.value().get<size_t>()) % 4 == 0);
    }
}

using Row = std::vector<std::string>;

// A row's values in the order LibraryBuilder::fields() gives: the spine, then the columns.
Row track(const std::string& directory, const std::string& filename,
          const std::vector<std::string>& values) {
    Row row{directory, filename, "0"};
    row.insert(row.end(), values.begin(), values.end());
    return row;
}

}  // namespace

TEST_CASE("a width holds every id a dictionary of that size hands out") {
    CHECK(widthFor(0) == IdWidth::one);
    CHECK(widthFor(1) == IdWidth::one);
    CHECK(widthFor(256) == IdWidth::one);
    CHECK(widthFor(257) == IdWidth::two);
    CHECK(widthFor(65536) == IdWidth::two);
    CHECK(widthFor(65537) == IdWidth::four);
}

TEST_CASE("a column of one repeated value costs one dictionary entry") {
    const auto snapshot =
        snapshotOf({"%genre%"}, {track("a/", "1.mp3", {"Rock"}), track("a/", "2.mp3", {"Rock"}),
                                 track("a/", "3.mp3", {"Rock"})});

    const Wire wire = decode(serialiseSnapshot(snapshot));
    const json& genre = namedColumn(wire, "%genre%");

    CHECK(genre.at("distinct") == 1);
    CHECK(genre.at("dict").at("ends").at("count") == 1);
    CHECK(genre.at("ids").at("width") == 1);
    CHECK(column(wire, genre) == std::vector<std::string>{"Rock", "Rock", "Rock"});
}

TEST_CASE("a column of entirely distinct values still reads back row for row") {
    std::vector<Row> rows;
    std::vector<std::string> expected;
    for (int index = 0; index < 300; ++index) {
        expected.push_back("title " + std::to_string(index));
        rows.push_back(track("a/", std::to_string(index) + ".mp3", {expected.back()}));
    }

    const Wire wire = decode(serialiseSnapshot(snapshotOf({"%title%"}, rows)));
    const json& title = namedColumn(wire, "%title%");

    CHECK(title.at("distinct") == 300);
    CHECK(title.at("ids").at("width") == 2);
    CHECK(column(wire, title) == expected);
}

TEST_CASE("an empty library serialises to a well-formed message with no rows") {
    const std::string message = serialiseSnapshot(snapshotOf({"%title%"}, {}));
    checkAlignment(message);

    const Wire wire = decode(message);
    CHECK(wire.header.at("trackCount") == 0);
    CHECK(namedColumn(wire, "%title%").at("distinct") == 0);
    CHECK(ids(wire, namedColumn(wire, "%title%").at("ids")).empty());
}

TEST_CASE("a single track carries its spine and its columns") {
    const Wire wire = decode(serialiseSnapshot(
        snapshotOf({"%artist%"}, {track("Bandname/Album/", "01 Song.flac", {"Bandname"})})));

    CHECK(wire.header.at("trackCount") == 1);
    CHECK(column(wire, wire.header.at("spine").at("directory"))[0] == "Bandname/Album/");
    CHECK(column(wire, wire.header.at("spine").at("filename"))[0] == "01 Song.flac");
    CHECK(column(wire, wire.header.at("spine").at("subsong"))[0] == "0");
    CHECK(column(wire, namedColumn(wire, "%artist%"))[0] == "Bandname");
}

// Dictionary ends are byte offsets, so anything above U+007F reads back short or ragged if a
// character count is used anywhere on either side.
TEST_CASE("multi-byte UTF-8 survives the dictionary and the ids") {
    const std::vector<std::string> artists{"Sigur Rós", "細野晴臣", "Beyoncé", "🎧 mix",
                                           "Sigur Rós"};

    std::vector<Row> rows;
    rows.reserve(artists.size());
    for (size_t index = 0; index < artists.size(); ++index)
        rows.push_back(track("músicá/", std::to_string(index) + ".mp3", {artists[index]}));

    const std::string message = serialiseSnapshot(snapshotOf({"%artist%"}, rows));
    checkAlignment(message);

    const Wire wire = decode(message);
    const json& artist = namedColumn(wire, "%artist%");

    CHECK(artist.at("distinct") == 4);
    CHECK(column(wire, artist) == artists);
    CHECK(column(wire, wire.header.at("spine").at("directory"))[0] == "músicá/");
}

TEST_CASE("every offset a client indexes on is four-byte aligned, header padding included") {
    // The column name is what moves the header's length, and three of these four leave it at a
    // length that is not a multiple of four on its own.
    for (const char* const name : {"%a%", "%ab%", "%abc%", "%abcd%"}) {
        const std::string message = serialiseSnapshot(
            snapshotOf({name}, {track("a/", "1.mp3", {"x"}), track("a/", "2.mp3", {"yy"})}));

        checkAlignment(message);
        CHECK(decode(message).header.at("columns").at(0).at("name") == name);
    }
}

TEST_CASE("the facts a client would otherwise guess at by sampling rows") {
    const auto snapshot = snapshotOf(
        {"%play_count%", "%last_played%", "%title%"},
        {track("a/", "1.mp3", {"?", "?", "One"}), track("a/", "2.mp3", {"3", "?", "Two"}),
         track("a/", "3.mp3", {"?", "?", "Three"})});

    const Wire wire = decode(serialiseSnapshot(snapshot));

    const json& plays = namedColumn(wire, "%play_count%");
    CHECK(plays.at("hasUnresolved") == true);
    CHECK(plays.at("allUnresolved") == false);

    const json& played = namedColumn(wire, "%last_played%");
    CHECK(played.at("hasUnresolved") == true);
    CHECK(played.at("allUnresolved") == true);

    const json& title = namedColumn(wire, "%title%");
    CHECK(title.at("hasUnresolved") == false);
    CHECK(title.at("allUnresolved") == false);
}

TEST_CASE("an empty value and an unresolved one stay different values") {
    const Wire wire = decode(serialiseSnapshot(snapshotOf(
        {"%genre%"},
        {track("a/", "1.mp3", {"?"}), track("a/", "2.mp3", {""}), track("a/", "3.mp3", {"N/A"})})));

    CHECK(column(wire, namedColumn(wire, "%genre%")) == std::vector<std::string>{"?", "", "N/A"});
}

TEST_CASE("rows arriving from many threads at once land where they belong") {
    constexpr size_t kThreads = 8;
    constexpr size_t kRows = 4000;

    std::vector<Row> rows;
    rows.reserve(kRows);
    for (size_t index = 0; index < kRows; ++index) {
        rows.push_back(
            track("dir" + std::to_string(index % 37) + "/", std::to_string(index) + ".mp3",
                  {"artist " + std::to_string(index % 11), "title " + std::to_string(index)}));
    }

    LibraryBuilder builder({"%artist%", "%title%"}, kRows);
    REQUIRE(builder.fields().size() == kSpineFieldCount + 2);

    std::vector<std::thread> workers;
    for (size_t worker = 0; worker < kThreads; ++worker) {
        LibraryBuilder::Sink* const sink = &builder.sink();
        workers.emplace_back([sink, &rows, worker] {
            // Backwards, so no two workers agree on the order a value is first seen in.
            for (size_t index = rows.size(); index > 0; --index) {
                if ((index - 1) % kThreads == worker)
                    sink->row(index - 1, rows[index - 1]);
            }
        });
    }

    for (std::thread& worker : workers)
        worker.join();

    const Wire wire = decode(serialiseSnapshot(builder.finish()));
    CHECK(wire.header.at("trackCount") == kRows);

    const auto artists = column(wire, namedColumn(wire, "%artist%"));
    const auto titles = column(wire, namedColumn(wire, "%title%"));
    const auto filenames = column(wire, wire.header.at("spine").at("filename"));

    REQUIRE(artists.size() == kRows);
    for (size_t index = 0; index < kRows; ++index) {
        CHECK(artists[index] == "artist " + std::to_string(index % 11));
        CHECK(titles[index] == "title " + std::to_string(index));
        CHECK(filenames[index] == std::to_string(index) + ".mp3");
    }

    CHECK(namedColumn(wire, "%artist%").at("distinct") == 11);
}

// A sink that never reports a row is the only way a column's dictionary stays empty while its
// ids do not: id 0 must still resolve to something, or a client indexes past the end of it.
TEST_CASE("a row nobody's sink ever reported still resolves to a real dictionary entry") {
    LibraryBuilder builder({"%title%"}, 1);
    builder.sink();

    const Wire wire = decode(serialiseSnapshot(builder.finish()));
    const json& title = namedColumn(wire, "%title%");

    CHECK(title.at("distinct") == 1);
    CHECK(column(wire, title) == std::vector<std::string>{""});
}

TEST_CASE("a library that has not been built yet answers nothing") {
    Library library;

    CHECK_FALSE(library.state().ready);
    CHECK(library.changes(0, 0).outcome == DeltaOutcome::notBuilt);
    CHECK(library.apply({{0, {"a/", "1.mp3", "0"}}}) == 0);
}

TEST_CASE("installing a snapshot moves both generations and reports the columns asked for") {
    Library library;
    const auto unbuilt = library.state();
    library.replace(snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"})}));

    const auto state = library.state();
    CHECK(state.ready);
    CHECK(state.structure != unbuilt.structure);
    CHECK(state.revision != unbuilt.revision);
    CHECK(state.trackCount == 1);
    CHECK(state.columns == std::vector<std::string>{"%artist%"});
}

TEST_CASE("a library's first build lands on the seeded structure, not on 1") {
    Library library;
    CHECK(library.state().structure == 0);

    library.replace(snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"})}));
    const uint64_t first = library.state().structure;

    CHECK(first != 1);

    // A JSON number carries an integer exactly only up to 2^53.
    constexpr uint64_t kExactInAJsonNumber = uint64_t{1} << 53U;
    CHECK(first < kExactInAJsonNumber);
}

TEST_CASE("the structure announced ahead of a replace is the one the replace lands on") {
    Library library;
    const auto first = snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"})});
    const uint64_t announced = library.structureAfter(first);

    library.replace(first);
    CHECK(library.state().structure == announced);

    const auto same = snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"Someone Else"})});
    CHECK(library.structureAfter(same) == announced);

    const auto grown =
        snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"}), track("a/", "2.mp3", {"Two"})});
    CHECK(library.structureAfter(grown) != announced);
}

TEST_CASE("a rebuild finding the same tracks keeps the structure and patches only what moved") {
    Library library;
    library.replace(snapshotOf({"%play_count%", "%title%"}, {track("a/", "1.mp3", {"1", "One"}),
                                                             track("a/", "2.mp3", {"5", "Two"})}));
    const auto before = library.state();

    library.replace(snapshotOf({"%play_count%", "%title%"}, {track("a/", "1.mp3", {"2", "One"}),
                                                             track("a/", "2.mp3", {"5", "Two"})}));
    const auto after = library.state();

    CHECK(after.structure == before.structure);
    CHECK(after.revision == before.revision + 1);

    const auto changes = library.changes(before.structure, before.revision);
    REQUIRE(changes.outcome == DeltaOutcome::ok);
    const Wire delta = decode(serialiseDelta(changes.delta));
    CHECK(columnNames(delta.header) == std::vector<std::string>{"%play_count%"});
    CHECK(ids(delta, namedColumn(delta, "%play_count%").at("ordinals")) ==
          std::vector<uint32_t>{0});
}

TEST_CASE("a rebuild finding nothing changed moves neither generation") {
    Library library;
    library.replace(snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"})}));
    const auto before = library.state();

    library.replace(snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"})}));
    CHECK(library.state().structure == before.structure);
    CHECK(library.state().revision == before.revision);
}

TEST_CASE("a rebuild with another column set, or another track order, moves the structure") {
    Library library;
    library.replace(
        snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"}), track("a/", "2.mp3", {"Two"})}));
    const auto before = library.state();

    library.replace(
        snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"}), track("a/", "2.mp3", {"Two"})}));
    CHECK(library.state().structure == before.structure + 1);

    library.replace(
        snapshotOf({"%artist%"}, {track("a/", "2.mp3", {"Two"}), track("a/", "1.mp3", {"One"})}));
    CHECK(library.state().structure == before.structure + 2);
}

TEST_CASE("a library nobody is building carries no build progress") {
    const Library library;

    CHECK_FALSE(library.state().build.has_value());
}

TEST_CASE("the progress read back is the last one the build reported") {
    Library library;

    library.reportBuild({BuildPhase::ordering, 0, 7});
    library.reportBuild({BuildPhase::formatting, 3, 7});

    const auto build = library.state().build;
    REQUIRE(build.has_value());
    CHECK(build->phase == BuildPhase::formatting);
    CHECK(build->formatted == 3);
    CHECK(build->total == 7);
}

// A data rebuild runs beside the snapshot it will replace, so a client polling in between
// reads the old library as ready and the new one as on its way.
TEST_CASE("installing a snapshot ends its build, and the next build reports afresh") {
    Library library;

    library.reportBuild({BuildPhase::listing, 0, 0});
    library.replace(snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"})}));
    CHECK_FALSE(library.state().build.has_value());

    library.reportBuild({BuildPhase::formatting, 1, 2});
    const auto rebuilding = library.state();
    CHECK(rebuilding.ready);
    CHECK(rebuilding.trackCount == 1);
    REQUIRE(rebuilding.build.has_value());
    CHECK(rebuilding.build->formatted == 1);
    CHECK(rebuilding.build->total == 2);

    library.replace(
        snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"}), track("a/", "2.mp3", {"Two"})}));
    const auto rebuilt = library.state();
    CHECK_FALSE(rebuilt.build.has_value());
    CHECK(rebuilt.trackCount == 2);
}

// A rebuild that fails or is abandoned installs nothing, and the library it would have replaced
// is still the one a client reads.
TEST_CASE("a build that ends without a snapshot clears its progress and keeps the library held") {
    Library library;
    library.replace(snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"})}));
    library.apply({{0, track("a/", "1.mp3", {"Two"})}});
    const auto before = library.state();

    library.reportBuild({BuildPhase::formatting, 1, 2});
    library.endBuild();

    const auto after = library.state();
    CHECK_FALSE(after.build.has_value());
    CHECK(after.ready);
    CHECK(after.structure == before.structure);
    CHECK(after.revision == before.revision);
    CHECK(after.trackCount == 1);
    CHECK(after.columns == before.columns);
}

TEST_CASE("a library whose worker halted ends its build and keeps the snapshot it held") {
    Library library;
    library.replace(snapshotOf({"%artist%"}, {track("a/", "1.mp3", {"One"})}));
    const auto before = library.state();
    CHECK_FALSE(before.halted);

    library.reportBuild({BuildPhase::formatting, 1, 2});
    library.reportHalted();

    const auto after = library.state();
    CHECK(after.halted);
    CHECK_FALSE(after.build.has_value());
    CHECK(after.ready);
    CHECK(after.structure == before.structure);
    CHECK(after.trackCount == 1);
}

// The build's worker reports while request threads read, so the pair has to agree on the
// lock. A torn read shows up as progress that runs backwards or a total the build never had.
TEST_CASE("progress reported from one thread reads back whole from another") {
    static constexpr size_t kReports = 4000;

    Library library;
    std::atomic<bool> reported{false};
    std::thread worker([&library, &reported] {
        for (size_t formatted = 1; formatted <= kReports; ++formatted)
            library.reportBuild({BuildPhase::formatting, formatted, kReports});
        reported.store(true);
    });

    size_t torn = 0;
    size_t latest = 0;
    REQUIRE(eventually([&library] { return library.state().build.has_value(); }));
    while (!reported.load()) {
        const auto build = library.state().build;
        if (!build)
            continue;

        if (build->phase != BuildPhase::formatting || build->total != kReports ||
            build->formatted < latest)
            ++torn;
        latest = build->formatted;
    }
    worker.join();

    CHECK(torn == 0);
    const auto build = library.state().build;
    REQUIRE(build.has_value());
    CHECK(build->formatted == kReports);
}

// Every export of a revision hands out the same bytes, so a second client asking costs neither a
// serialisation nor the lock the state poll waits on.
TEST_CASE("two exports of one revision are one serialisation") {
    Library library;
    library.replace(snapshotOf({"%play_count%"}, {track("a/", "1.mp3", {"3"})}));

    const auto first = library.exported();
    const auto second = library.exported();

    REQUIRE(first.bytes);
    CHECK(first.bytes == second.bytes);
    CHECK(first.revision == library.state().revision);
    CHECK(first.structure == library.state().structure);
}

TEST_CASE("an export after a row moved carries the row, and one already handed out keeps its own") {
    Library library;
    library.replace(snapshotOf({"%play_count%"}, {track("a/", "1.mp3", {"3"})}));
    const auto before = library.exported();
    const uint64_t moved = before.revision + 1;

    REQUIRE(library.apply({{0, track("a/", "1.mp3", {"4"})}}) == moved);
    const auto after = library.exported();

    CHECK(after.bytes != before.bytes);
    CHECK(after.revision == moved);

    const Wire now = decode(*after.bytes);
    CHECK(now.header.at("revision") == moved);
    CHECK(column(now, namedColumn(now, "%play_count%")) == std::vector<std::string>{"4"});

    const Wire then = decode(*before.bytes);
    CHECK(then.header.at("revision") == before.revision);
    CHECK(column(then, namedColumn(then, "%play_count%")) == std::vector<std::string>{"3"});
}

TEST_CASE("an export after a rebuild names the new structure") {
    Library library;
    library.replace(snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"})}));
    const auto before = library.exported();

    library.replace(
        snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"}), track("a/", "2.mp3", {"Two"})}));
    const auto after = library.exported();

    CHECK(after.structure == before.structure + 1);
    CHECK(decode(*after.bytes).header.at("trackCount") == 2);
}

TEST_CASE("each part of one revision is one serialisation, whichever was asked for in between") {
    Library library;
    library.replace(snapshotOf({"%title%", "%play_count%"}, {track("a/", "1.mp3", {"One", "3"})}));
    const ExportPart titles{.only = {"%title%"}, .spine = true};
    const ExportPart plays{.only = {"%play_count%"}, .spine = false};

    const auto whole = library.exported();
    const auto firstTitles = library.exported(titles);
    const auto firstPlays = library.exported(plays);
    const auto wholeAgain = library.exported();
    const auto titlesAgain = library.exported(titles);
    const auto playsAgain = library.exported(plays);

    REQUIRE(whole.bytes);
    REQUIRE(firstTitles.bytes);
    REQUIRE(firstPlays.bytes);
    CHECK(*firstTitles.bytes != *whole.bytes);
    CHECK(*firstPlays.bytes != *firstTitles.bytes);
    CHECK(wholeAgain.bytes == whole.bytes);
    CHECK(titlesAgain.bytes == firstTitles.bytes);
    CHECK(playsAgain.bytes == firstPlays.bytes);
}

namespace {

struct Shape {
    const char* name;
    std::function<void(Library&)> fill;
};

std::function<void(Library&)> holding(const std::vector<std::string>& columns,
                                      const std::vector<Row>& rows) {
    return [columns, rows](Library& library) { library.replace(snapshotOf(columns, rows)); };
}

std::vector<Row> distinctTracks(size_t count, size_t valueBytes = 0) {
    std::vector<Row> rows;
    rows.reserve(count);
    for (size_t index = 0; index < count; ++index) {
        rows.push_back(track("a/", std::to_string(index) + ".mp3",
                             {"t" + std::to_string(index) + std::string(valueBytes, 'x')}));
    }
    return rows;
}

std::vector<Shape> exportShapes() {
    std::vector<Shape> shapes{
        {"one track and one column", holding({"%title%"}, {track("a/", "1.mp3", {"One"})})},
        {"a one-letter column name", holding({"a"}, {track("a/", "1.mp3", {"x"})})},
        {"a two-letter column name", holding({"ab"}, {track("a/", "1.mp3", {"x"})})},
        {"a three-letter column name", holding({"abc"}, {track("a/", "1.mp3", {"x"})})},
        {"a four-letter column name", holding({"abcd"}, {track("a/", "1.mp3", {"x"})})},
        {"a column name the header escapes",
         holding({R"(%title% "quoted" \ slashed)"}, {track("a/", "1.mp3", {"One"})})},
        {"a column name that is not UTF-8",
         holding({"%title%\xff\xfe"}, {track("a/", "1.mp3", {"One"})})},
        {"multi-byte values of odd lengths",
         holding({"%artist%", "%title%"}, {track("Sigur Rós/", "1.mp3", {"細野晴臣", "é"}),
                                           track("Beyoncé/", "2.mp3", {"🎧 mix", "ñandú"})})},
        {"two-byte ids and ends", holding({"%title%"}, distinctTracks(300))},
        {"one-byte ids and four-byte ends", holding({"%title%"}, distinctTracks(200, 400))},
        {"four-byte ids and ends", holding({"%title%"}, distinctTracks(70000))},
        {"an empty library", holding({"%title%"}, {})},
        {"a library patched after it was built",
         [](Library& library) {
             library.replace(snapshotOf({"%play_count%"}, {track("a/", "1.mp3", {"3"})}));
             library.apply({{0, track("a/", "1.mp3", {"a much longer play count than before"})}});
         }},
    };
    return shapes;
}

}  // namespace

TEST_CASE("an export of any shape is handed out at the ceiling and withheld a byte past it") {
    for (const Shape& shape : exportShapes()) {
        CAPTURE(shape.name);

        Library unbounded;
        shape.fill(unbounded);
        const auto whole = unbounded.exported().bytes;
        REQUIRE(whole);

        Library atTheCeiling(kRetainedRevisions, whole->size());
        shape.fill(atTheCeiling);
        const auto sent = atTheCeiling.exported().bytes;
        CHECK((sent && *sent == *whole));

        Library pastIt(kRetainedRevisions, whole->size() - 1);
        shape.fill(pastIt);
        CHECK_FALSE(pastIt.exported().bytes);
        CHECK_FALSE(pastIt.exported().bytes);
    }
}

TEST_CASE("a library withheld for its size is exported again once a rebuild brings it under") {
    constexpr size_t kHeadroom = 16;
    const auto fits = holding({"%title%"}, {track("a/", "1.mp3", {"One"})});

    Library measured;
    fits(measured);
    const size_t ceiling = measured.exported().bytes->size() + kHeadroom;

    Library library(kRetainedRevisions, ceiling);
    fits(library);
    CHECK(library.exported().bytes);

    library.apply({{0, track("a/", "1.mp3", {std::string(2 * kHeadroom, 'x')})}});
    CHECK_FALSE(library.exported().bytes);

    const uint64_t withheld = library.state().structure;
    library.replace(snapshotOf({"%title%"}, {track("b/", "1.mp3", {"One"})}));
    const auto rebuilt = library.exported().bytes;
    REQUIRE(rebuilt);
    CHECK(decode(*rebuilt).header.at("structure") != withheld);
}

TEST_CASE("an export racing a row change always reads one whole revision") {
    Library library;
    library.replace(snapshotOf({"%play_count%"}, {track("a/", "1.mp3", {"1"})}));
    const uint64_t first = library.state().revision;

    constexpr int kChanges = 200;
    std::thread writer([&library] {
        for (int plays = 2; plays <= kChanges; ++plays)
            library.apply({{0, track("a/", "1.mp3", {std::to_string(plays)})}});
    });

    REQUIRE(eventually([&library, first] { return library.state().revision > first; }));
    size_t torn = 0;
    for (int read = 0; read < kChanges; ++read) {
        const auto exported = library.exported();
        const Wire wire = decode(*exported.bytes);
        const json plays = namedColumn(wire, "%play_count%");
        const auto newest = plays.at("distinct").get<uint64_t>();
        if (wire.header.at("revision") != exported.revision ||
            newest != exported.revision - first + 1 ||
            ids(wire, plays.at("ids")) != std::vector<uint32_t>{static_cast<uint32_t>(newest - 1)})
            ++torn;
    }
    writer.join();

    CHECK(torn == 0);
}

TEST_CASE("a read racing row changes sees every row and column at one revision") {
    constexpr uint32_t kTracks = 4;
    const auto rowAt = [](uint32_t ordinal, uint64_t plays) {
        return track("a/", std::to_string(ordinal) + ".mp3",
                     {std::to_string(plays), "Played " + std::to_string(plays)});
    };

    Library library;
    std::vector<Row> rows;
    rows.reserve(kTracks);
    for (uint32_t ordinal = 0; ordinal < kTracks; ++ordinal)
        rows.push_back(rowAt(ordinal, 1));
    library.replace(snapshotOf({"%play_count%", "%title%"}, rows));
    const uint64_t first = library.state().revision;

    constexpr uint64_t kChanges = 2000;
    std::atomic<bool> written{false};
    std::thread writer([&library, &rowAt, &written] {
        for (uint64_t plays = 2; plays <= kChanges; ++plays) {
            std::vector<RowChange> changes;
            changes.reserve(kTracks);
            for (uint32_t ordinal = 0; ordinal < kTracks; ++ordinal)
                changes.push_back({ordinal, rowAt(ordinal, plays)});
            library.apply(changes);
        }
        written = true;
    });

    REQUIRE(eventually([&library, first] { return library.state().revision > first; }));
    size_t torn = 0;
    size_t reads = 0;
    do {
        ++reads;
        library.read([&torn, first](const Snapshot& snapshot) {
            const auto plays = std::to_string(snapshot.revision - first + 1);
            for (size_t field = kSpineFieldCount; field < snapshot.columns.size(); ++field) {
                const Column& column = snapshot.columns[field];
                torn += static_cast<size_t>(std::count_if(
                    column.ids.begin(), column.ids.end(), [&column, &plays](uint32_t id) {
                        const auto& value = column.dictionary.values[id];
                        return value != plays && value != "Played " + plays;
                    }));
            }
        });
    } while (!written);
    writer.join();

    INFO("reads: ", reads);
    CHECK(torn == 0);
}

TEST_CASE("a row whose values did not move leaves the revision alone") {
    Library library;
    library.replace(snapshotOf({"%play_count%"}, {track("a/", "1.mp3", {"3"})}));
    const auto built = library.state();

    CHECK(library.apply({{0, track("a/", "1.mp3", {"3"})}}) == built.revision);
    CHECK(library.state().revision == built.revision);
    CHECK(library.changes(built.structure, built.revision).delta.columns.empty());
}

TEST_CASE("a delta names only the columns that moved") {
    Library library;
    library.replace(snapshotOf({"%title%", "%play_count%"}, {track("a/", "1.mp3", {"One", "3"}),
                                                             track("a/", "2.mp3", {"Two", "0"})}));
    const auto built = library.state();

    CHECK(library.apply({{1, track("a/", "2.mp3", {"Two", "1"})}}) == built.revision + 1);

    const auto changes = library.changes(built.structure, built.revision);
    REQUIRE(changes.outcome == DeltaOutcome::ok);
    REQUIRE(changes.delta.columns.size() == 1);

    const ColumnDelta& patch = changes.delta.columns.front();
    CHECK(patch.name == "%play_count%");
    CHECK(patch.ordinals == std::vector<uint32_t>{1});
    CHECK(patch.appended == std::vector<std::string>{"1"});
    CHECK(patch.base == 2);

    const std::string message = serialiseDelta(changes.delta);
    checkAlignment(message);

    const Wire wire = decode(message);
    CHECK(wire.header.at("kind") == "delta");
    CHECK(wire.header.at("since") == built.revision);
    CHECK(wire.header.at("revision") == built.revision + 1);
    CHECK(wire.header.at("spine").empty());

    const json& plays = namedColumn(wire, "%play_count%");
    CHECK(ids(wire, plays.at("ordinals")) == std::vector<uint32_t>{1});
    CHECK(dictionary(wire, plays.at("dict")) == std::vector<std::string>{"1"});
    CHECK(plays.at("dict").at("base") == 2);
    CHECK(plays.at("distinct") == 3);
}

TEST_CASE("a dictionary only ever grows, so a client patches rather than rebuilds") {
    Library library;
    library.replace(
        snapshotOf({"%genre%"}, {track("a/", "1.mp3", {"Rock"}), track("a/", "2.mp3", {"Jazz"})}));
    const auto built = library.state();

    // Rock stops being used, and its entry stays: a client already holds id 0.
    library.apply({{0, track("a/", "1.mp3", {"Ambient"})}});
    library.apply({{1, track("a/", "2.mp3", {"Ambient"})}});

    const auto changes = library.changes(built.structure, built.revision);
    REQUIRE(changes.outcome == DeltaOutcome::ok);
    REQUIRE(changes.delta.columns.size() == 1);

    const ColumnDelta& patch = changes.delta.columns.front();
    CHECK(patch.base == 2);
    CHECK(patch.appended == std::vector<std::string>{"Ambient"});
    CHECK(patch.ordinals == std::vector<uint32_t>{0, 1});
    CHECK(patch.ids == std::vector<uint32_t>{2, 2});

    // The same delta asked for one revision later carries the appends already sent.
    const auto later = library.changes(built.structure, built.revision + 1);
    REQUIRE(later.delta.columns.size() == 1);
    CHECK(later.delta.columns.front().base == 3);
    CHECK(later.delta.columns.front().appended.empty());
}

TEST_CASE("a whole spine column moving is still a delta") {
    Library library;
    library.replace(snapshotOf({"%title%"}, {track("old/", "1.mp3", {"One"})}));
    const auto built = library.state();

    library.apply({{0, track("new/", "1.mp3", {"One"})}});

    const Wire wire =
        decode(serialiseDelta(library.changes(built.structure, built.revision).delta));
    CHECK(wire.header.at("columns").empty());

    // A delta's ids are into the whole dictionary, and only what was appended to it travels.
    const json& directory = wire.header.at("spine").at("directory");
    CHECK(directory.at("dict").at("base") == 1);
    CHECK(dictionary(wire, directory.at("dict")) == std::vector<std::string>{"new/"});
    CHECK(ids(wire, directory.at("ids")) == std::vector<uint32_t>{1});
    CHECK(ids(wire, directory.at("ordinals")) == std::vector<uint32_t>{0});
}

TEST_CASE("a client at the current revision is told nothing changed") {
    Library library;
    library.replace(snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"})}));
    const auto built = library.state();

    const auto changes = library.changes(built.structure, built.revision);
    CHECK(changes.outcome == DeltaOutcome::ok);
    CHECK(changes.delta.columns.empty());
    CHECK(changes.delta.since == built.revision);
    CHECK(changes.delta.revision == built.revision);
}

TEST_CASE("a pair held before tracks were added is answered, and a pair no snapshot held is not") {
    constexpr size_t kTracks = 100;
    std::vector<Row> rows = distinctTracks(kTracks);

    Library library;
    library.replace(snapshotOf({"%title%"}, rows));
    const auto first = library.state();
    for (const uint32_t ordinal : {0U, 1U}) {
        rows[ordinal] = track("a/", rows[ordinal][1], {"played"});
        library.apply({{ordinal, rows[ordinal]}});
    }
    const uint64_t played = library.state().revision;
    REQUIRE(played == first.revision + 2);

    rows.push_back(track("a/", "added.mp3", {"Added"}));
    library.replace(snapshotOf({"%title%"}, rows));
    const auto second = library.state();
    REQUIRE(second.structure != first.structure);
    REQUIRE(second.revision == played + 1);

    CHECK(library.changes(first.structure, played).outcome == DeltaOutcome::ok);
    CHECK(library.changes(first.structure, first.revision).outcome == DeltaOutcome::ok);
    CHECK(library.changes(second.structure, second.revision).outcome == DeltaOutcome::ok);

    CHECK(library.changes(second.structure, played).outcome == DeltaOutcome::pairNotHeld);
    CHECK(library.changes(first.structure, second.revision).outcome == DeltaOutcome::pairNotHeld);
    CHECK(library.changes(second.structure + 1, second.revision).outcome ==
          DeltaOutcome::pairNotHeld);
}

TEST_CASE("a rebuild that adds or removes tracks lands on a new structure, the one announced") {
    const std::vector<Row> before = distinctTracks(10);

    std::vector<Row> added = before;
    added.insert(added.begin() + 4, track("a/", "added.mp3", {"Added"}));

    std::vector<Row> removed = before;
    removed.erase(removed.begin() + 4);

    std::vector<Row> both = removed;
    both.push_back(track("a/", "added.mp3", {"Added"}));

    for (const auto& [name, after] : std::vector<std::pair<const char*, std::vector<Row>>>{
             {"added", added}, {"removed", removed}, {"added and removed", both}}) {
        CAPTURE(name);

        Library library;
        library.replace(snapshotOf({"%title%"}, before));
        const uint64_t was = library.state().structure;

        const Snapshot next = snapshotOf({"%title%"}, after);
        const uint64_t announced = library.structureAfter(next);
        library.replace(next);

        CHECK(announced != was);
        CHECK(library.state().structure == announced);
    }
}

TEST_CASE("a revision this library never reached is refused rather than answered empty") {
    Library library;
    library.replace(snapshotOf({"%title%"}, {track("a/", "1.mp3", {"One"})}));
    const auto built = library.state();

    CHECK(library.changes(built.structure, built.revision + 98).outcome ==
          DeltaOutcome::revisionUnknown);
}

TEST_CASE("a client further behind than the retained window is told to export again") {
    Library library(3);
    library.replace(snapshotOf({"%play_count%"}, {track("a/", "1.mp3", {"0"})}));

    const auto built = library.state();

    for (int play = 1; play <= 5; ++play)
        library.apply({{0, track("a/", "1.mp3", {std::to_string(play)})}});

    REQUIRE(library.state().revision == built.revision + 5);

    const uint64_t oldest = built.revision + 2;
    CHECK(library.changes(built.structure, oldest).outcome == DeltaOutcome::ok);
    CHECK(library.changes(built.structure, oldest - 1).outcome == DeltaOutcome::revisionTooOld);
    CHECK(library.changes(built.structure, oldest - 1).delta.columns.empty());
}

TEST_CASE("the oldest answerable client gets every append it missed") {
    Library library(3);
    library.replace(snapshotOf({"%play_count%"}, {track("a/", "1.mp3", {"0"})}));
    const auto built = library.state();

    for (int play = 1; play <= 5; ++play)
        library.apply({{0, track("a/", "1.mp3", {std::to_string(play)})}});

    const auto changes = library.changes(built.structure, built.revision + 2);
    REQUIRE(changes.delta.columns.size() == 1);

    const ColumnDelta& patch = changes.delta.columns.front();
    CHECK(patch.base == 3);
    CHECK(patch.appended == std::vector<std::string>{"3", "4", "5"});
    CHECK(patch.ids == std::vector<uint32_t>{5});
}

// The comparison here stands in for foobar2000's own (ARCHITECTURE.md, *Facts about the player*,
// has the real one measured); what this pins is that ordinalOrder follows whichever one
// arrives from fb2k/, ahead of the tiebreaks.
TEST_CASE("ordinals follow the path comparison the player supplies") {
    const std::vector<TrackOrder> tracks{
        {0, "file://10cc/1.mp3"}, {1, "file://5 Seconds/1.mp3"}, {2, "file://2 Mello/1.mp3"}};

    const std::vector<int> asThePlayerWould{2, 1, 0};
    const auto comparePaths = [&asThePlayerWould](size_t left, size_t right) {
        return asThePlayerWould[left] - asThePlayerWould[right];
    };

    CHECK(ordinalOrder(tracks, comparePaths) == std::vector<size_t>{2, 1, 0});
}

// Two library roots can hand back the same relative path, and one file can hold many subsongs.
// Without a total order the two swap places on a rebuild that changed nothing, and every
// client's refs quietly point at the other track.
TEST_CASE("tracks sharing a relative path still order the same way every time") {
    const std::vector<TrackOrder> tracks{{2, "file://second/a/1.flac"},
                                         {0, "file://second/a/1.flac"},
                                         {0, "file://first/a/1.flac"},
                                         {2, "file://first/a/1.flac"}};

    const auto onePath = [](size_t, size_t) { return 0; };

    const auto order = ordinalOrder(tracks, onePath);
    CHECK(order == std::vector<size_t>{2, 1, 3, 0});

    const std::vector<TrackOrder> shuffled{tracks[3], tracks[0], tracks[2], tracks[1]};
    const auto again = ordinalOrder(shuffled, onePath);

    const auto identities = [](const std::vector<TrackOrder>& of,
                               const std::vector<size_t>& order) {
        std::vector<std::string> named(order.size());
        std::transform(order.begin(), order.end(), named.begin(), [&of](size_t index) {
            return of[index].canonicalPath + "#" + std::to_string(of[index].subsong);
        });
        return named;
    };

    CHECK(identities(tracks, order) == identities(shuffled, again));
}

// A write and a one-track read are addressed by a relative path and a subsong, and
// fb2k/library.cpp resolves that address by taking the lowest ordinal at the path and walking
// forward while the path still matches. The walk is correct only because the tie under the
// player's own path comparison is broken by subsong: every track of a cue sheet shares one
// relative path, so they have to land in one unbroken run and in subsong order however
// foobar2000 listed them. Break that and a cue-sheet track rates its neighbour.
TEST_CASE("every subsong of one file takes an unbroken run of ordinals, in subsong order") {
    const std::string cue = "Someone/A Record/disc.flac";

    // In the order the player listed them, which is no order at all.
    const std::vector<std::string> relativePaths{cue, "Someone/A Record/other.flac", cue,
                                                 "Someone/A Record/01 A Song.flac", cue};

    const std::vector<TrackOrder> tracks{{2, "file://music/Someone/A Record/disc.flac"},
                                         {0, "file://music/Someone/A Record/other.flac"},
                                         {0, "file://music/Someone/A Record/disc.flac"},
                                         {0, "file://music/Someone/A Record/01 A Song.flac"},
                                         {1, "file://music/Someone/A Record/disc.flac"}};

    const auto comparePaths = [&relativePaths](size_t left, size_t right) {
        return relativePaths[left].compare(relativePaths[right]);
    };

    const std::vector<size_t> order = ordinalOrder(tracks, comparePaths);

    const auto pathAt = [&](size_t ordinal) { return relativePaths[order[ordinal]]; };

    size_t first = 0;
    while (first < order.size() && pathAt(first) != cue)
        ++first;

    std::vector<uint32_t> walked;
    for (size_t ordinal = first; ordinal < order.size() && pathAt(ordinal) == cue; ++ordinal)
        walked.push_back(tracks[order[ordinal]].subsong);

    // Three of them, in subsong order: a subsong sitting past a neighbouring file's row is one
    // the walk gives up before it sees, and the address then resolves to whichever track the
    // walk stopped on.
    CHECK(walked == std::vector<uint32_t>{0, 1, 2});
}

TEST_CASE("a relative path splits where the client's own path table splits it") {
    CHECK(splitRelativePath("Artist/Album/01.mp3").directory == "Artist/Album/");
    CHECK(splitRelativePath("Artist/Album/01.mp3").filename == "01.mp3");
    CHECK(splitRelativePath("loose.mp3").directory.empty());
    CHECK(splitRelativePath("loose.mp3").filename == "loose.mp3");
}

TEST_CASE("a well-formed request is taken apart into its pieces") {
    const auto request = parseLibraryRequest({"%artist%", "%title%"}, "41");

    REQUIRE(request.ok());
    CHECK(request.columns == std::vector<std::string>{"%artist%", "%title%"});
    CHECK(request.since == 41);
}

TEST_CASE("an export asks for no revision at all") {
    const auto request = parseLibraryRequest({"%artist%"}, "");

    REQUIRE(request.ok());
    CHECK(request.since == 0);
}

// GET /api/library/changes forwards its since straight into this parser and relies on an
// empty one reading as revision zero. The playlist route is the one that refuses an empty
// since, before ever calling here. Pinned so a later attempt to make this parser refuse it too
// does not silently break the library route instead.
TEST_CASE("a since that arrived present but empty is read as revision zero") {
    const auto request = parseLibraryRequest({}, "");

    REQUIRE(request.ok());
    CHECK(request.since == 0);
}

TEST_CASE("the spine is always there, so a request need name no column of its own") {
    CHECK(parseLibraryRequest({}, "").ok());
}

TEST_CASE("more columns than the component will evaluate is refused") {
    const std::vector<std::string> columns(kMaxColumns + 1, "%artist%");
    const auto request = parseLibraryRequest(columns, "");

    CHECK(request.refusal == LibraryRefusal::tooManyColumns);
    CHECK(request.detail.find(std::to_string(kMaxColumns)) != std::string::npos);
}

TEST_CASE("a column expression is bounded, printable and not empty") {
    CHECK(parseLibraryRequest({std::string(kMaxColumnLength, 'x')}, "").ok());

    CHECK(parseLibraryRequest({std::string(kMaxColumnLength + 1, 'x')}, "").refusal ==
          LibraryRefusal::badColumn);
    CHECK(parseLibraryRequest({""}, "").refusal == LibraryRefusal::badColumn);
    CHECK(parseLibraryRequest({"%artist%\n%title%"}, "").refusal == LibraryRefusal::badColumn);

    const auto request = parseLibraryRequest({"%artist%", ""}, "");
    CHECK(request.detail.find("column 1") != std::string::npos);
}

// A few hundred characters of $puts doubling a variable format to gigabytes, and the snapshot holds
// one value per column for every track in the library.
TEST_CASE("a formatted value is held to the cap, and one under it is kept whole") {
    const std::string lyrics(kMaxColumnValueBytes, 'l');
    CHECK(cappedColumnValue(lyrics) == lyrics);

    const std::string repeated(kMaxColumnValueBytes * 4, 'x');
    CHECK(cappedColumnValue(repeated) == std::string(kMaxColumnValueBytes, 'x'));
}

// A value cut inside a character would reach the client as invalid UTF-8, which nlohmann::json
// refuses to serialise at all.
TEST_CASE("a formatted value is cut between characters, never inside one") {
    const std::string twoBytes = "\xc3\xa9";
    const std::string value = std::string(kMaxColumnValueBytes - 1, 'x') + twoBytes + "tail";

    const auto capped = cappedColumnValue(value);

    CHECK(capped == std::string(kMaxColumnValueBytes - 1, 'x'));
    CHECK_NOTHROW(json(capped).dump());
}

TEST_CASE("a column asked for twice is refused rather than evaluated twice") {
    const auto request = parseLibraryRequest({"%artist%", "%title%", "%artist%"}, "");

    CHECK(request.refusal == LibraryRefusal::duplicateColumn);
    CHECK(request.detail.find("column 2") != std::string::npos);
}

TEST_CASE("a revision that is not a whole number is refused") {
    CHECK(parseLibraryRequest({"%artist%"}, "-1").refusal == LibraryRefusal::badSince);
    CHECK(parseLibraryRequest({"%artist%"}, "4 1").refusal == LibraryRefusal::badSince);
    CHECK(parseLibraryRequest({"%artist%"}, "99999999999999999999").refusal ==
          LibraryRefusal::badSince);
}

// The columns are the expensive half of the request, so a request that is wrong about both is
// told about the columns rather than sent away to fix the cheap part first.
TEST_CASE("the columns are validated before the revision is") {
    const std::vector<std::string> columns(kMaxColumns + 1, "%artist%");
    CHECK(parseLibraryRequest(columns, "nonsense").refusal == LibraryRefusal::tooManyColumns);
    CHECK(parseLibraryRequest({""}, "nonsense").refusal == LibraryRefusal::badColumn);
}

namespace {

bool allDifferent(std::vector<std::string> said) {
    std::sort(said.begin(), said.end());
    return std::adjacent_find(said.begin(), said.end()) == said.end();
}

}  // namespace

TEST_CASE("every refusal says something of its own") {
    CHECK(allDifferent({describe(LibraryRefusal::none), describe(LibraryRefusal::tooManyColumns),
                        describe(LibraryRefusal::badColumn),
                        describe(LibraryRefusal::duplicateColumn),
                        describe(LibraryRefusal::badSince)}));
}

TEST_CASE("every delta outcome says something of its own") {
    CHECK(allDifferent(
        {describe(DeltaOutcome::ok), describe(DeltaOutcome::notBuilt),
         describe(DeltaOutcome::structureChanged), describe(DeltaOutcome::revisionTooOld),
         describe(DeltaOutcome::revisionUnknown), describe(DeltaOutcome::pairNotHeld),
         describe(DeltaOutcome::spliceTooLarge), describe(DeltaOutcome::dictionariesCompacted),
         describe(DeltaOutcome::rearranged)}));
}

namespace {

std::vector<std::string> declaring(const char* column) {
    return {"%artist%", column};
}

std::vector<std::string> runOne(RebuildQueue& queue) {
    REQUIRE(queue.startIfWanted());
    const std::vector<std::string> built = queue.columns();
    queue.finished();
    return built;
}

}  // namespace

TEST_CASE("every data move is counted, so a worker can tell a burst from a quiet library") {
    RebuildQueue queue;
    CHECK(queue.dataMoves() == 0);

    queue.dataMoved();
    queue.dataMoved();
    CHECK(queue.dataMoves() == 2);
    CHECK(queue.wanted());

    REQUIRE(queue.startIfWanted());
    CHECK(queue.dataMoves() == 2);
}

TEST_CASE("a rebuild wanted by data alone may wait, and one a declaration waits on may not") {
    RebuildQueue queue;
    CHECK_FALSE(queue.wantedForDataAlone());

    queue.dataMoved();
    CHECK(queue.wantedForDataAlone());

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    CHECK(queue.wanted());
    CHECK_FALSE(queue.wantedForDataAlone());

    REQUIRE(queue.startIfWanted());
    queue.finished();
    queue.ask(declaring("%album%"), RebuildReason::dataChanged);
    CHECK(queue.wantedForDataAlone());
}

TEST_CASE("a declaration with nothing running queues a build of it") {
    RebuildQueue queue;
    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);

    CHECK(queue.wanted());
    CHECK(runOne(queue) == declaring("%album%"));
    CHECK_FALSE(queue.wanted());
}

TEST_CASE("a declaration naming the set already building cancels the one queued behind it") {
    RebuildQueue queue;

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    REQUIRE(queue.startIfWanted());

    queue.ask(declaring("%comment%"), RebuildReason::columnsDeclared);
    CHECK(queue.wanted());

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    CHECK_FALSE(queue.wanted());

    queue.finished();
    CHECK_FALSE(queue.wanted());
}

TEST_CASE("the last declaration of a set nobody is building is the one built") {
    RebuildQueue queue;

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    REQUIRE(queue.startIfWanted());

    queue.ask(declaring("%comment%"), RebuildReason::columnsDeclared);
    queue.ask(declaring("%date%"), RebuildReason::columnsDeclared);
    queue.finished();

    CHECK(runOne(queue) == declaring("%date%"));
}

// A dropped data rebuild leaves every client on a stale library until something else moves,
// so the cancellation is narrower than last-request-wins: it reaches a rebuild queued for a
// column set and no further.
TEST_CASE("a declaration naming the set already building does not cancel a data rebuild") {
    RebuildQueue queue;

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    REQUIRE(queue.startIfWanted());

    queue.dataMoved();
    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    queue.finished();

    CHECK(queue.wanted());
    CHECK(runOne(queue) == declaring("%album%"));
}

TEST_CASE("a refresh of the set already building is a rebuild rather than a duplicate") {
    RebuildQueue queue;

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    REQUIRE(queue.startIfWanted());

    queue.ask(declaring("%album%"), RebuildReason::dataChanged);
    queue.finished();

    CHECK(queue.wanted());
    CHECK(runOne(queue) == declaring("%album%"));
}

TEST_CASE("a data rebuild builds the set declared most recently") {
    RebuildQueue queue;

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    REQUIRE(queue.startIfWanted());
    queue.ask(declaring("%comment%"), RebuildReason::columnsDeclared);
    queue.finished();

    queue.dataMoved();

    CHECK(runOne(queue) == declaring("%comment%"));
}

// The worker also wakes for dirty rows, and those rows are re-queried against the set the
// snapshot already holds rather than triggering a build.
TEST_CASE("a wake with nothing wanted starts no build") {
    RebuildQueue queue;

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    CHECK(runOne(queue) == declaring("%album%"));

    CHECK_FALSE(queue.startIfWanted());
    CHECK(queue.columns() == declaring("%album%"));
}

TEST_CASE("a declaration made once nothing is building is built even if it is the same set") {
    RebuildQueue queue;

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    CHECK(runOne(queue) == declaring("%album%"));

    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    CHECK(queue.wanted());
}

TEST_CASE("a build the worker failed in is wanted again, of the set it was building") {
    RebuildQueue queue;
    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    REQUIRE(queue.startIfWanted());

    queue.failed();

    CHECK(queue.wanted());
    CHECK_FALSE(queue.wantedForDataAlone());
    CHECK(runOne(queue) == declaring("%album%"));
}

TEST_CASE("a build the worker failed in gives way to a set declared while it ran") {
    RebuildQueue queue;
    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    REQUIRE(queue.startIfWanted());
    queue.ask(declaring("%comment%"), RebuildReason::columnsDeclared);

    queue.failed();

    CHECK(runOne(queue) == declaring("%comment%"));
}

// Row changes the worker had taken off the queue are gone with the failure, and only a rebuild
// brings them back.
TEST_CASE("a failure with no build running wants a rebuild of the set already held") {
    RebuildQueue queue;
    queue.ask(declaring("%album%"), RebuildReason::columnsDeclared);
    CHECK(runOne(queue) == declaring("%album%"));

    queue.failed();

    CHECK(queue.wanted());
    CHECK(runOne(queue) == declaring("%album%"));
}

namespace {

// Decimal folder and file numbers compare as numbers in the player's order, so `10 Folder/` follows
// `9 Folder/`, where a bytewise comparison puts it first.
struct TrackKey {
    uint32_t folder = 0;
    uint32_t file = 0;
    uint32_t subsong = 0;

    bool operator<(const TrackKey& other) const {
        return std::tie(folder, file, subsong) < std::tie(other.folder, other.file, other.subsong);
    }
};

struct TrackValues {
    std::string title;
    std::string artist;
    std::string plays;
    std::string genre;
    std::string rating;
    std::string composer;
};

const std::vector<std::string>& spliceColumns() {
    static const std::vector<std::string> columns{"title", "artist", "plays",
                                                  "genre", "rating", "composer"};
    return columns;
}

constexpr char kSpliceExport[] =
    "/api/library/export?columns=title&columns=artist&columns=plays&columns=genre&columns=rating"
    "&columns=composer";

// A generator whose sequence is the same on every standard library: std::mt19937's output is
// specified, and the distributions over it are not.
class Dice {
public:
    explicit Dice(uint32_t seed) : engine_(seed) {}

    uint32_t below(uint32_t bound) { return static_cast<uint32_t>(engine_() % bound); }
    bool oneIn(uint32_t chances) { return below(chances) == 0; }

private:
    std::mt19937 engine_;
};

class GeneratedLibrary {
public:
    explicit GeneratedLibrary(Dice& dice) : dice_(dice) {}

    void seed(size_t tracks) {
        while (tracks_.size() < tracks)
            addFile();
    }

    std::vector<Row> rows() const {
        std::vector<Row> rows;
        rows.reserve(tracks_.size());
        for (const auto& [key, values] : tracks_)
            rows.push_back(rowOf(key, values));
        return rows;
    }

    Snapshot snapshot() const { return snapshotOf(spliceColumns(), rows()); }

    RowChange play() {
        auto at = tracks_.begin();
        std::advance(at, dice_.below(static_cast<uint32_t>(tracks_.size())));
        at->second.plays = std::to_string(dice_.below(kPlayCounts));
        if (dice_.oneIn(4))
            at->second.title = nextTitle();

        const auto ordinal = static_cast<uint32_t>(std::distance(tracks_.begin(), at));
        return RowChange{ordinal, rowOf(at->first, at->second)};
    }

    void rescan(bool adding, bool removing) {
        rescanned_ = true;
        if (adding) {
            for (uint32_t file = 1 + dice_.below(kMostFilesAdded); file > 0; --file) {
                if (dice_.oneIn(4))
                    addSubsongToACue();
                else
                    addFile();
            }
        }

        if (removing) {
            for (uint32_t track = 1 + dice_.below(kMostTracksRemoved); track > 0; --track) {
                auto at = tracks_.begin();
                std::advance(at, dice_.below(static_cast<uint32_t>(tracks_.size())));
                tracks_.erase(at);
            }
        }

        for (uint32_t retagged = dice_.below(kMostRetagged); retagged > 0; --retagged) {
            auto at = tracks_.begin();
            std::advance(at, dice_.below(static_cast<uint32_t>(tracks_.size())));
            at->second = valuesFor();
        }
    }

private:
    static constexpr uint32_t kFolders = 14;
    static constexpr uint32_t kFilesPerFolder = 60;
    static constexpr uint32_t kArtists = 23;
    static constexpr uint32_t kPlayCounts = 40;
    static constexpr uint32_t kComposers = 8;
    static constexpr uint32_t kMostFilesAdded = 4;
    static constexpr uint32_t kMostTracksRemoved = 4;
    static constexpr uint32_t kMostRetagged = 3;

    static Row rowOf(const TrackKey& key, const TrackValues& values) {
        return {std::to_string(key.folder) + " Folder/",
                std::to_string(key.file) + ".flac",
                std::to_string(key.subsong),
                values.title,
                values.artist,
                values.plays,
                values.genre,
                values.rating,
                values.composer};
    }

    std::string nextTitle() { return "title " + std::to_string(titles_++); }

    TrackValues valuesFor() {
        static const std::vector<std::string> genres{"", "?", "Ambient", "Folk", "Jazz", "Rock"};

        TrackValues values;
        values.title = nextTitle();
        values.artist = dice_.oneIn(9) ? "?" : "artist " + std::to_string(dice_.below(kArtists));
        values.plays = dice_.oneIn(5) ? "?" : std::to_string(dice_.below(kPlayCounts));
        values.genre = genres[dice_.below(static_cast<uint32_t>(genres.size()))];

        values.rating = rescanned_ && dice_.oneIn(2) ? std::to_string(1 + dice_.below(5)) : "?";
        values.composer = rescanned_ && dice_.oneIn(3)
                              ? "?"
                              : "composer " + std::to_string(dice_.below(kComposers));
        return values;
    }

    // A cue sheet's subsongs are rows of their own at one path.
    void addFile() {
        TrackKey key{dice_.below(kFolders), dice_.below(kFilesPerFolder), 0};
        while (holdsFile(key))
            key.file = dice_.below(kFilesPerFolder) + (kFilesPerFolder * (1 + dice_.below(9)));

        if (!dice_.oneIn(6)) {
            tracks_[key] = valuesFor();
            return;
        }

        for (uint32_t subsong = kFirstCueSubsong; subsong < kFirstCueSubsong + kCueSubsongs;
             ++subsong)
            tracks_[TrackKey{key.folder, key.file, subsong}] = valuesFor();
    }

    void addSubsongToACue() {
        const auto cue = std::find_if(tracks_.begin(), tracks_.end(),
                                      [](const auto& held) { return held.first.subsong > 0; });
        if (cue == tracks_.end()) {
            addFile();
            return;
        }

        TrackKey key = cue->first;
        while (tracks_.count(key) == 1)
            ++key.subsong;
        tracks_[key] = valuesFor();
    }

    bool holdsFile(const TrackKey& key) const {
        const auto from = tracks_.lower_bound(TrackKey{key.folder, key.file, 0});
        return from != tracks_.end() && from->first.folder == key.folder &&
               from->first.file == key.file;
    }

    Dice& dice_;
    std::map<TrackKey, TrackValues> tracks_;
    uint32_t titles_ = 0;
    bool rescanned_ = false;
};

struct HeldAt {
    uint64_t structure = 0;
    uint64_t revision = 0;
    HeldLibrary library;
};

HeldLibrary exportedBy(const TestServer& server) {
    const auto response = get(server, kSpliceExport);
    REQUIRE(response);
    REQUIRE(response->status == 200);
    return held(decode(response->body));
}

std::string changesFrom(uint64_t structure, uint64_t since) {
    return "/api/library/changes?since=" + std::to_string(since) +
           "&structure=" + std::to_string(structure);
}

}  // namespace

TEST_CASE("a client applying any splice holds what a fresh export at the new structure holds") {
    constexpr uint32_t kSeeds = 40;
    constexpr uint32_t kSteps = 5;
    constexpr uint32_t kSmallestLibrary = 200;
    constexpr uint32_t kLibrarySpread = 120;

    for (uint32_t seed = 1; seed <= kSeeds; ++seed) {
        CAPTURE(seed);
        Dice dice(seed);
        GeneratedLibrary player(dice);

        player.seed(kSmallestLibrary + dice.below(kLibrarySpread));

        Library library;
        library.replace(player.snapshot());
        const TestServer server(servingSettings(), Player{}, &library);

        std::vector<HeldAt> clients;
        const auto keepWhatAClientHolds = [&] {
            const auto state = library.state();
            clients.push_back({state.structure, state.revision, exportedBy(server)});
        };
        keepWhatAClientHolds();

        for (uint32_t step = 0; step < kSteps; ++step) {
            const uint32_t kind = step < 2 ? 1 + dice.below(3) : dice.below(4);
            if (kind == 0) {
                library.apply({player.play()});
            } else {
                library.apply({player.play()});
                player.rescan(kind != 2, kind != 1);
                library.replace(player.snapshot());
            }
            keepWhatAClientHolds();
        }

        const HeldLibrary fresh = exportedBy(server);
        CHECK(rowsOf(fresh, spliceColumns()) == player.rows());

        size_t splices = 0;
        for (HeldAt& client : clients) {
            if (client.structure == fresh.structure && client.revision == fresh.revision)
                continue;
            CAPTURE(client.structure);
            CAPTURE(client.revision);

            const auto response = get(server, changesFrom(client.structure, client.revision));
            REQUIRE(response);
            REQUIRE(response->status == 200);

            const Wire changes = decode(response->body);
            checkAlignment(response->body);
            CHECK((changes.header.at("kind") == "splice") == (client.structure != fresh.structure));
            if (client.structure != fresh.structure)
                ++splices;

            applyChanges(client.library, changes);
            checkSameLibrary(client.library, fresh);
            CHECK(rowsOf(client.library, spliceColumns()) == player.rows());
        }
        CHECK(splices > 0);
    }
}
