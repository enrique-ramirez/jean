// The library snapshot, its wire format and the requests it will accept, all of it before
// foobar2000 is involved. The tests decode the wire format the way a browser would, because
// an offset that is right in the header and wrong in the blob reads as success everywhere else.

#include "third_party/doctest.h"

#include "core/library.h"
#include "support/wire.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <string>
#include <thread>
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

Snapshot built(const std::vector<std::string>& columns, const std::vector<Row>& rows) {
    LibraryBuilder builder(columns, rows.size());
    LibraryBuilder::Sink& sink = builder.sink();

    for (size_t index = 0; index < rows.size(); ++index)
        sink.row(index, rows[index]);

    return builder.finish();
}

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
        built({"%genre%"}, {track("a/", "1.mp3", {"Rock"}), track("a/", "2.mp3", {"Rock"}),
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

    const Wire wire = decode(serialiseSnapshot(built({"%title%"}, rows)));
    const json& title = namedColumn(wire, "%title%");

    CHECK(title.at("distinct") == 300);
    CHECK(title.at("ids").at("width") == 2);
    CHECK(column(wire, title) == expected);
}

TEST_CASE("an empty library serialises to a well-formed message with no rows") {
    const std::string message = serialiseSnapshot(built({"%title%"}, {}));
    checkAlignment(message);

    const Wire wire = decode(message);
    CHECK(wire.header.at("trackCount") == 0);
    CHECK(namedColumn(wire, "%title%").at("distinct") == 0);
    CHECK(ids(wire, namedColumn(wire, "%title%").at("ids")).empty());
}

TEST_CASE("a single track carries its spine and its columns") {
    const Wire wire = decode(serialiseSnapshot(
        built({"%artist%"}, {track("Bandname/Album/", "01 Song.flac", {"Bandname"})})));

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

    const std::string message = serialiseSnapshot(built({"%artist%"}, rows));
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
    for (const std::string& name : {"%a%", "%ab%", "%abc%", "%abcd%"}) {
        const std::string message = serialiseSnapshot(
            built({name}, {track("a/", "1.mp3", {"x"}), track("a/", "2.mp3", {"yy"})}));

        checkAlignment(message);
        CHECK(decode(message).header.at("columns").at(0).at("name") == name);
    }
}

TEST_CASE("the facts a client would otherwise guess at by sampling rows") {
    const auto snapshot =
        built({"%play_count%", "%last_played%", "%title%"},
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
    const Wire wire = decode(serialiseSnapshot(built(
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
    REQUIRE(builder.fieldCount() == kSpineFieldCount + 2);

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
    CHECK(library.changes(0).outcome == DeltaOutcome::notBuilt);
    CHECK(library.apply({{0, {"a/", "1.mp3", "0"}}}) == 0);
}

TEST_CASE("installing a snapshot moves both generations and reports the columns asked for") {
    Library library;
    library.replace(built({"%artist%"}, {track("a/", "1.mp3", {"One"})}));

    const auto state = library.state();
    CHECK(state.ready);
    CHECK(state.structure == 1);
    CHECK(state.revision == 1);
    CHECK(state.trackCount == 1);
    CHECK(state.columns == std::vector<std::string>{"%artist%"});
}

TEST_CASE("a row whose values did not move leaves the revision alone") {
    Library library;
    library.replace(built({"%play_count%"}, {track("a/", "1.mp3", {"3"})}));

    CHECK(library.apply({{0, track("a/", "1.mp3", {"3"})}}) == 1);
    CHECK(library.state().revision == 1);
    CHECK(library.changes(1).delta.columns.empty());
}

TEST_CASE("a delta names only the columns that moved") {
    Library library;
    library.replace(built({"%title%", "%play_count%"}, {track("a/", "1.mp3", {"One", "3"}),
                                                        track("a/", "2.mp3", {"Two", "0"})}));

    CHECK(library.apply({{1, track("a/", "2.mp3", {"Two", "1"})}}) == 2);

    const auto changes = library.changes(1);
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
    CHECK(wire.header.at("since") == 1);
    CHECK(wire.header.at("revision") == 2);
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
        built({"%genre%"}, {track("a/", "1.mp3", {"Rock"}), track("a/", "2.mp3", {"Jazz"})}));

    // Rock stops being used, and its entry stays: a client already holds id 0.
    library.apply({{0, track("a/", "1.mp3", {"Ambient"})}});
    library.apply({{1, track("a/", "2.mp3", {"Ambient"})}});

    const auto changes = library.changes(1);
    REQUIRE(changes.outcome == DeltaOutcome::ok);
    REQUIRE(changes.delta.columns.size() == 1);

    const ColumnDelta& patch = changes.delta.columns.front();
    CHECK(patch.base == 2);
    CHECK(patch.appended == std::vector<std::string>{"Ambient"});
    CHECK(patch.ordinals == std::vector<uint32_t>{0, 1});
    CHECK(patch.ids == std::vector<uint32_t>{2, 2});

    // The same delta asked for one revision later carries the appends already sent.
    const auto later = library.changes(2);
    REQUIRE(later.delta.columns.size() == 1);
    CHECK(later.delta.columns.front().base == 3);
    CHECK(later.delta.columns.front().appended.empty());
}

TEST_CASE("a whole spine column moving is still a delta") {
    Library library;
    library.replace(built({"%title%"}, {track("old/", "1.mp3", {"One"})}));

    library.apply({{0, track("new/", "1.mp3", {"One"})}});

    const Wire wire = decode(serialiseDelta(library.changes(1).delta));
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
    library.replace(built({"%title%"}, {track("a/", "1.mp3", {"One"})}));

    const auto changes = library.changes(1);
    CHECK(changes.outcome == DeltaOutcome::ok);
    CHECK(changes.delta.columns.empty());
    CHECK(changes.delta.since == 1);
    CHECK(changes.delta.revision == 1);
}

TEST_CASE("adding or removing tracks moves the ordinals, so an older revision is refused") {
    Library library;
    library.replace(built({"%title%"}, {track("a/", "1.mp3", {"One"})}));
    library.apply({{0, track("a/", "1.mp3", {"Uno"})}});

    library.replace(
        built({"%title%"}, {track("a/", "1.mp3", {"Uno"}), track("a/", "2.mp3", {"Two"})}));

    CHECK(library.state().structure == 2);
    CHECK(library.changes(2).outcome == DeltaOutcome::structureChanged);
    CHECK(library.changes(1).outcome == DeltaOutcome::structureChanged);
    CHECK(library.changes(library.state().revision).outcome == DeltaOutcome::ok);
}

TEST_CASE("a revision this library never reached is refused rather than answered empty") {
    Library library;
    library.replace(built({"%title%"}, {track("a/", "1.mp3", {"One"})}));

    CHECK(library.changes(99).outcome == DeltaOutcome::revisionUnknown);
}

TEST_CASE("a client further behind than the retained window is told to export again") {
    Library library(3);
    library.replace(built({"%play_count%"}, {track("a/", "1.mp3", {"0"})}));

    for (int play = 1; play <= 5; ++play)
        library.apply({{0, track("a/", "1.mp3", {std::to_string(play)})}});

    REQUIRE(library.state().revision == 6);

    // Revisions 4, 5 and 6 are retained, so the oldest answerable client holds revision 3.
    CHECK(library.changes(3).outcome == DeltaOutcome::ok);
    CHECK(library.changes(2).outcome == DeltaOutcome::revisionTooOld);
    CHECK(library.changes(2).delta.columns.empty());
}

TEST_CASE("the oldest answerable client gets every append it missed") {
    Library library(3);
    library.replace(built({"%play_count%"}, {track("a/", "1.mp3", {"0"})}));

    for (int play = 1; play <= 5; ++play)
        library.apply({{0, track("a/", "1.mp3", {std::to_string(play)})}});

    const auto changes = library.changes(3);
    REQUIRE(changes.delta.columns.size() == 1);

    const ColumnDelta& patch = changes.delta.columns.front();
    CHECK(patch.base == 3);
    CHECK(patch.appended == std::vector<std::string>{"3", "4", "5"});
    CHECK(patch.ids == std::vector<uint32_t>{5});
}

// The comparison here stands in for foobar2000's own (CLAUDE.md, *Facts about the player*,
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
    CHECK(allDifferent({describe(DeltaOutcome::ok), describe(DeltaOutcome::notBuilt),
                        describe(DeltaOutcome::structureChanged),
                        describe(DeltaOutcome::revisionTooOld),
                        describe(DeltaOutcome::revisionUnknown)}));
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
