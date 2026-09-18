#include "third_party/doctest.h"

#include "core/playlists.h"

#include <algorithm>
#include <cstdint>
#include <optional>
#include <set>
#include <string>
#include <vector>

using namespace jean;

namespace {

constexpr char kAlbums[] = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";
constexpr char kSingles[] = "0c2f9d91-6c8a-4f1c-9a7f-2d3b5e7c1a80";
constexpr char kMixes[] = "b7e1c3a2-5d48-4f90-8c11-6a2e9f70d3b5";

struct Handed {
    std::set<uint64_t> structures;
    std::set<uint64_t> revisions;
};

Handed handedOutByOneRun() {
    PlaylistVersions versions;
    Handed handed;

    const auto record = [&handed](const PlaylistVersion& version) {
        handed.structures.insert(version.structure);
        handed.revisions.insert(version.revision);
    };

    record(versions.of(kAlbums));
    record(versions.of(kSingles));

    for (uint32_t change = 0; change < 8; ++change) {
        versions.rowsChanged(kAlbums, RowsChanged::added);
        versions.contentChanged(kSingles, {change});
        record(versions.of(kAlbums));
        record(versions.of(kSingles));
    }

    return handed;
}

std::vector<uint32_t> sorted(std::vector<uint32_t> positions) {
    std::sort(positions.begin(), positions.end());
    return positions;
}

bool shareAValue(const std::set<uint64_t>& left, const std::set<uint64_t>& right) {
    return std::any_of(left.begin(), left.end(),
                       [&right](uint64_t value) { return right.count(value) != 0; });
}

}  // namespace

TEST_CASE("every kind of row change moves the structure generation and leaves the revision") {
    PlaylistVersions versions;
    const PlaylistVersion before = versions.of(kAlbums);

    RowsChanged how = RowsChanged::added;
    SUBCASE("rows added") { how = RowsChanged::added; }
    SUBCASE("rows removed") { how = RowsChanged::removed; }
    SUBCASE("rows reordered") { how = RowsChanged::reordered; }
    SUBCASE("rows replaced") { how = RowsChanged::replaced; }

    versions.rowsChanged(kAlbums, how);

    const PlaylistVersion after = versions.of(kAlbums);
    CHECK(after.structure != before.structure);
    CHECK(after.revision == before.revision);
}

TEST_CASE("a row answering differently moves the content revision and leaves the structure") {
    PlaylistVersions versions;
    const PlaylistVersion before = versions.of(kAlbums);

    // A tag, a rating and a play count are one kind of change here, so they are one case.
    versions.contentChanged(kAlbums, {2});

    const PlaylistVersion once = versions.of(kAlbums);
    CHECK(once.revision != before.revision);
    CHECK(once.structure == before.structure);

    versions.contentChanged(kAlbums, {2});

    const PlaylistVersion twice = versions.of(kAlbums);
    CHECK(twice.revision != once.revision);
    CHECK(twice.structure == before.structure);
}

TEST_CASE("a content change naming no rows moves neither number") {
    PlaylistVersions versions;
    versions.rowsChanged(kAlbums, RowsChanged::added);
    const PlaylistVersion before = versions.of(kAlbums);

    versions.contentChanged(kAlbums, {});

    const PlaylistVersion after = versions.of(kAlbums);
    CHECK(after.structure == before.structure);
    CHECK(after.revision == before.revision);
}

TEST_CASE("neither number moves for a change to another playlist") {
    PlaylistVersions versions;
    const PlaylistVersion before = versions.of(kAlbums);

    versions.rowsChanged(kSingles, RowsChanged::replaced);
    CHECK(versions.of(kAlbums).structure == before.structure);
    CHECK(versions.of(kAlbums).revision == before.revision);

    versions.contentChanged(kSingles, {0, 1});
    CHECK(versions.of(kAlbums).structure == before.structure);
    CHECK(versions.of(kAlbums).revision == before.revision);
}

// Two instances stand for two runs of the component. A client holding a number from the run
// before must be told to read the playlist again, and it can only be told that if no number
// this run answers is one the last run answered, the numbers a playlist starts at included:
// tags, play counts and playlists themselves all change while the component is not running.
TEST_CASE("a run hands out no number the run before it handed out") {
    const Handed first = handedOutByOneRun();
    const Handed second = handedOutByOneRun();

    CHECK_FALSE(shareAValue(first.structures, second.structures));
    CHECK_FALSE(shareAValue(first.revisions, second.revisions));
}

TEST_CASE("a client catches up on every position that changed while it was away") {
    PlaylistVersions versions;
    const PlaylistVersion held = versions.of(kAlbums);

    versions.contentChanged(kAlbums, {4});
    versions.contentChanged(kAlbums, {1, 4});
    versions.contentChanged(kAlbums, {7});

    const ChangedSince changed = versions.changedSince(kAlbums, held.structure, held.revision);
    CHECK(changed.catchUp == DeltaOutcome::ok);
    CHECK(sorted(changed.positions) == std::vector<uint32_t>{1, 4, 7});
    CHECK(changed.revision == versions.of(kAlbums).revision);
}

TEST_CASE("a client at the current revision is told nothing changed rather than refused") {
    PlaylistVersions versions;
    versions.contentChanged(kAlbums, {4});

    const PlaylistVersion now = versions.of(kAlbums);
    const ChangedSince changed = versions.changedSince(kAlbums, now.structure, now.revision);
    CHECK(changed.catchUp == DeltaOutcome::ok);
    CHECK(changed.positions.empty());
    CHECK(changed.revision == now.revision);
}

TEST_CASE("a client further behind than the window is refused rather than answered short") {
    PlaylistVersions versions(3);
    const PlaylistVersion start = versions.of(kAlbums);

    for (uint32_t position = 1; position <= 5; ++position)
        versions.contentChanged(kAlbums, {position});

    CHECK(versions.changedSince(kAlbums, start.structure, start.revision + 2).catchUp ==
          DeltaOutcome::ok);

    const ChangedSince refused =
        versions.changedSince(kAlbums, start.structure, start.revision + 1);
    CHECK(refused.catchUp == DeltaOutcome::revisionTooOld);
    CHECK(refused.positions.empty());
}

TEST_CASE("the client furthest behind the window still answers gets every position it missed") {
    PlaylistVersions versions(3);
    const PlaylistVersion start = versions.of(kAlbums);

    for (uint32_t position = 1; position <= 5; ++position)
        versions.contentChanged(kAlbums, {position});

    const ChangedSince changed =
        versions.changedSince(kAlbums, start.structure, start.revision + 2);
    CHECK(sorted(changed.positions) == std::vector<uint32_t>{3, 4, 5});
    CHECK(changed.revision == start.revision + 5);
}

TEST_CASE("a structural change drops the window, so a client from before it reads the rows whole") {
    PlaylistVersions versions;
    const PlaylistVersion before = versions.of(kAlbums);

    versions.contentChanged(kAlbums, {2});
    versions.rowsChanged(kAlbums, RowsChanged::reordered);
    const PlaylistVersion after = versions.of(kAlbums);

    CHECK(versions.changedSince(kAlbums, before.structure, before.revision).catchUp ==
          DeltaOutcome::structureChanged);

    // A client that has already re-read the list holds the current structure generation with a
    // revision older than the reorder. Every position it kept names a different row now, so it
    // is refused the same way rather than handed a patch that would land on the wrong rows.
    const ChangedSince stale = versions.changedSince(kAlbums, after.structure, before.revision);
    CHECK(stale.catchUp == DeltaOutcome::structureChanged);
    CHECK(stale.positions.empty());

    CHECK(versions.changedSince(kAlbums, after.structure, after.revision).catchUp ==
          DeltaOutcome::ok);
}

// foobar2000 reports one track's change once per playlist holding it, each call carrying that
// playlist's own positions, so the fan-out is the player's and what arrives here is one call
// per playlist.
TEST_CASE("one track changing reaches every playlist holding it, with that playlist's own rows") {
    PlaylistVersions versions;
    const PlaylistVersion albums = versions.of(kAlbums);
    const PlaylistVersion singles = versions.of(kSingles);
    const PlaylistVersion mixes = versions.of(kMixes);

    versions.contentChanged(kAlbums, {12, 129});
    versions.contentChanged(kSingles, {4});

    const ChangedSince intoAlbums =
        versions.changedSince(kAlbums, albums.structure, albums.revision);
    CHECK(intoAlbums.catchUp == DeltaOutcome::ok);
    CHECK(sorted(intoAlbums.positions) == std::vector<uint32_t>{12, 129});

    const ChangedSince intoSingles =
        versions.changedSince(kSingles, singles.structure, singles.revision);
    CHECK(intoSingles.catchUp == DeltaOutcome::ok);
    CHECK(intoSingles.positions == std::vector<uint32_t>{4});

    CHECK(versions.of(kMixes).structure == mixes.structure);
    CHECK(versions.of(kMixes).revision == mixes.revision);
}

// A play count is the commonest change of all and no callback carries it, so the row a track
// leaves is recorded without waiting to be told. Only the playing playlist is: a location is
// all the player hands over, and the same track's other rows go unrecorded.
TEST_CASE("the row a track stops playing at is recorded though nothing announced a change") {
    PlaylistVersions versions;
    versions.playingRowChanged(PlayingLocation{kAlbums, 3});

    const PlaylistVersion playing = versions.of(kAlbums);
    const PlaylistVersion elsewhere = versions.of(kSingles);

    SUBCASE("the next track is in the same playlist") {
        versions.playingRowChanged(PlayingLocation{kAlbums, 4});
    }
    SUBCASE("the next track is in another playlist") {
        versions.playingRowChanged(PlayingLocation{kSingles, 0});
    }
    SUBCASE("playback stops") { versions.playingRowChanged(std::nullopt); }

    const ChangedSince changed =
        versions.changedSince(kAlbums, playing.structure, playing.revision);
    CHECK(changed.catchUp == DeltaOutcome::ok);
    CHECK(changed.positions == std::vector<uint32_t>{3});
    CHECK(versions.of(kAlbums).structure == playing.structure);

    CHECK(versions.of(kSingles).structure == elsewhere.structure);
    CHECK(versions.of(kSingles).revision == elsewhere.revision);
}

// The playing location is re-read after every edit to the playing playlist, so one play
// reports the same row many times. A revision moving for each would send every client watching
// that playlist back for changes each time, which is the trap
// `flag_on_items_modified_fromplayback` sets.
TEST_CASE("a row reported as still playing is one change, taken when it is left") {
    PlaylistVersions versions;
    const PlaylistVersion before = versions.of(kAlbums);

    versions.playingRowChanged(PlayingLocation{kAlbums, 3});
    versions.playingRowChanged(PlayingLocation{kAlbums, 3});
    versions.playingRowChanged(PlayingLocation{kAlbums, 3});
    CHECK(versions.of(kAlbums).revision == before.revision);

    versions.playingRowChanged(std::nullopt);
    CHECK(versions.of(kAlbums).revision == before.revision + 1);
    CHECK(versions.changedSince(kAlbums, before.structure, before.revision).positions ==
          std::vector<uint32_t>{3});
}

TEST_CASE("a structural change to one playlist leaves another's window alone") {
    PlaylistVersions versions;
    const PlaylistVersion albums = versions.of(kAlbums);

    versions.contentChanged(kAlbums, {3});
    versions.rowsChanged(kSingles, RowsChanged::added);
    versions.contentChanged(kSingles, {9});

    const ChangedSince changed = versions.changedSince(kAlbums, albums.structure, albums.revision);
    CHECK(changed.catchUp == DeltaOutcome::ok);
    CHECK(changed.positions == std::vector<uint32_t>{3});
}
