#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_questions.h"
#include "core/library_roles.h"
#include "support/question_library.h"
#include "support/runs_cases.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <latch>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

using Values = std::vector<std::string>;

// MØ, Mœnia and Moenia, whose bytewise order is not the order their folded forms sort in.
constexpr char kStrokedLetters[] = "ascii: search mo for the stroked o";
constexpr char kSpellings[] = "spellings: search beyonce";
constexpr char kUnicode[] = "unicode: search sigma alone";
constexpr char kGenres[] = "genres: search rock";
constexpr char kCredits[] = "credits: search \"alpha\" splits true";

constexpr size_t kNoCap = 100;
constexpr uint32_t kBranfordRow = 3;
constexpr uint32_t kPopRow = 0;

constexpr char kComposedElectro[] = "Électro";
constexpr char kDecomposedElectro[] = "Électro";

struct CaseLibrary {
    QuestionLibrary rows;
    Library library;
    LibraryRoles roles;

    explicit CaseLibrary(const char* name) : rows(questionLibraryOf(questionCase(name))) {
        library.replace(rows.snapshot());
        roles = library.read([&](const Snapshot& snapshot) { return rolesOf(snapshot, rows); });
    }

    json answer(LibraryQuestions& questions, const ValueField field, const std::string& prefix,
                const size_t limit, const LibraryRoles& asked) const {
        return library.read([&](const Snapshot& snapshot) {
            return questions.values(snapshot, asked, field, prefix, limit);
        });
    }

    Values values(LibraryQuestions& questions, const ValueField field, const std::string& prefix,
                  const size_t limit = kNoCap) const {
        return answer(questions, field, prefix, limit, roles).at("values").get<Values>();
    }

    Values values(const ValueField field, const std::string& prefix,
                  const size_t limit = kNoCap) const {
        LibraryQuestions questions;
        return values(questions, field, prefix, limit);
    }
};

Values sorted(Values values) {
    std::sort(values.begin(), values.end());
    return values;
}

struct Completion {
    const char* library;
    ValueField field;
    std::string prefix;
    Values expected;
};

void checkCompletions(const std::vector<Completion>& completions) {
    for (const auto& completion : completions) {
        INFO("library: ", completion.library, ", prefix: ", completion.prefix);
        const CaseLibrary library(completion.library);
        CHECK(library.values(completion.field, completion.prefix) == completion.expected);
    }
}

}  // namespace

TEST_CASE(
    "an empty prefix answers every value of the field once, in the dictionary's bytewise order") {
    checkCompletions({
        {kStrokedLetters,
         ValueField::artist,
         "",
         {"Branford Marsalis", "Moenia", "MØ", "Mœnia", "Æon Flux", "Łódź"}},
        {kStrokedLetters,
         ValueField::album,
         "",
         {"Adición", "Mo Better Blues", "Mœnia", "Æ", "Ø", "Łódź"}},
        {kStrokedLetters, ValueField::genre, "", {"Jazz", "Pop", "Rock"}},
    });
}

// A value no fold changes is a poor witness: each case here needs the fold on the side it names.
// MØ folds to "mo", so no artist begins with "o" though one holds it.
TEST_CASE("a prefix and a value are both folded before one is matched against the other") {
    checkCompletions({
        {kStrokedLetters, ValueField::artist, "mo", {"Moenia", "MØ", "Mœnia"}},
        {kStrokedLetters, ValueField::artist, "mø", {"Moenia", "MØ", "Mœnia"}},
        {kStrokedLetters, ValueField::artist, "moe", {"Moenia", "Mœnia"}},
        {kStrokedLetters, ValueField::artist, "MŒ", {"Moenia", "Mœnia"}},
        {kStrokedLetters, ValueField::artist, "æ", {"Æon Flux"}},
        {kStrokedLetters, ValueField::artist, "lodz", {"Łódź"}},
        {kStrokedLetters, ValueField::album, "o", {"Ø"}},
        {kStrokedLetters, ValueField::artist, "o", {}},
        {kStrokedLetters, ValueField::album, "ø", {"Ø"}},
        {kSpellings, ValueField::artist, "bjo", {"Bjork", "Björk"}},
        {kSpellings, ValueField::artist, "BJÖ", {"Bjork", "Björk"}},
        {kSpellings, ValueField::artist, "ｆｕ", {"Ｆｕｌｌ Ｗｉｄｔｈ"}},
        {kSpellings, ValueField::album, "ágæ", {"Ágætis byrjun"}},
        {kUnicode, ValueField::artist, "straß", {"Strasse", "Straße"}},
        {kUnicode, ValueField::album, "ẞ", {"SS", "ẞ"}},
        {kUnicode,
         ValueField::artist,
         "ı",
         {"Istanbul Band", "i̇stanbul dotted", "İstanbul Band", "ıspanak"}},
    });
}

TEST_CASE("each field is completed from its own column") {
    checkCompletions({
        {kCredits, ValueField::artist, "tv", {"TV On The Radio"}},
        {kCredits, ValueField::albumArtist, "tv", {"TV on the Radio"}},
        {kCredits, ValueField::artist, "l", {"Lambda"}},
        {kCredits, ValueField::albumArtist, "l", {}},
        {kCredits, ValueField::album, "l", {"Loose Singles"}},
        {kStrokedLetters, ValueField::album, "mo", {"Mo Better Blues", "Mœnia"}},
        {kStrokedLetters, ValueField::genre, "p", {"Pop"}},
    });
}

TEST_CASE(
    "each genre of a multi-valued tag is a value of its own, offered once however often held") {
    checkCompletions({
        {kGenres, ValueField::genre, "po", {"Pop"}},
        {kGenres, ValueField::genre, "ja", {"Jazz"}},
        {kGenres, ValueField::genre, "bl", {"Blues"}},
        {kGenres, ValueField::genre, "rock,", {"Rock, Pop"}},
        {kGenres, ValueField::genre, "é", {"Electro", kDecomposedElectro, kComposedElectro}},
    });
}

TEST_CASE("the separator splits a genre tag and no other field's") {
    CaseLibrary library(kStrokedLetters);
    library.library.apply({library.rows.changed(kBranfordRow, "artist", "Mono\x1fPolo")});

    LibraryQuestions questions;
    CHECK(library.values(questions, ValueField::artist, "po").empty());
    CHECK(library.values(questions, ValueField::artist, "mono") == Values{"Mono\x1fPolo"});
}

TEST_CASE("a value the player left unresolved, empty or N/A is no value, nor is an empty genre") {
    const CaseLibrary library(kGenres);
    LibraryQuestions questions;

    CHECK(library.values(questions, ValueField::genre, "n").empty());
    CHECK(library.values(questions, ValueField::genre, "?").empty());

    const Values every = library.values(questions, ValueField::genre, "");
    INFO("every genre: ", json(every).dump());
    for (const char* blank : {"", "   ", "?", "N/A"}) {
        INFO("blank: '", blank, "'");
        CHECK(std::find(every.begin(), every.end(), blank) == every.end());
    }
}

TEST_CASE("limit caps the values at the first that many, and a limit of 0 answers none") {
    const CaseLibrary library(kStrokedLetters);
    LibraryQuestions questions;

    struct Capped {
        size_t limit;
        Values expected;
    };
    const std::vector<Capped> capped{
        {0, {}},
        {1, {"Moenia"}},
        {2, {"Moenia", "MØ"}},
        {3, {"Moenia", "MØ", "Mœnia"}},
        {kNoCap, {"Moenia", "MØ", "Mœnia"}},
    };
    for (const auto& [limit, expected] : capped) {
        INFO("limit: ", limit);
        CHECK(library.values(questions, ValueField::artist, "mo", limit) == expected);
    }
    CHECK(library.values(questions, ValueField::genre, "", 2) == Values{"Jazz", "Pop"});
}

TEST_CASE("a field whose role was left out of the question has no values") {
    const CaseLibrary library(kStrokedLetters);
    LibraryRoles withoutGenre = library.roles;
    withoutGenre.genre.reset();

    LibraryQuestions questions;
    CHECK(library.answer(questions, ValueField::genre, "", kNoCap, withoutGenre).at("values") ==
          json::array());
    CHECK(library.values(questions, ValueField::genre, "") == Values{"Jazz", "Pop", "Rock"});
}

// Whether a value no track carries any longer is still offered is left open, so only what the
// retag brought in is held.
TEST_CASE("a retag between two asks offers the value it brought in, genres split as ever") {
    CaseLibrary library(kStrokedLetters);
    LibraryQuestions questions;
    REQUIRE(library.values(questions, ValueField::artist, "mo") == Values{"Moenia", "MØ", "Mœnia"});
    REQUIRE(library.values(questions, ValueField::genre, "po") == Values{"Pop"});

    library.library.apply({library.rows.changed(kBranfordRow, "artist", "Mono")});
    CHECK(sorted(library.values(questions, ValueField::artist, "mo")) ==
          sorted({"Moenia", "Mono", "MØ", "Mœnia"}));

    library.library.apply({library.rows.changed(kPopRow, "genre", "Polka\x1fPop")});
    CHECK(sorted(library.values(questions, ValueField::genre, "po")) == sorted({"Polka", "Pop"}));
}

// A rebuilt snapshot's change counts start from zero again, so they alone cannot say that what
// was folded for the last one is stale. A rebuild keeps the dictionaries it can, so the order is
// not held here.
TEST_CASE("a new structure is folded afresh, though its change counts start at zero again") {
    CaseLibrary library(kStrokedLetters);
    LibraryQuestions questions;
    REQUIRE(library.values(questions, ValueField::artist, "mo") == Values{"Moenia", "MØ", "Mœnia"});
    const auto first = library.library.state().structure;

    QuestionLibrary grown = library.rows;
    grown.rows.push_back(grown.changed(kBranfordRow, "artist", "Moby").values);
    grown.rows.back().at(1) = "added.flac";
    library.library.replace(grown.snapshot());
    REQUIRE(library.library.state().structure != first);

    CHECK(sorted(library.values(questions, ValueField::artist, "mo")) ==
          sorted({"Moby", "Moenia", "MØ", "Mœnia"}));
}

TEST_CASE("values asked while row changes land are the values of the revision they carry") {
    constexpr size_t kReaders = 4;
    constexpr size_t kToggles = 200;

    CaseLibrary library(kStrokedLetters);
    const RowChange retagged = library.rows.changed(kBranfordRow, "artist", "Mono");
    const RowChange restored = {kBranfordRow, library.rows.rows.at(kBranfordRow)};

    // Folded before the retag first lands, so an instance that kept that fold answers without it.
    LibraryQuestions shared;
    REQUIRE(library.values(shared, ValueField::artist, "mo") == Values{"Moenia", "MØ", "Mœnia"});

    // Each is read after both spellings have been in the snapshot, so neither depends on whether
    // a value no track carries any longer is offered.
    const auto aloneNow = [&] { return sorted(library.values(ValueField::artist, "mo")); };
    library.library.apply({retagged});
    const Values moved = aloneNow();
    library.library.apply({restored});
    const Values untouched = aloneNow();
    const uint64_t restoredAt = library.library.state().revision;
    REQUIRE(std::find(moved.begin(), moved.end(), "Mono") != moved.end());

    std::atomic<bool> written{false};
    std::atomic<size_t> wrong{0};
    std::atomic<size_t> asks{0};
    std::latch start(kReaders + 1);

    std::thread writer([&] {
        start.arrive_and_wait();
        for (size_t toggle = 0; toggle < kToggles; ++toggle)
            library.library.apply({toggle % 2 == 0 ? retagged : restored});
        written = true;
    });
    std::vector<std::thread> readers;
    readers.reserve(kReaders);
    for (size_t reader = 0; reader < kReaders; ++reader) {
        readers.emplace_back([&] {
            start.arrive_and_wait();
            do {
                library.library.read([&](const Snapshot& snapshot) {
                    const json answer =
                        shared.values(snapshot, library.roles, ValueField::artist, "mo", kNoCap);
                    const Values& expected =
                        (snapshot.revision - restoredAt) % 2 == 0 ? untouched : moved;
                    const json values = answer.value("values", json());
                    if (answer.value("revision", json()) != snapshot.revision ||
                        !values.is_array() || sorted(values.get<Values>()) != expected)
                        ++wrong;
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
