#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_questions.h"
#include "core/library_roles.h"
#include "support/question_library.h"
#include "support/runs_cases.h"
#include "support/summary_cases.h"
#include "third_party/json.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <latch>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kCreditsCase[] = "credits: search \"alpha\" splits true";

// Rows of kCreditsCase. Gamma stands alone only on kGammaAlone, which is what lets the split read
// of "Alpha ft. Gamma" name Gamma; Eta's id is spelled out alone only on kEtaAlone.
constexpr uint32_t kAlphaFtGamma = 2;
constexpr uint32_t kAlphaAndBeta = 5;
constexpr uint32_t kGammaAlone = 8;
constexpr uint32_t kEtaAndTheta = 11;
constexpr uint32_t kEtaAlone = 12;

constexpr size_t kShownMismatches = 5;

json member(const std::string& name, const std::string& key, const bool isGuest) {
    return {{"name", name}, {"key", key}, {"isGuest", isGuest}};
}

json alphaWithGuestGamma() {
    return json::array({member("Alpha", "alpha", false), member("Gamma", "gamma", true)});
}

json alphaAlone() {
    return json::array({member("Alpha", "alpha", false)});
}

RowChange recredited(const QuestionLibrary& library, const uint32_t ordinal,
                     const std::string& credit) {
    RowChange change = library.changed(ordinal, "artist", credit);
    change.values.at(library.columnOf("albumArtist")) = credit;
    return change;
}

struct CreditedLibrary {
    QuestionLibrary rows;
    Library library;
    LibraryRoles roles;

    explicit CreditedLibrary(const char* name) : rows(questionLibraryOf(questionCase(name))) {
        library.replace(rows.snapshot());
        roles = library.read([&](const Snapshot& snapshot) { return rolesOf(snapshot, rows); });
    }

    json ask(LibraryQuestions& questions, const uint32_t ordinal, const bool splitsCredits) const {
        return library.read([&](const Snapshot& snapshot) {
            return questions.credits(snapshot, roles, ordinal, splitsCredits);
        });
    }
};

}  // namespace

TEST_CASE("the credits cases hold every track of every question case's library, in order") {
    const json& questionCases = casesIn("library_questions_cases.json").at("cases");
    const json& creditCases = casesIn("library_credits_cases.json").at("cases");
    REQUIRE(creditCases.size() == questionCases.size());

    for (size_t at = 0; at < creditCases.size(); ++at) {
        const json& credited = creditCases.at(at);
        INFO("case: ", credited.at("name").get<std::string>());
        CHECK(credited.at("name") == questionCases.at(at).at("name"));
        CHECK(credited.at("source") == "library_questions_cases.json");

        const json& rows = credited.at("rows");
        REQUIRE(rows.size() == questionCases.at(at).at("directory").size());
        for (size_t ordinal = 0; ordinal < rows.size(); ++ordinal)
            CHECK(rows.at(ordinal).at("ordinal") == ordinal);
    }
}

TEST_CASE("every track of every case names the members today's creditMembers names, split or not") {
    const json& questionCases = casesIn("library_questions_cases.json").at("cases");
    const json& creditCases = casesIn("library_credits_cases.json").at("cases");
    REQUIRE(creditCases.size() == questionCases.size());

    size_t asked = 0;
    size_t named = 0;
    size_t wrong = 0;
    for (size_t at = 0; at < creditCases.size(); ++at) {
        const QuestionLibrary library = questionLibraryOf(questionCases.at(at));
        const Snapshot snapshot = library.snapshot();
        const LibraryRoles roles = rolesOf(snapshot, library);
        LibraryQuestions questions;

        for (const json& row : creditCases.at(at).at("rows")) {
            const auto ordinal = row.at("ordinal").get<uint32_t>();
            for (const auto& [way, splitsCredits] :
                 {std::pair{"split", true}, {"unsplit", false}}) {
                const json answer = questions.credits(snapshot, roles, ordinal, splitsCredits);
                const json& expected = row.at(way);
                ++asked;
                named += expected.at("artist").size() + expected.at("albumArtist").size();
                if (answer.value("artist", json()) == expected.at("artist") &&
                    answer.value("albumArtist", json()) == expected.at("albumArtist"))
                    continue;

                if (++wrong <= kShownMismatches)
                    MESSAGE("case: ", creditCases.at(at).at("name").get<std::string>(),
                            ", ordinal ", ordinal, ", ", way, "\n  answered: ", answer.dump(),
                            "\n  expected: ", expected.dump());
            }
        }
    }

    INFO("rows asked: ", asked);
    CHECK(named > 0);
    CHECK(wrong == 0);
}

TEST_CASE(
    "a track whose artist credit carries ids has its album artist credit guessed at no more") {
    CreditedLibrary credited(kCreditsCase);
    LibraryQuestions questions;
    const json alphaAndBeta =
        json::array({member("Alpha", "alpha", false), member("Beta", "beta", false)});

    const json before = credited.ask(questions, kAlphaAndBeta, true);
    REQUIRE(before.at("artist") == alphaAndBeta);
    REQUIRE(before.at("albumArtist") == alphaAndBeta);

    credited.library.apply(
        {credited.rows.changed(kAlphaAndBeta, "artistIds", "id-alpha\x1fid-beta")});

    const json after = credited.ask(questions, kAlphaAndBeta, true);
    CHECK(after.at("artist") == alphaAndBeta);
    CHECK(after.at("albumArtist") == json::array());
}

TEST_CASE("a retag elsewhere that leaves an artist standing alone nowhere drops it from a credit") {
    CreditedLibrary credited(kCreditsCase);
    LibraryQuestions questions;

    const json before = credited.ask(questions, kAlphaFtGamma, true);
    REQUIRE(before.at("artist") == alphaWithGuestGamma());
    REQUIRE(before.at("albumArtist") == alphaWithGuestGamma());

    credited.library.apply({recredited(credited.rows, kGammaAlone, "Omega")});

    const json after = credited.ask(questions, kAlphaFtGamma, true);
    CHECK(after.at("artist") == alphaAlone());
    CHECK(after.at("albumArtist") == alphaAlone());
}

TEST_CASE("a retag of the track that names an artist id renames that artist on another credit") {
    CreditedLibrary credited(kCreditsCase);
    LibraryQuestions questions;

    const json before = credited.ask(questions, kEtaAndTheta, false);
    REQUIRE(before.at("artist") ==
            json::array({member("Eta", "eta", false), member("Theta", "theta", false)}));

    credited.library.apply({recredited(credited.rows, kEtaAlone, "Eta Prime")});

    const json after = credited.ask(questions, kEtaAndTheta, false);
    CHECK(after.at("artist") ==
          json::array({member("Eta Prime", "eta prime", false), member("Theta", "theta", false)}));
}

// A rebuilt snapshot's change counts start from zero again, so they alone cannot say that what
// was learned from the last one is stale.
TEST_CASE("a new structure is learned afresh, though its change counts start at zero again") {
    CreditedLibrary credited(kCreditsCase);
    LibraryQuestions questions;
    REQUIRE(credited.ask(questions, kAlphaFtGamma, true).at("artist") == alphaWithGuestGamma());
    const auto first = credited.library.state().structure;

    QuestionLibrary grown = credited.rows;
    grown.rows.at(kGammaAlone) = recredited(grown, kGammaAlone, "Omega").values;
    grown.rows.push_back(grown.rows.back());
    grown.rows.back().at(1) = "added.flac";
    credited.library.replace(grown.snapshot());
    REQUIRE(credited.library.state().structure != first);

    const json answer = credited.ask(questions, kAlphaFtGamma, true);
    CHECK(answer.at("artist") == alphaAlone());
    CHECK(answer.at("structure") == credited.library.state().structure);
}

TEST_CASE("two role sets asked in turn each read their own credit columns") {
    CreditedLibrary credited(kCreditsCase);
    LibraryRoles withoutAlbumArtist = credited.roles;
    withoutAlbumArtist.albumArtist.reset();

    LibraryQuestions questions;
    const auto ask = [&](const LibraryRoles& roles) {
        return credited.library.read([&](const Snapshot& snapshot) {
            return questions.credits(snapshot, roles, kAlphaFtGamma, true);
        });
    };

    for (int round = 0; round < 2; ++round) {
        INFO("round: ", round);
        const json full = ask(credited.roles);
        CHECK(full.at("artist") == alphaWithGuestGamma());
        CHECK(full.at("albumArtist") == alphaWithGuestGamma());

        const json partial = ask(withoutAlbumArtist);
        CHECK(partial.at("artist") == alphaWithGuestGamma());
        CHECK(partial.at("albumArtist") == json::array());
    }
}

TEST_CASE("credits asked while row changes land name the members of the revision they carry") {
    constexpr size_t kReaders = 4;
    constexpr size_t kToggles = 200;

    CreditedLibrary credited(kCreditsCase);
    const RowChange retagged = recredited(credited.rows, kGammaAlone, "Omega");
    const RowChange restored = {kGammaAlone, credited.rows.rows.at(kGammaAlone)};
    const uint64_t asBuilt = credited.library.state().revision;

    LibraryQuestions shared;
    std::atomic<bool> written{false};
    std::atomic<size_t> wrong{0};
    std::atomic<size_t> asks{0};
    std::latch start(kReaders + 1);

    std::thread writer([&] {
        start.arrive_and_wait();
        for (size_t toggle = 0; toggle < kToggles; ++toggle)
            credited.library.apply({toggle % 2 == 0 ? retagged : restored});
        written = true;
    });
    std::vector<std::thread> readers;
    readers.reserve(kReaders);
    for (size_t reader = 0; reader < kReaders; ++reader) {
        readers.emplace_back([&] {
            start.arrive_and_wait();
            do {
                credited.library.read([&](const Snapshot& snapshot) {
                    const json answer =
                        shared.credits(snapshot, credited.roles, kAlphaFtGamma, true);
                    const json expected = (snapshot.revision - asBuilt) % 2 == 0
                                              ? alphaWithGuestGamma()
                                              : alphaAlone();
                    if (answer.value("revision", json()) != snapshot.revision ||
                        answer.value("artist", json()) != expected)
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
