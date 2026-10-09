#include "third_party/doctest.h"

#include "support/eventually.h"

#include "core/playlists.h"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <thread>
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
                       [&right](uint64_t value) { return right.contains(value); });
}

constexpr uint32_t kRowsEach = 1000;

struct Watched {
    std::string id;
    uint32_t base;

    bool holds(uint32_t position) const { return position >= base && position < base + kRowsEach; }
};

struct Wrote {
    std::map<std::string, uint64_t> revisions;
    std::map<std::string, uint64_t> structures;
};

struct Strange {
    size_t positionsFromNowhere = 0;
    size_t refusalsCarryingPositions = 0;
    size_t numbersGoingBackwards = 0;
};

}  // namespace

TEST_CASE("every kind of row change moves the structure generation and leaves the revision") {
    PlaylistVersions versions;
    const PlaylistVersion before = versions.of(kAlbums);

    RowsChanged how = RowsChanged::added;
    SUBCASE("rows added") {
        how = RowsChanged::added;
    }
    SUBCASE("rows removed") {
        how = RowsChanged::removed;
    }
    SUBCASE("rows reordered") {
        how = RowsChanged::reordered;
    }
    SUBCASE("rows replaced") {
        how = RowsChanged::replaced;
    }

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
    SUBCASE("playback stops") {
        versions.playingRowChanged(std::nullopt);
    }

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

TEST_CASE("a playlist the player removes reads afterwards like one nothing ever touched") {
    PlaylistVersions versions;
    const PlaylistVersion held = versions.of(kAlbums);

    versions.contentChanged(kAlbums, {4});
    versions.rowsChanged(kAlbums, RowsChanged::added);
    versions.contentChanged(kAlbums, {1});

    versions.forget(kAlbums);

    const PlaylistVersion untouched = versions.of(kMixes);
    CHECK(versions.of(kAlbums).structure == untouched.structure);
    CHECK(versions.of(kAlbums).revision == untouched.revision);

    const ChangedSince changed = versions.changedSince(kAlbums, held.structure, held.revision);
    CHECK(changed.catchUp == DeltaOutcome::ok);
    CHECK(changed.positions.empty());
}

TEST_CASE("a playlist forgotten while it was playing takes no mark when playback moves on") {
    PlaylistVersions versions;
    versions.playingRowChanged(PlayingLocation{kAlbums, 3});

    versions.forget(kAlbums);
    versions.playingRowChanged(PlayingLocation{kSingles, 0});

    const PlaylistVersion untouched = versions.of(kMixes);
    CHECK(versions.of(kAlbums).revision == untouched.revision);
}

TEST_CASE("forgetting one playlist leaves another's window alone") {
    PlaylistVersions versions;
    const PlaylistVersion singles = versions.of(kSingles);

    versions.contentChanged(kAlbums, {3});
    versions.contentChanged(kSingles, {9});

    versions.forget(kAlbums);

    const ChangedSince changed =
        versions.changedSince(kSingles, singles.structure, singles.revision);
    CHECK(changed.catchUp == DeltaOutcome::ok);
    CHECK(changed.positions == std::vector<uint32_t>{9});
}

// The two cases below are the only ones in this file that drive PlaylistVersions from more than
// one thread. Without them, `--sanitize=thread` runs over an otherwise single-threaded suite and
// has nothing of its own to catch.

TEST_CASE("a client following a playlist while the player writes to it misses no changed row") {
    constexpr uint32_t kChanges = 1000;

    PlaylistVersions versions(kChanges + 1);
    const PlaylistVersion start = versions.of(kAlbums);

    std::atomic<bool> writing{true};
    std::set<uint32_t> caught;
    size_t refusals = 0;

    std::thread player([&versions, &writing] {
        for (uint32_t change = 0; change < kChanges; ++change) {
            versions.contentChanged(kAlbums, {change});
            versions.contentChanged(kSingles, {change});
        }
        writing.store(false);
    });

    std::atomic<bool> sawTheFirstWrite{false};
    std::thread connection([&versions, &writing, &caught, &refusals, &sawTheFirstWrite, start] {
        sawTheFirstWrite = jean::testing::eventually(
            [&versions, start] { return versions.of(kAlbums).revision > start.revision; });
        if (!sawTheFirstWrite)
            return;
        uint64_t cursor = start.revision;

        const auto catchUp = [&] {
            const ChangedSince changed = versions.changedSince(kAlbums, start.structure, cursor);
            if (changed.catchUp != DeltaOutcome::ok) {
                ++refusals;
                return;
            }
            caught.insert(changed.positions.begin(), changed.positions.end());
            cursor = changed.revision;
        };

        while (writing.load())
            catchUp();
        catchUp();
    });

    player.join();
    connection.join();
    REQUIRE(sawTheFirstWrite);

    size_t missed = 0;
    for (uint32_t change = 0; change < kChanges; ++change)
        missed += caught.contains(change) ? 0 : 1;

    CHECK(refusals == 0);
    CHECK(missed == 0);
    CHECK(caught.size() == kChanges);
}

TEST_CASE("an answer given while the player is writing carries only rows that playlist recorded") {
    constexpr uint32_t kChanges = 1000;
    constexpr uint32_t kChangesPerReorder = 16;

    const std::vector<Watched> watched{
        {kAlbums, kRowsEach}, {kSingles, 2 * kRowsEach}, {kMixes, 3 * kRowsEach}};

    PlaylistVersions versions;
    const PlaylistVersion start = versions.of(kAlbums);

    std::atomic<bool> writing{true};
    Wrote wrote;
    Strange strange;

    std::thread player([&versions, &writing, &wrote, &watched] {
        std::optional<PlayingLocation> playing;

        for (uint32_t change = 0; change < kChanges; ++change) {
            for (const Watched& playlist : watched) {
                versions.contentChanged(playlist.id, {playlist.base + (change % kRowsEach)});
                ++wrote.revisions[playlist.id];

                if (change % kChangesPerReorder == 0) {
                    versions.rowsChanged(playlist.id, RowsChanged::reordered);
                    ++wrote.structures[playlist.id];
                }
            }

            const PlayingLocation next{watched.front().id,
                                       watched.front().base + (change % kRowsEach)};
            if (playing)
                ++wrote.revisions[playing->playlistId];
            versions.playingRowChanged(next);
            playing = next;
        }

        writing.store(false);
    });

    std::thread connection([&versions, &writing, &strange, &watched] {
        struct Following {
            uint64_t structure = 0;
            uint64_t cursor = 0;
            uint64_t seenStructure = 0;
            uint64_t seenRevision = 0;
        };

        std::vector<Following> following;
        following.reserve(watched.size());
        for (const Watched& playlist : watched) {
            const PlaylistVersion now = versions.of(playlist.id);
            following.push_back({now.structure, now.revision, now.structure, now.revision});
        }

        const auto readOnce = [&](size_t index) {
            const Watched& playlist = watched[index];
            Following& state = following[index];

            const PlaylistVersion now = versions.of(playlist.id);
            if (now.structure < state.seenStructure || now.revision < state.seenRevision)
                ++strange.numbersGoingBackwards;
            state.seenStructure = now.structure;
            state.seenRevision = now.revision;

            const ChangedSince changed =
                versions.changedSince(playlist.id, state.structure, state.cursor);

            if (changed.catchUp != DeltaOutcome::ok) {
                if (!changed.positions.empty())
                    ++strange.refusalsCarryingPositions;

                const PlaylistVersion afresh = versions.of(playlist.id);
                state.structure = afresh.structure;
                state.cursor = afresh.revision;
                return;
            }

            if (changed.revision < state.cursor)
                ++strange.numbersGoingBackwards;
            strange.positionsFromNowhere += static_cast<size_t>(std::count_if(
                changed.positions.begin(), changed.positions.end(),
                [&playlist](uint32_t position) { return !playlist.holds(position); }));
            state.cursor = changed.revision;
        };

        const auto everyPlaylist = [&] {
            for (size_t index = 0; index < watched.size(); ++index)
                readOnce(index);
        };

        while (writing.load())
            everyPlaylist();
        everyPlaylist();
    });

    player.join();
    connection.join();

    CHECK(strange.positionsFromNowhere == 0);
    CHECK(strange.refusalsCarryingPositions == 0);
    CHECK(strange.numbersGoingBackwards == 0);

    for (const Watched& playlist : watched) {
        const PlaylistVersion now = versions.of(playlist.id);
        CHECK(now.revision == start.revision + wrote.revisions[playlist.id]);
        CHECK(now.structure == start.structure + wrote.structures[playlist.id]);
    }
}
