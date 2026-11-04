#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_questions.h"
#include "core/library_roles.h"
#include "core/ordinal_sets.h"
#include "core/selection.h"
#include "support/cover_library.h"
#include "support/fixtures.h"
#include "support/question_library.h"
#include "support/summary_cases.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iterator>
#include <latch>
#include <map>
#include <optional>
#include <ranges>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

const json& questionCases() {
    return casesIn("library_questions_cases.json").at("cases");
}

const json& namedCase(const std::string_view name) {
    const json& cases = questionCases();
    const auto found = std::find_if(cases.begin(), cases.end(), [name](const json& questionCase) {
        return questionCase.at("name").get_ref<const std::string&>() == name;
    });
    REQUIRE_MESSAGE(found != cases.end(), "the cases file holds no case named ", std::string(name));
    return *found;
}

struct CaseLibrary {
    std::vector<std::string> declared;
    std::vector<std::vector<std::string>> rows;
    LibraryRoles roles;
};

CaseLibrary libraryOf(const json& questionCase) {
    const json& columns = questionCase.at("columns");

    CaseLibrary library;
    std::vector<const json*> values;
    for (const RoleName& role : std::views::reverse(kRoleNames)) {
        if (!columns.contains(role.name))
            continue;
        library.roles.*role.field = kSpineFieldCount + library.declared.size();
        library.declared.push_back(std::string("%") + role.name + "%");
        values.push_back(&columns.at(role.name));
    }

    const json& directory = questionCase.at("directory");
    library.rows.reserve(directory.size());
    for (size_t ordinal = 0; ordinal < directory.size(); ++ordinal) {
        std::vector<std::string> row{directory.at(ordinal).get<std::string>(),
                                     questionCase.at("filename").at(ordinal).get<std::string>(),
                                     questionCase.at("subsong").at(ordinal).get<std::string>()};
        for (const json* column : values)
            row.push_back(column->at(ordinal).get<std::string>());
        library.rows.push_back(std::move(row));
    }
    return library;
}

void addColumn(CaseLibrary& library, const RoleField field, const std::string& expression,
               const std::string& value) {
    library.roles.*field = kSpineFieldCount + library.declared.size();
    library.declared.push_back(expression);
    for (auto& row : library.rows)
        row.push_back(value);
}

size_t fieldOf(const CaseLibrary& library, const RoleField field) {
    const auto column = library.roles.*field;
    REQUIRE(column.has_value());
    return *column;
}

Snapshot snapshotAt(const CaseLibrary& library, const json& questionCase) {
    Snapshot snapshot = snapshotOf(library.declared, library.rows);
    snapshot.structure = questionCase.at("structure").get<uint64_t>();
    snapshot.revision = questionCase.at("revision").get<uint64_t>();
    return snapshot;
}

json ask(LibraryQuestions& questions, const Snapshot& snapshot, const LibraryRoles& roles,
         const json& question) {
    const std::string& kind = question.at("kind").get_ref<const std::string&>();
    if (kind == "search")
        return questions.search(snapshot, roles, question.at("query").get_ref<const std::string&>(),
                                question.at("limit").get<size_t>(),
                                question.at("entityLimit").get<size_t>(),
                                question.at("splitsCredits").get<bool>());
    const std::string& name = question.at("name").get_ref<const std::string&>();
    if (kind == "album") {
        const std::optional<std::string> by =
            question.contains("by") ? std::optional(question.at("by").get<std::string>())
                                    : std::nullopt;
        return questions.album(snapshot, roles, name, by);
    }
    if (kind == "artist")
        return questions.artist(snapshot, roles, name, question.at("splitsCredits").get<bool>());
    REQUIRE(kind == "genre");
    // NOLINTNEXTLINE(readability-static-accessed-through-instance)
    return questions.genre(snapshot, roles, name);
}

std::optional<std::vector<uint32_t>> setIn(const json& document, const size_t trackCount) {
    const SelectionResult decoded = decodeSelection(document, trackCount);
    if (!decoded.ok())
        return std::nullopt;
    return decoded.ordinals;
}

bool isSet(const std::string& key) {
    return key == "refs" || key == "own" || key == "shared" || key == "guest" || key == "matched";
}

void checkAnswer(const json& sent, const json& expected, const size_t trackCount) {
    const json answer = withoutSetSummaries(sent, expected);
    INFO("answer: ", answer.dump());
    INFO("expected: ", expected.dump());
    REQUIRE(answer.is_object());
    CHECK(answer.size() == expected.size());
    for (const auto& [key, value] : expected.items()) {
        INFO("key: ", key);
        if (!answer.contains(key)) {
            FAIL_CHECK("missing");
            continue;
        }
        if (isSet(key) && value.is_null()) {
            CHECK(answer.at(key).is_null());
        } else if (isSet(key)) {
            const auto ordinals = value.get<std::vector<uint32_t>>();
            CHECK(setIn(answer.at(key), trackCount) == std::optional(ordinals));
            CHECK(answer.at(key) == ordinalSetDocument(ordinals, trackCount));
        } else {
            CHECK(answer.at(key) == value);
        }
    }
}

std::vector<uint32_t> refsOf(const json& answer, const size_t trackCount) {
    REQUIRE(answer.contains("refs"));
    const auto refs = setIn(answer.at("refs"), trackCount);
    REQUIRE(refs.has_value());
    return *refs;
}

json withoutPair(json answer) {
    answer.erase("structure");
    answer.erase("revision");
    return answer;
}

constexpr char kBasicAlbum[] = "basic: album with its artist";
constexpr char kAlbum[] = "Jessico";
constexpr char kArtist[] = "Babasónicos";
constexpr char kOtherArtist[] = "Brand New";
constexpr char kGenre[] = "Rock En Español";
constexpr char kSearched[] = "jessico";
constexpr size_t kLimit = 8;
constexpr size_t kEntityLimit = 3;
constexpr uint32_t kRetaggedRow = 2;

CaseLibrary playedLibrary() {
    CaseLibrary library = libraryOf(namedCase(kBasicAlbum));
    addColumn(library, &LibraryRoles::playCount, "%play_count%", "0");
    return library;
}

RowChange changed(const CaseLibrary& library, const uint32_t ordinal, const RoleField field,
                  const std::string& value) {
    std::vector<std::string> row = library.rows.at(ordinal);
    row.at(fieldOf(library, field)) = value;
    return {ordinal, std::move(row)};
}

json search(LibraryQuestions& questions, const Library& library, const LibraryRoles& roles,
            const std::string& query) {
    return library.read([&](const Snapshot& snapshot) {
        return questions.search(snapshot, roles, query, kLimit, kEntityLimit, true);
    });
}

json askAlbum(LibraryQuestions& questions, const Library& library, const LibraryRoles& roles,
              const std::string& by) {
    return library.read(
        [&](const Snapshot& snapshot) { return questions.album(snapshot, roles, kAlbum, by); });
}

json everyKind(LibraryQuestions& questions, const Snapshot& snapshot, const LibraryRoles& roles) {
    json answers = json::array({
        questions.search(snapshot, roles, kSearched, kLimit, kEntityLimit, true),
        questions.album(snapshot, roles, kAlbum, std::string(kArtist)),
        questions.artist(snapshot, roles, kOtherArtist, true),
    });
    // NOLINTNEXTLINE(readability-static-accessed-through-instance)
    answers.push_back(questions.genre(snapshot, roles, kGenre));
    return answers;
}

std::vector<uint64_t> changeCounts(const Library& library) {
    return library.read([](const Snapshot& snapshot) {
        std::vector<uint64_t> counts;
        std::transform(snapshot.columns.begin(), snapshot.columns.end(), std::back_inserter(counts),
                       [](const Column& column) { return column.changeCount; });
        return counts;
    });
}

}  // namespace

TEST_CASE("every case in the cases file, search and page alike, answers its expected document") {
    size_t asked = 0;
    for (const json& questionCase : questionCases()) {
        const std::string name = questionCase.at("name").get<std::string>();
        CAPTURE(name);
        ++asked;

        try {
            const CaseLibrary library = libraryOf(questionCase);
            const Snapshot snapshot = snapshotAt(library, questionCase);
            LibraryQuestions questions;
            checkAnswer(ask(questions, snapshot, library.roles, questionCase.at("question")),
                        questionCase.at("expected"), snapshot.trackCount());
        } catch (const std::exception& error) {
            FAIL_CHECK("threw: ", std::string(error.what()));
        }
    }
    CHECK(asked > 0);
}

TEST_CASE(
    "a play between two questions rebuilds no grouping, and each answer carries its revision") {
    const CaseLibrary rows = playedLibrary();
    Library library;
    library.replace(snapshotOf(rows.declared, rows.rows));
    LibraryQuestions questions;

    const auto askEveryKind = [&] {
        return library.read(
            [&](const Snapshot& snapshot) { return everyKind(questions, snapshot, rows.roles); });
    };
    const json before = askEveryKind();
    const size_t built = questions.groupingBuilds();
    REQUIRE(built > 0);

    const size_t playCount = fieldOf(rows, &LibraryRoles::playCount);
    const auto countsBefore = changeCounts(library);
    library.apply({changed(rows, 1, &LibraryRoles::playCount, "1")});
    const auto countsAfter = changeCounts(library);
    REQUIRE(countsAfter.at(playCount) == countsBefore.at(playCount) + 1);
    REQUIRE(static_cast<size_t>(std::count(countsAfter.begin(), countsAfter.end(), 0)) ==
            countsAfter.size() - 1);

    const auto state = library.state();
    REQUIRE(state.structure != state.revision);
    const json after = askEveryKind();

    CHECK(questions.groupingBuilds() == built);
    for (size_t at = 0; at < after.size(); ++at) {
        CAPTURE(at);
        CHECK(withoutPair(after[at]) == withoutPair(before[at]));
        CHECK(after[at].at("structure") == state.structure);
        CHECK(after[at].at("revision") == state.revision);
    }
}

TEST_CASE("an album artist edit between two questions regroups, and the answer follows the edit") {
    const CaseLibrary rows = playedLibrary();
    Library library;
    library.replace(snapshotOf(rows.declared, rows.rows));
    LibraryQuestions questions;

    REQUIRE(refsOf(askAlbum(questions, library, rows.roles, kArtist), rows.rows.size()) ==
            std::vector<uint32_t>{0, 1, kRetaggedRow});
    const size_t built = questions.groupingBuilds();

    library.apply({changed(rows, kRetaggedRow, &LibraryRoles::albumArtist, kOtherArtist)});

    CHECK(refsOf(askAlbum(questions, library, rows.roles, kArtist), rows.rows.size()) ==
          std::vector<uint32_t>{0, 1});
    CHECK(questions.groupingBuilds() > built);

    const json moved = askAlbum(questions, library, rows.roles, kOtherArtist);
    CHECK(refsOf(moved, rows.rows.size()) == std::vector<uint32_t>{kRetaggedRow});
    CHECK(moved.at("artist") == kOtherArtist);
}

TEST_CASE("a title edit between two searches rebuilds what search keeps, and the search finds it") {
    const CaseLibrary rows = playedLibrary();
    Library library;
    library.replace(snapshotOf(rows.declared, rows.rows));
    LibraryQuestions questions;

    constexpr char kRetitled[] = "Pendejo";
    REQUIRE(search(questions, library, rows.roles, kRetitled).at("matchCount") == 0);
    const size_t built = questions.groupingBuilds();

    library.apply({changed(rows, kRetaggedRow, &LibraryRoles::title, kRetitled)});
    const json found = search(questions, library, rows.roles, kRetitled);

    CHECK(questions.groupingBuilds() > built);
    CHECK(setIn(found.at("matched"), rows.rows.size()) ==
          std::optional(std::vector<uint32_t>{kRetaggedRow}));
    CHECK(found.at("matchCount") == 1);
    CHECK(found.at("best") == json::array({kRetaggedRow}));
    CHECK(found.at("namesATrack") == true);
}

TEST_CASE("tracks tying on every rank key keep ascending ordinal order in best, however many tie") {
    // The cases file ties at most a dozen tracks. Below about thirty elements libc++'s std::sort
    // runs an insertion sort, which keeps ties in order by accident; past that it does not.
    constexpr uint32_t kTracks = 64;
    constexpr uint32_t kExactEvery = 3;
    constexpr char kTitle[] = "Same";

    CaseLibrary library;
    library.declared = {"%title%", "%artist%", "%album%", "%album artist%"};
    library.roles.title = kSpineFieldCount;
    library.roles.artist = kSpineFieldCount + 1;
    library.roles.album = kSpineFieldCount + 2;
    library.roles.albumArtist = kSpineFieldCount + 3;

    json exact = json::array();
    json prefixed = json::array();
    for (uint32_t ordinal = 0; ordinal < kTracks; ++ordinal) {
        const bool isExact = ordinal % kExactEvery == 0;
        library.rows.push_back({"Artist/Album/", std::to_string(ordinal) + ".flac", "0",
                                isExact ? kTitle : std::string(kTitle) + " Song", "Artist", "Album",
                                "Artist"});
        (isExact ? exact : prefixed).push_back(ordinal);
    }
    json expected = exact;
    expected.insert(expected.end(), prefixed.begin(), prefixed.end());

    const Snapshot snapshot = snapshotOf(library.declared, library.rows);
    LibraryQuestions questions;
    const json answer = questions.search(snapshot, library.roles, "same", kTracks, 0, true);

    CHECK(answer.at("matchCount") == kTracks);
    CHECK(answer.at("best") == expected);
}

TEST_CASE("a new structure is grouped afresh, though its change counts start at zero again") {
    CaseLibrary rows = playedLibrary();
    Library library;
    library.replace(snapshotOf(rows.declared, rows.rows));
    LibraryQuestions questions;

    REQUIRE(refsOf(askAlbum(questions, library, rows.roles, kArtist), rows.rows.size()) ==
            std::vector<uint32_t>{0, 1, kRetaggedRow});
    const auto first = library.state().structure;

    rows.rows.push_back(rows.rows.at(0));
    rows.rows.back().at(1) = "04 Pendejo.flac";
    library.replace(snapshotOf(rows.declared, rows.rows));
    REQUIRE(library.state().structure != first);

    const json grown = askAlbum(questions, library, rows.roles, kArtist);
    CHECK(refsOf(grown, rows.rows.size()) ==
          std::vector<uint32_t>{0, 1, kRetaggedRow, static_cast<uint32_t>(rows.rows.size() - 1)});
    CHECK(grown.at("structure") == library.state().structure);
}

TEST_CASE("two role sets asked in turn are each grouped once, and each by its own columns") {
    CaseLibrary rows = playedLibrary();
    rows.rows.at(kRetaggedRow).at(fieldOf(rows, &LibraryRoles::albumArtist)) = kOtherArtist;
    const Snapshot snapshot = snapshotOf(rows.declared, rows.rows);

    LibraryRoles withoutAlbumArtist = rows.roles;
    withoutAlbumArtist.albumArtist.reset();

    LibraryQuestions questions;
    const auto refsBy = [&](const LibraryRoles& roles) {
        return refsOf(questions.album(snapshot, roles, kAlbum, std::string(kArtist)),
                      rows.rows.size());
    };
    CHECK(refsBy(rows.roles) == std::vector<uint32_t>{0, 1});
    CHECK(refsBy(withoutAlbumArtist) == std::vector<uint32_t>{0, 1, kRetaggedRow});
    const size_t built = questions.groupingBuilds();

    CHECK(refsBy(rows.roles) == std::vector<uint32_t>{0, 1});
    CHECK(refsBy(withoutAlbumArtist) == std::vector<uint32_t>{0, 1, kRetaggedRow});
    CHECK(questions.groupingBuilds() == built);
}

TEST_CASE("an uncredited album asked with by absent answers its rows beside a blank credit") {
    constexpr char kUncredited[] = "Untitled Demo";
    constexpr char kBlankCredited[] = "Other Record";
    constexpr char kBlank[] = " ";

    CaseLibrary library;
    library.declared = {"%album%", "%artist%", "%album artist%", "%title%"};
    library.roles.album = kSpineFieldCount;
    library.roles.artist = kSpineFieldCount + 1;
    library.roles.albumArtist = kSpineFieldCount + 2;
    library.roles.title = kSpineFieldCount + 3;
    library.rows = {
        {"Demo/", "01 Intro.flac", "0", kUncredited, kUnresolved, kUnresolved, "Intro"},
        {"Demo/", "02 Outro.flac", "0", kUncredited, kUnresolved, kUnresolved, "Outro"},
        {"Other/", "01 Side.flac", "0", kBlankCredited, kBlank, kUnresolved, "Side"},
    };
    const Snapshot snapshot = snapshotOf(library.declared, library.rows);
    LibraryQuestions questions;

    const json uncredited = questions.album(snapshot, library.roles, kUncredited, std::nullopt);
    CHECK(refsOf(uncredited, library.rows.size()) == std::vector<uint32_t>{0, 1});
    CHECK(uncredited.at("artist").is_null());
    CHECK(questions.album(snapshot, library.roles, kUncredited, std::string()) == uncredited);

    const json blankCredited =
        questions.album(snapshot, library.roles, kBlankCredited, std::string(kBlank));
    CHECK(refsOf(blankCredited, library.rows.size()) == std::vector<uint32_t>{2});

    const json found =
        questions.search(snapshot, library.roles, "demo", kLimit, kEntityLimit, true);
    const json& albums = found.at("albums").at("top");
    const auto listed = std::find_if(albums.begin(), albums.end(), [&](const json& album) {
        return album.at("album") == kUncredited;
    });
    REQUIRE(listed != albums.end());
    CHECK(listed->at("artist").is_null());
}

TEST_CASE("eight threads asking at once over one instance each get the single-threaded answer") {
    constexpr size_t kThreads = 8;
    constexpr size_t kAsksPerThread = 100;

    std::vector<const json*> mixed;
    for (const json& questionCase : questionCases()) {
        if (questionCase.at("name").get_ref<const std::string&>().starts_with("captured: "))
            mixed.push_back(&questionCase);
    }
    REQUIRE(mixed.size() > 2);
    const CaseLibrary library = libraryOf(*mixed.front());
    const Snapshot snapshot = snapshotAt(library, *mixed.front());

    std::vector<json> alone;
    for (const json* questionCase : mixed) {
        LibraryQuestions questions;
        alone.push_back(ask(questions, snapshot, library.roles, questionCase->at("question")));
    }

    LibraryQuestions shared;
    std::latch start(kThreads);
    std::atomic<size_t> wrong{0};
    std::vector<std::thread> threads;
    threads.reserve(kThreads);
    for (size_t thread = 0; thread < kThreads; ++thread) {
        threads.emplace_back([&, thread] {
            start.arrive_and_wait();
            for (size_t at = 0; at < kAsksPerThread; ++at) {
                const size_t which = (thread + at) % mixed.size();
                const json answer =
                    ask(shared, snapshot, library.roles, mixed[which]->at("question"));
                if (answer != alone[which])
                    ++wrong;
            }
        });
    }
    for (auto& thread : threads)
        thread.join();

    CHECK(wrong == 0);
}

TEST_CASE("a question racing row changes answers the rows of the revision it carries") {
    constexpr size_t kReaders = 4;
    constexpr size_t kToggles = 200;

    const CaseLibrary rows = playedLibrary();
    Library library;
    library.replace(snapshotOf(rows.declared, rows.rows));
    const RowChange retagged =
        changed(rows, kRetaggedRow, &LibraryRoles::albumArtist, kOtherArtist);
    const RowChange restored = {kRetaggedRow, rows.rows.at(kRetaggedRow)};

    const auto aloneNow = [&] {
        return library.read([&](const Snapshot& snapshot) {
            LibraryQuestions questions;
            json answers = everyKind(questions, snapshot, rows.roles);
            for (json& answer : answers)
                answer = withoutPair(answer);
            return answers;
        });
    };

    const uint64_t asBuilt = library.state().revision;
    const json untouched = aloneNow();
    library.apply({retagged});
    const json moved = aloneNow();
    library.apply({restored});
    REQUIRE(library.state().revision == asBuilt + 2);
    REQUIRE(untouched != moved);

    LibraryQuestions shared;
    std::atomic<bool> written{false};
    std::atomic<size_t> wrong{0};
    std::atomic<size_t> asks{0};
    std::latch start(kReaders + 1);

    std::thread writer([&] {
        start.arrive_and_wait();
        for (size_t toggle = 0; toggle < kToggles; ++toggle)
            library.apply({toggle % 2 == 0 ? retagged : restored});
        written = true;
    });
    std::vector<std::thread> readers;
    readers.reserve(kReaders);
    for (size_t reader = 0; reader < kReaders; ++reader) {
        readers.emplace_back([&] {
            start.arrive_and_wait();
            do {
                library.read([&](const Snapshot& snapshot) {
                    const json answers = everyKind(shared, snapshot, rows.roles);
                    const json& expected =
                        (snapshot.revision - asBuilt) % 2 == 0 ? untouched : moved;
                    for (size_t at = 0; at < answers.size(); ++at) {
                        if (answers[at].at("revision") != snapshot.revision ||
                            withoutPair(answers[at]) != expected[at])
                            ++wrong;
                    }
                });
                ++asks;
            } while (!written);
        });
    }
    writer.join();
    for (auto& reader : readers)
        reader.join();

    INFO("asks: ", asks.load());
    CHECK(wrong == 0);
}

TEST_CASE("an album's cover is the first track of its record, held for every ask after the first") {
    Library library;
    library.replace(coverSnapshot());
    LibraryQuestions questions;

    const auto coversOf = [&](const std::vector<uint32_t>& ordinals) {
        return library.read([&](const Snapshot& snapshot) {
            std::map<std::string, std::string> asked;
            for (const auto& role : coverRoles())
                asked.emplace(role.name, role.expression);
            const auto roles = rolesIn(snapshot, asked);
            REQUIRE(roles.has_value());
            return questions.coverOrdinals(snapshot, *roles, ordinals);
        });
    };

    CHECK(coversOf({0, 1, 2, 4, 5}) == std::vector<uint32_t>{1, 1, 1, 4, 4});
    CHECK(questions.albumBuilds() == 1);

    CHECK(coversOf({5}) == std::vector<uint32_t>{4});
    CHECK(questions.albumBuilds() == 1);
}

TEST_CASE(
    "a third role set asked for costs the least recently asked of the two before it its place") {
    const CaseLibrary rows = playedLibrary();
    const Snapshot snapshot = snapshotOf(rows.declared, rows.rows);

    LibraryRoles withoutAlbumArtist = rows.roles;
    withoutAlbumArtist.albumArtist.reset();
    LibraryRoles withoutGenre = rows.roles;
    withoutGenre.genre.reset();

    LibraryQuestions questions;
    const auto ask = [&](const LibraryRoles& roles) {
        questions.album(snapshot, roles, kAlbum, std::string(kArtist));
    };
    ask(rows.roles);
    ask(withoutAlbumArtist);
    ask(withoutGenre);
    const size_t built = questions.groupingBuilds();

    ask(withoutAlbumArtist);
    CHECK(questions.groupingBuilds() == built);

    ask(rows.roles);
    CHECK(questions.groupingBuilds() == built + 1);
}
