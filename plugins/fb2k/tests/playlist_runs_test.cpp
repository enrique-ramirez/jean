#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_roles.h"
#include "core/library_summary.h"
#include "core/playlist_runs.h"
#include "support/fixtures.h"
#include "support/runs_cases.h"
#include "support/summary_cases.h"
#include "support/summary_library.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <exception>
#include <map>
#include <optional>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kAlbum[] = "%album%";
constexpr char kAlbumArtist[] = "%album artist%";
constexpr char kArtist[] = "%artist%";
constexpr char kDisc[] = "%discnumber%";
constexpr char kPlays[] = "%play_count%";
constexpr char kLocalPlays[] = "%jean_plays%";
constexpr char kSeconds[] = "%length_seconds%";
constexpr char kYear[] = "$year(%date%)";
constexpr char kTitle[] = "%title%";

const std::vector<std::string>& declared() {
    static const std::vector<std::string> columns{kAlbum,      kAlbumArtist, kArtist, kDisc, kPlays,
                                                  kLocalPlays, kSeconds,     kYear,   kTitle};
    return columns;
}

const std::map<std::string, std::string>& roleExpressions() {
    static const std::map<std::string, std::string> roles{
        {"album", kAlbum},      {"albumArtist", kAlbumArtist},
        {"artist", kArtist},    {"discNumber", kDisc},
        {"playCount", kPlays},  {"playCountLocal", kLocalPlays},
        {"duration", kSeconds}, {"year", kYear},
        {"title", kTitle},
    };
    return roles;
}

// A row's own tags, in the declared columns' order. kUnresolved is what foobar2000 answers for a
// field the track does not carry.
struct Tags {
    const char* album = kUnresolved;
    const char* albumArtist = kUnresolved;
    const char* artist = kUnresolved;
    const char* plays = kUnresolved;
    const char* localPlays = kUnresolved;
    const char* seconds = kUnresolved;
    const char* year = kUnresolved;
    const char* disc = "1";
    const char* title = "A Song";
};

std::map<std::string, std::string> fieldsOf(const Tags& tags) {
    return {{kAlbum, tags.album},     {kAlbumArtist, tags.albumArtist},
            {kArtist, tags.artist},   {kDisc, tags.disc},
            {kPlays, tags.plays},     {kLocalPlays, tags.localPlays},
            {kSeconds, tags.seconds}, {kYear, tags.year},
            {kTitle, tags.title}};
}

constexpr uint32_t kEverything = 0;
constexpr uint32_t kKidA = 1;
constexpr uint32_t kPackt = 2;
constexpr uint32_t kPyramid = 3;
constexpr uint32_t kDemo = 4;
constexpr uint32_t kSafe = 5;

const std::vector<Tags>& libraryTags() {
    static const std::vector<Tags> tracks{
        {.album = "Kid A",
         .albumArtist = "Radiohead",
         .artist = "Radiohead",
         .plays = "3",
         .seconds = "200",
         .year = "2000"},
        {.album = "Kid A",
         .albumArtist = "Radiohead",
         .artist = "Radiohead",
         .plays = "5",
         .seconds = "300",
         .year = "2000"},
        {.album = "Amnesiac",
         .albumArtist = "Radiohead",
         .artist = "Radiohead",
         .plays = "2",
         .seconds = "250",
         .year = "2001"},
        {.album = "Amnesiac",
         .albumArtist = "Radiohead",
         .artist = "Radiohead",
         .plays = "0",
         .seconds = "240",
         .year = "2001"},
        {.artist = "Loner", .plays = "1", .seconds = "100"},
        {.album = "Blue Lines",
         .artist = "Massive Attack",
         .plays = "4",
         .localPlays = "6",
         .seconds = "280",
         .year = "1991"},
        {.album = "Mezzanine",
         .albumArtist = "Massive Attack",
         .artist = "Massive Attack",
         .plays = "50",
         .seconds = "330",
         .year = "1998"},
    };
    return tracks;
}

Snapshot librarySnapshot() {
    std::vector<std::vector<std::string>> rows;
    for (size_t ordinal = 0; ordinal < libraryTags().size(); ++ordinal) {
        std::vector<std::string> row{"Music/", std::to_string(ordinal) + ".flac", "0"};
        const auto fields = fieldsOf(libraryTags()[ordinal]);
        for (const std::string& column : declared())
            row.push_back(fields.at(column));
        rows.push_back(std::move(row));
    }
    return snapshotOf(declared(), rows);
}

LibraryRoles shelfRoles(const Snapshot& snapshot) {
    const auto roles = rolesIn(snapshot, roleExpressions());
    REQUIRE(roles.has_value());
    return *roles;
}

PlaylistTrack inLibrary(uint32_t ordinal) {
    return {ordinal, {}};
}

PlaylistTrack outsideRow(const std::vector<std::string>& asked,
                         const std::map<std::string, std::string>& fields) {
    PlaylistTrack row;
    for (const std::string& column : asked) {
        const auto found = fields.find(column);
        row.columns.push_back(found == fields.end() ? std::string(kUnresolved) : found->second);
    }
    return row;
}

struct Shelf {
    Snapshot snapshot = librarySnapshot();
    LibraryRoles roles = shelfRoles(snapshot);

    PlaylistTrack outside(const Tags& tags) const {
        return outsideRow(playlistRunsColumns(snapshot, roles), fieldsOf(tags));
    }

    PlaylistRuns runsOf(const std::vector<PlaylistTrack>& rows) const {
        return playlistRunsOf(snapshot, roles, rows);
    }

    std::vector<uint32_t> lengthsOf(const std::vector<PlaylistTrack>& rows) const {
        return runsOf(rows).lengths;
    }
};

std::string shown(const std::vector<uint32_t>& values) {
    return json(values).dump();
}

PlaylistTrack copiedOutside(const Snapshot& snapshot, const LibraryRoles& roles, uint32_t ordinal) {
    std::map<std::string, std::string> fields;
    for (const Column& column : snapshot.columns)
        fields.emplace(column.name, column.dictionary.values[column.ids[ordinal]]);
    return outsideRow(playlistRunsColumns(snapshot, roles), fields);
}

struct CaseShelf {
    Snapshot snapshot;
    LibraryRoles roles;
};

CaseShelf shelfOf(const RunsCase& runsCase) {
    Snapshot snapshot = runsCase.library.snapshot();
    const LibraryRoles roles = rolesOf(snapshot, runsCase.library);
    return {std::move(snapshot), roles};
}

std::optional<double> optionalOf(const json& value) {
    return value.is_null() ? std::nullopt : std::optional<double>(value.get<double>());
}

PlaylistTracksRead readAt(uint64_t structure, uint64_t revision, std::vector<PlaylistTrack> rows) {
    PlaylistTracksRead read;
    read.structure = structure;
    read.revision = revision;
    read.rows = std::move(rows);
    return read;
}

constexpr char kRoadTrip[] = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";
constexpr char kSundays[] = "22222222-2222-2222-2222-222222222222";

constexpr uint64_t kStructure = 9204739866101318923ULL;
constexpr uint64_t kRevision = 9204739866101318977ULL;

}  // namespace

TEST_CASE(
    "a library row and a row outside the library of one album and credited artist are one "
    "run") {
    const Shelf shelf;

    struct Variant {
        const char* what;
        Tags tags;
    };
    const std::vector<Variant> variants{
        {"the same tags", {.album = "Kid A", .albumArtist = "Radiohead", .artist = "Radiohead"}},
        {"the album in another case and spacing",
         {.album = "  kid   A ", .albumArtist = "Radiohead", .artist = "Radiohead"}},
        {"no album artist, so the track artist is the credit",
         {.album = "Kid A", .artist = "Radiohead"}},
        {"the album artist credited over a track artist of its own",
         {.album = "Kid A", .albumArtist = "Radiohead", .artist = "Thom Yorke"}},
    };
    for (const auto& variant : variants) {
        INFO("outside row: ", variant.what);
        const auto lengths = shelf.lengthsOf(
            {inLibrary(kEverything), shelf.outside(variant.tags), inLibrary(kKidA)});
        INFO("lengths: ", shown(lengths));
        CHECK(lengths == std::vector<uint32_t>{3});
    }
}

TEST_CASE("rows outside the library of two albums, or of one album by two artists, are two runs") {
    const Shelf shelf;

    CHECK(shelf.lengthsOf({shelf.outside({.album = "Kid A", .artist = "Radiohead"}),
                           shelf.outside({.album = "Amnesiac", .artist = "Radiohead"})}) ==
          std::vector<uint32_t>{1, 1});
    CHECK(shelf.lengthsOf({shelf.outside({.album = "Kid A", .artist = "Radiohead"}),
                           shelf.outside({.album = "Kid A", .artist = "Somebody Else"})}) ==
          std::vector<uint32_t>{1, 1});
}

TEST_CASE("an untagged row outside the library is a run of its own between two of an album") {
    const Shelf shelf;

    CHECK(shelf.lengthsOf({inLibrary(kEverything), shelf.outside({.artist = "Radiohead"}),
                           inLibrary(kKidA)}) == std::vector<uint32_t>{1, 1, 1});
}

TEST_CASE("an untagged row outside the library shares a run with an untagged one of its artist") {
    const Shelf shelf;

    CHECK(shelf.lengthsOf({inLibrary(kDemo), shelf.outside({.artist = "Loner"})}) ==
          std::vector<uint32_t>{2});
    CHECK(shelf.lengthsOf({inLibrary(kDemo), shelf.outside({.artist = "Drifter"})}) ==
          std::vector<uint32_t>{1, 1});
}

TEST_CASE(
    "an album split by a row outside the library of another album is two runs and one "
    "album") {
    const Shelf shelf;

    const auto runs = shelf.runsOf(
        {inLibrary(kEverything),
         shelf.outside({.album = "Amnesiac", .albumArtist = "Radiohead", .artist = "Radiohead"}),
         inLibrary(kKidA)});
    CHECK(runs.lengths == std::vector<uint32_t>{1, 1, 1});
    CHECK(runs.albumCount == 2);
}

// A playlist is in whatever order somebody dragged it into, so neighbouring ordinals may be two
// albums and one album's ordinals may arrive in any order.
TEST_CASE("library rows fall into runs by album and credit, whatever order their ordinals take") {
    const Shelf shelf;

    CHECK(shelf.lengthsOf({inLibrary(kPackt), inLibrary(kKidA), inLibrary(kEverything),
                           inLibrary(kPyramid), inLibrary(kSafe)}) ==
          std::vector<uint32_t>{1, 2, 1, 1});
    CHECK(shelf.lengthsOf({inLibrary(kKidA), inLibrary(kPackt)}) == std::vector<uint32_t>{1, 1});
}

TEST_CASE("a credit of whitespace alone on a row outside the library is nobody's") {
    const Shelf shelf;

    CHECK(shelf.lengthsOf({shelf.outside({.album = "Untitled", .albumArtist = "  ", .artist = " "}),
                           shelf.outside({.album = "Untitled"})}) == std::vector<uint32_t>{2});
    CHECK(shelf.lengthsOf({shelf.outside({.album = "Untitled", .albumArtist = "  "}),
                           shelf.outside({.album = "Untitled", .artist = "Somebody"})}) ==
          std::vector<uint32_t>{1, 1});
}

TEST_CASE(
    "the most plays are the highest count of any row in the playlist, in the library or "
    "outside it") {
    const Shelf shelf;

    struct Played {
        const char* what;
        std::vector<PlaylistTrack> rows;
        double mostPlays;
    };
    const std::vector<Played> cases{
        {"a row outside the library played most",
         {inLibrary(kEverything), inLibrary(kKidA), shelf.outside({.plays = "9"})},
         9},
        {"a library row played most",
         {inLibrary(kEverything), shelf.outside({.plays = "2"}), inLibrary(kKidA)},
         5},
        {"a library row whose local count is the higher", {inLibrary(kSafe)}, 6},
        {"a row outside the library whose local count is the higher",
         {shelf.outside({.plays = "1", .localPlays = "8"})},
         8},
        {"the library's most played track left out", {inLibrary(kEverything)}, 3},
        {"nothing played", {inLibrary(kPyramid), shelf.outside({})}, 0},
    };
    for (const auto& played : cases) {
        INFO("playlist: ", played.what);
        CHECK(shelf.runsOf(played.rows).mostPlays == played.mostPlays);
    }
}

TEST_CASE("the figures count every row once, a track held twice twice, in the library or not") {
    const Shelf shelf;

    const auto runs = shelf.runsOf({
        inLibrary(kEverything),
        inLibrary(kKidA),
        shelf.outside({.album = "Kid A",
                       .albumArtist = "Radiohead",
                       .artist = "Radiohead",
                       .seconds = "210",
                       .year = "2003"}),
        inLibrary(kSafe),
        shelf.outside({.artist = "Loner", .seconds = "60.5"}),
        inLibrary(kEverything),
    });

    CHECK(runs.trackCount == 6);
    CHECK(runs.seconds == doctest::Approx(200 + 300 + 210 + 280 + 60.5 + 200));
    CHECK(runs.albumCount == 2);
    CHECK(runs.earliestYear == 1991);
    CHECK(runs.latestYear == 2003);
}

// library_summary.cpp reads a year at or before 1000 as none, which is how a `0000` date reads.
TEST_CASE("a year at or before 1000 is no year, and a playlist with none has no years") {
    const Shelf shelf;

    const auto none = shelf.runsOf(
        {shelf.outside({.year = "1000"}), shelf.outside({.year = "0"}), inLibrary(kDemo)});
    CHECK(none.earliestYear == std::nullopt);
    CHECK(none.latestYear == std::nullopt);

    const auto first = shelf.runsOf({shelf.outside({.year = "1001"}), inLibrary(kDemo)});
    CHECK(first.earliestYear == 1001);
    CHECK(first.latestYear == 1001);
}

TEST_CASE("an empty playlist has no runs, no plays, no figures and no years") {
    const Shelf shelf;

    const auto runs = shelf.runsOf({});
    CHECK(runs.lengths.empty());
    CHECK(runs.mostPlays == 0);
    CHECK(runs.albumCount == 0);
    CHECK(runs.trackCount == 0);
    CHECK(runs.seconds == 0);
    CHECK(runs.earliestYear == std::nullopt);
    CHECK(runs.latestYear == std::nullopt);
}

TEST_CASE("a playlist holding a case's whole library in ordinal order has the case's runs") {
    size_t checked = 0;
    for (const json& expected : runsCases()) {
        const std::string name = expected.at("name").get<std::string>();
        INFO("case: ", name);
        try {
            const RunsCase runsCase = runsCaseOf(expected);
            const CaseShelf shelf = shelfOf(runsCase);

            std::vector<PlaylistTrack> rows;
            rows.reserve(shelf.snapshot.trackCount());
            for (uint32_t ordinal = 0; ordinal < shelf.snapshot.trackCount(); ++ordinal)
                rows.push_back(inLibrary(ordinal));

            const auto lengths = playlistRunsOf(shelf.snapshot, shelf.roles, rows).lengths;
            INFO("lengths: ", shown(lengths), " expected ", shown(runsCase.lengths));
            CHECK(lengths == runsCase.lengths);
        } catch (const std::exception& error) {
            FAIL_CHECK("threw: ", std::string(error.what()));
        }
        ++checked;
    }
    CHECK(checked == runsCases().size());
}

TEST_CASE("a case's whole library as rows outside it, or half outside, has the case's runs") {
    for (const json& expected : runsCases()) {
        const std::string name = expected.at("name").get<std::string>();
        INFO("case: ", name);
        try {
            const RunsCase runsCase = runsCaseOf(expected);
            const CaseShelf shelf = shelfOf(runsCase);

            std::vector<PlaylistTrack> outside;
            std::vector<PlaylistTrack> alternating;
            for (uint32_t ordinal = 0; ordinal < shelf.snapshot.trackCount(); ++ordinal) {
                const auto copy = copiedOutside(shelf.snapshot, shelf.roles, ordinal);
                outside.push_back(copy);
                alternating.push_back(ordinal % 2 == 0 ? copy : inLibrary(ordinal));
            }

            const auto allOutside = playlistRunsOf(shelf.snapshot, shelf.roles, outside).lengths;
            INFO("outside: ", shown(allOutside), " expected ", shown(runsCase.lengths));
            CHECK(allOutside == runsCase.lengths);

            const auto halfOutside =
                playlistRunsOf(shelf.snapshot, shelf.roles, alternating).lengths;
            INFO("half outside: ", shown(halfOutside));
            CHECK(halfOutside == runsCase.lengths);
        } catch (const std::exception& error) {
            FAIL_CHECK("threw: ", std::string(error.what()));
        }
    }
}

TEST_CASE(
    "over a case's whole library the figures are the summary's and the most plays its top "
    "track's") {
    for (const json& expected : runsCases()) {
        const std::string name = expected.at("name").get<std::string>();
        INFO("case: ", name);
        try {
            const RunsCase runsCase = runsCaseOf(expected);
            const CaseShelf shelf = shelfOf(runsCase);

            std::vector<PlaylistTrack> rows;
            rows.reserve(shelf.snapshot.trackCount());
            for (uint32_t ordinal = 0; ordinal < shelf.snapshot.trackCount(); ++ordinal)
                rows.push_back(ordinal % 3 == 0
                                   ? copiedOutside(shelf.snapshot, shelf.roles, ordinal)
                                   : inLibrary(ordinal));
            const auto runs = playlistRunsOf(shelf.snapshot, shelf.roles, rows);

            const auto summary = json::parse(summariseLibrary(
                shelf.snapshot, shelf.roles, localNoon(kSummaryDate), localTimeOn(kSummaryDate)));
            CHECK(runs.albumCount == summary.at("albumCount").get<size_t>());
            CHECK(runs.trackCount == summary.at("trackCount").get<size_t>());
            CHECK(runs.seconds == doctest::Approx(summary.at("seconds").get<double>()));
            CHECK(runs.earliestYear == optionalOf(summary.at("earliestYear")));
            CHECK(runs.latestYear == optionalOf(summary.at("latestYear")));

            const json& top = summary.at("topTracks");
            CHECK(runs.mostPlays == (top.empty() ? 0.0 : top.at(0).at("plays").get<double>()));
        } catch (const std::exception& error) {
            FAIL_CHECK("threw: ", std::string(error.what()));
        }
    }
}

TEST_CASE("the runs' hash is the same for the same answer and moves with any part of it") {
    const PlaylistRuns runs{{3, 1, 2}, 9, 2, 6, 1250.5, 1991, 2003};
    const PlaylistRuns same{{3, 1, 2}, 9, 2, 6, 1250.5, 1991, 2003};
    CHECK(playlistRunsHash(same) == playlistRunsHash(runs));

    struct Moved {
        const char* what;
        PlaylistRuns runs;
    };
    const std::vector<Moved> moved{
        {"a boundary", {{2, 2, 2}, 9, 2, 6, 1250.5, 1991, 2003}},
        {"a run split in two", {{3, 1, 1, 1}, 9, 2, 6, 1250.5, 1991, 2003}},
        {"no runs at all", {{}, 9, 2, 6, 1250.5, 1991, 2003}},
        {"the most plays", {{3, 1, 2}, 10, 2, 6, 1250.5, 1991, 2003}},
        {"the album count", {{3, 1, 2}, 9, 3, 6, 1250.5, 1991, 2003}},
        {"the track count", {{3, 1, 2}, 9, 2, 7, 1250.5, 1991, 2003}},
        {"the seconds", {{3, 1, 2}, 9, 2, 6, 1251, 1991, 2003}},
        {"the earliest year", {{3, 1, 2}, 9, 2, 6, 1250.5, 1990, 2003}},
        {"the latest year gone", {{3, 1, 2}, 9, 2, 6, 1250.5, 1991, std::nullopt}},
        {"both years gone", {{3, 1, 2}, 9, 2, 6, 1250.5, std::nullopt, std::nullopt}},
    };
    for (const auto& change : moved) {
        INFO("moved: ", change.what);
        CHECK(playlistRunsHash(change.runs) != playlistRunsHash(runs));
    }
}

TEST_CASE("a playlist asked for twice at one pair is drawn once") {
    const Shelf shelf;
    HeldPlaylistRuns held;
    const auto read = readAt(kStructure, kRevision, {inLibrary(kEverything), inLibrary(kKidA)});

    const auto first = held.of(kRoadTrip, read, shelf.snapshot, shelf.roles);
    const auto second = held.of(kRoadTrip, read, shelf.snapshot, shelf.roles);
    REQUIRE(first != nullptr);
    REQUIRE(second != nullptr);
    CHECK(*first == shelf.runsOf(read.rows));
    CHECK(*second == *first);
    CHECK(held.builds() == 1);
}

TEST_CASE("a playlist's revision moving draws its runs again from the rows it now holds") {
    const Shelf shelf;
    HeldPlaylistRuns held;
    held.of(kRoadTrip, readAt(kStructure, kRevision, {shelf.outside({.plays = "1"})}),
            shelf.snapshot, shelf.roles);

    const auto retagged = readAt(kStructure, kRevision + 1, {shelf.outside({.plays = "7"})});
    const auto runs = held.of(kRoadTrip, retagged, shelf.snapshot, shelf.roles);
    REQUIRE(runs != nullptr);
    CHECK(runs->mostPlays == 7);
    CHECK(held.builds() == 2);
}

TEST_CASE("two playlists at the same pair are each answered their own runs") {
    const Shelf shelf;
    HeldPlaylistRuns held;

    const auto roadTrip = held.of(
        kRoadTrip, readAt(kStructure, kRevision, {inLibrary(kEverything), inLibrary(kKidA)}),
        shelf.snapshot, shelf.roles);
    const auto sundays = held.of(
        kSundays, readAt(kStructure, kRevision, {inLibrary(kEverything), inLibrary(kPackt)}),
        shelf.snapshot, shelf.roles);
    REQUIRE(roadTrip != nullptr);
    REQUIRE(sundays != nullptr);
    CHECK(roadTrip->lengths == std::vector<uint32_t>{2});
    CHECK(sundays->lengths == std::vector<uint32_t>{1, 1});

    const auto again = held.of(
        kRoadTrip, readAt(kStructure, kRevision, {inLibrary(kEverything), inLibrary(kKidA)}),
        shelf.snapshot, shelf.roles);
    REQUIRE(again != nullptr);
    CHECK(again->lengths == std::vector<uint32_t>{2});
}

TEST_CASE("a library row's count moving under a playlist that did not move draws its runs again") {
    Library library;
    library.replace(librarySnapshot());
    HeldPlaylistRuns held;
    const auto read = readAt(kStructure, kRevision, {inLibrary(kEverything), inLibrary(kKidA)});

    const auto ask = [&] {
        return library.read([&](const Snapshot& snapshot) {
            const auto runs = held.of(kRoadTrip, read, snapshot, shelfRoles(snapshot));
            REQUIRE(runs != nullptr);
            return *runs;
        });
    };
    REQUIRE(ask().mostPlays == 5);

    std::vector<std::string> played{"Music/", std::to_string(kEverything) + ".flac", "0"};
    Tags tags = libraryTags()[kEverything];
    tags.plays = "12";
    const auto fields = fieldsOf(tags);
    for (const std::string& column : declared())
        played.push_back(fields.at(column));
    library.apply({RowChange{kEverything, played}});

    CHECK(ask().mostPlays == 12);
}
