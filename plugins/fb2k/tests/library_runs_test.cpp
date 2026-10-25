#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_roles.h"
#include "core/library_runs.h"
#include "support/fixtures.h"
#include "support/question_library.h"
#include "support/runs_cases.h"
#include "support/summary_cases.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <exception>
#include <map>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kBasic[] = "basic: album with its artist";

LibraryRuns runsOf(const QuestionLibrary& library) {
    const Snapshot snapshot = library.snapshot();
    return libraryRunsOf(snapshot, rolesOf(snapshot, library));
}

LibraryRuns expectedOf(const RunsCase& runsCase) {
    return {runsCase.lengths, runsCase.covers, runsCase.untagged};
}

std::string shown(const std::vector<uint32_t>& values) {
    return json(values).dump();
}

struct Track {
    const char* album;
    const char* artist;
    const char* trackNumber;
};

LibraryRuns runsOfTracks(const std::vector<Track>& tracks) {
    std::vector<std::vector<std::string>> rows;
    for (size_t ordinal = 0; ordinal < tracks.size(); ++ordinal)
        rows.push_back({"Folder/", std::to_string(ordinal) + ".flac", "0", tracks[ordinal].album,
                        tracks[ordinal].artist, tracks[ordinal].trackNumber});
    const Snapshot snapshot = snapshotOf({"%album%", "%artist%", "%tracknumber%"}, rows);

    LibraryRoles roles;
    roles.album = kSpineFieldCount;
    roles.artist = kSpineFieldCount + 1;
    roles.trackNumber = kSpineFieldCount + 2;
    return libraryRunsOf(snapshot, roles);
}

struct Holding {
    QuestionLibrary questions = runsCase(kBasic).library;
    Library library;
    HeldLibraryRuns held;

    Holding() { library.replace(questions.snapshot()); }

    LibraryRuns ask(const std::map<std::string, std::string>& expressions) {
        return library.read([&](const Snapshot& snapshot) {
            const auto roles = rolesIn(snapshot, expressions);
            REQUIRE(roles.has_value());
            const auto runs = held.of(snapshot, *roles);
            REQUIRE(runs != nullptr);
            return *runs;
        });
    }

    LibraryRuns ask() { return ask(expressionsOf(questions)); }

    LibraryRuns drawnAfresh() {
        return library.read([&](const Snapshot& snapshot) {
            return libraryRunsOf(snapshot, rolesOf(snapshot, questions));
        });
    }

    void change(uint32_t ordinal, const char* role, const std::string& value) {
        const RowChange changed = questions.changed(ordinal, role, value);
        questions.rows.at(ordinal) = changed.values;
        library.apply({changed});
    }
};

}  // namespace

TEST_CASE("the runs cases hold one case for every library of the summary and question cases") {
    CHECK(runsCases().size() == casesIn("library_summary_cases.json").at("cases").size() +
                                    casesIn("library_questions_cases.json").at("cases").size());
}

TEST_CASE(
    "every case's library falls into the runs today's album grouping draws, cover for cover") {
    size_t checked = 0;
    for (const json& expected : runsCases()) {
        const std::string name = expected.at("name").get<std::string>();
        INFO("case: ", name);
        try {
            const RunsCase runsCase = runsCaseOf(expected);
            const LibraryRuns runs = runsOf(runsCase.library);
            INFO("lengths: ", shown(runs.lengths), " expected ", shown(runsCase.lengths));
            INFO("covers: ", shown(runs.covers), " expected ", shown(runsCase.covers));
            INFO("untagged: ", shown(runs.untagged), " expected ", shown(runsCase.untagged));
            CHECK(runs == expectedOf(runsCase));
        } catch (const std::exception& error) {
            FAIL_CHECK("threw: ", std::string(error.what()));
        }
        ++checked;
    }
    CHECK(checked == runsCases().size());
}

TEST_CASE("an untagged run's cover is its first ordinal, whatever its track numbers say") {
    const LibraryRuns runs = runsOfTracks({
        {"?", "Loner", "3"},
        {"?", "Loner", "1"},
        {"?", "Loner", "2"},
        {"Tagged", "Loner", "2"},
        {"Tagged", "Loner", "1"},
    });
    CHECK(runs.lengths == std::vector<uint32_t>{3, 2});
    // The tagged run beside it takes its lowest track number, so the untagged
    // run's first ordinal is a rule of its own rather than the same rule landing
    // there by chance.
    CHECK(runs.covers == std::vector<uint32_t>{0, 4});
    CHECK(runs.untagged == std::vector<uint32_t>{0});
}

TEST_CASE("untagged tracks break into a run per credited artist") {
    const LibraryRuns runs = runsOfTracks({
        {"?", "Loner", "1"},
        {"?", "Loner", "2"},
        {"?", "Drifter", "1"},
    });
    CHECK(runs.lengths == std::vector<uint32_t>{2, 1});
    CHECK(runs.covers == std::vector<uint32_t>{0, 2});
    CHECK(runs.untagged == std::vector<uint32_t>{0, 1});
}

TEST_CASE("a tagged run's cover is its album's cover track, outside the run where the album is") {
    const RunsCase acrossDirectories = runsCase("album-across-directories");
    const LibraryRuns runs = runsOf(acrossDirectories.library);

    // Disc 2 sorts first, disc 1 after it, and the bonus tracks of disc 1 come
    // after another artist's album of the same name: one album, two runs, one
    // cover track.
    REQUIRE(runs.lengths == std::vector<uint32_t>{6, 3, 2, 2, 4});
    CHECK(runs.covers == std::vector<uint32_t>{3, 6, 9, 3, 13});
}

TEST_CASE(
    "a credit of whitespace alone reads as nobody, so it shares a run with an unresolved one") {
    const RunsCase whitespace = runsCase("whitespace-only-tags");
    const LibraryRuns runs = runsOf(whitespace.library);

    CHECK(runs.lengths == std::vector<uint32_t>{4, 2, 4, 2});
    CHECK(runs.covers == std::vector<uint32_t>{0, 4, 6, 10});
}

TEST_CASE(
    "the runs' hash is the same for the same runs and moves when a length, a cover or a tag does") {
    const LibraryRuns runs{{3, 1, 2}, {0, 3, 4}, {}};
    const LibraryRuns same{{3, 1, 2}, {0, 3, 4}, {}};
    CHECK(runsHash(same) == runsHash(runs));

    struct Moved {
        const char* what;
        LibraryRuns runs;
    };
    const std::vector<Moved> moved{
        {"a cover", {{3, 1, 2}, {1, 3, 4}, {}}},
        {"a cover outside its run", {{3, 1, 2}, {0, 3, 0}, {}}},
        {"a boundary, the covers staying", {{2, 2, 2}, {0, 3, 4}, {}}},
        {"a run losing its tag, its length and cover staying", {{3, 1, 2}, {0, 3, 4}, {1}}},
        {"two runs trading places", {{1, 3, 2}, {3, 0, 4}, {}}},
        {"a run split in two", {{3, 1, 1, 1}, {0, 3, 4, 5}, {}}},
        {"no runs at all", {{}, {}, {}}},
    };
    for (const auto& change : moved) {
        INFO("moved: ", change.what);
        CHECK(runsHash(change.runs) != runsHash(runs));
    }
}

TEST_CASE("runs asked for twice at one snapshot are drawn once") {
    Holding holding;
    CHECK(holding.ask() == expectedOf(runsCase(kBasic)));
    CHECK(holding.ask() == expectedOf(runsCase(kBasic)));
    CHECK(holding.held.builds() == 1);
}

TEST_CASE("a play count moving in place draws no runs again") {
    Holding holding;
    holding.ask();

    holding.change(0, "playCount", "7");
    holding.change(5, "playCount", "9");
    REQUIRE(holding.library.state().revision != holding.library.state().structure);

    CHECK(holding.ask() == expectedOf(runsCase(kBasic)));
    CHECK(holding.held.builds() == 1);
}

TEST_CASE("a track number moving in place draws the runs again, with the cover it moved to") {
    Holding holding;
    holding.ask();

    holding.change(0, "trackNumber", "09");

    const LibraryRuns runs = holding.ask();
    CHECK(runs.lengths == runsCase(kBasic).lengths);
    CHECK(runs.covers.at(0) == 1);
    CHECK(runs == holding.drawnAfresh());
    CHECK(holding.held.builds() == 2);
}

TEST_CASE("an album tag moving in place draws the runs again") {
    Holding holding;
    holding.ask();

    holding.change(3, "album", "Jessico");

    const LibraryRuns runs = holding.ask();
    CHECK(runs.lengths.at(0) == 4);
    CHECK(runs == holding.drawnAfresh());
    CHECK(holding.held.builds() == 2);
}

TEST_CASE("an artist credit moving in place draws the runs again") {
    Holding holding;
    holding.ask();

    holding.change(2, "albumArtist", "Somebody Else");

    const LibraryRuns runs = holding.ask();
    CHECK(runs.lengths.at(0) == 2);
    CHECK(runs == holding.drawnAfresh());
    CHECK(holding.held.builds() == 2);
}

TEST_CASE("a structure move draws the runs again though no column counted a change") {
    Holding holding;
    holding.ask();

    std::vector<std::string> added = holding.questions.rows.back();
    added.at(0) = "Radiohead/Kid A/";
    added.at(holding.questions.columnOf("album")) = "Kid A";
    holding.questions.rows.push_back(added);
    holding.library.replace(holding.questions.snapshot());

    const LibraryRuns runs = holding.ask();
    CHECK(runs.lengths.size() == runsCase(kBasic).lengths.size() + 1);
    CHECK(runs == holding.drawnAfresh());
}

TEST_CASE("runs for two role sets asked for in turn are each drawn once") {
    Holding holding;
    const auto usual = expressionsOf(holding.questions);
    auto byTitle = usual;
    byTitle.at("album") = byTitle.at("title");

    const LibraryRuns first = holding.ask(usual);
    const LibraryRuns other = holding.ask(byTitle);
    CHECK(other != first);
    CHECK(holding.ask(usual) == first);
    CHECK(holding.ask(byTitle) == other);
    CHECK(holding.held.builds() == 2);
}

TEST_CASE("a third role set's runs leave the two before it held no longer than the newer") {
    Holding holding;
    const auto usual = expressionsOf(holding.questions);
    auto byTitle = usual;
    byTitle.at("album") = byTitle.at("title");
    auto byArtist = usual;
    byArtist.at("album") = byArtist.at("artist");

    holding.ask(usual);
    holding.ask(byTitle);
    holding.ask(byArtist);
    REQUIRE(holding.held.builds() == 3);

    holding.ask(byTitle);
    CHECK(holding.held.builds() == 3);

    holding.ask(usual);
    CHECK(holding.held.builds() == 4);
}
