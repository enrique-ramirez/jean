#include "third_party/doctest.h"

#include "core/library.h"
#include "core/library_questions.h"
#include "core/library_roles.h"
#include "core/library_sets.h"
#include "core/library_summary.h"
#include "support/fixtures.h"
#include "support/question_library.h"
#include "support/runs_cases.h"
#include "support/set_cases.h"
#include "support/summary_cases.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <cstdint>
#include <exception>
#include <iterator>
#include <map>
#include <numeric>
#include <optional>
#include <set>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

json figuresJson(const SetFigures& figures) {
    return {{"albumCount", figures.albumCount},
            {"trackCount", figures.trackCount},
            {"seconds", figures.seconds},
            {"earliestYear", figures.earliestYear},
            {"latestYear", figures.latestYear}};
}

json cardsJson(const ArtistCards& cards) {
    json topGenres = json::array();
    for (const GenreShare& genre : cards.topGenres)
        topGenres.push_back({{"name", genre.name}, {"count", genre.count}, {"share", genre.share}});
    return {{"playedShare", cards.playedShare},
            {"plays", cards.plays},
            {"neverPlayed", cards.neverPlayed},
            {"lastPlayed", cards.lastPlayed},
            {"mostPlayed", cards.mostPlayed ? json{{"ordinal", cards.mostPlayed->ordinal},
                                                   {"title", cards.mostPlayed->title},
                                                   {"plays", cards.mostPlayed->plays}}
                                            : json(nullptr)},
            {"topGenres", topGenres}};
}

json recordsJson(const std::vector<RecordInSet>& records) {
    json listed = json::array();
    for (const RecordInSet& record : records)
        listed.push_back({{"album", record.album},
                          {"artist", record.artist},
                          {"year", record.year},
                          {"cover", record.cover},
                          {"trackCount", record.trackCount}});
    return listed;
}

json expectedCards(const json& setsCase, const json& frozen) {
    json cards = frozen;
    if (frozen.at("mostPlayed").is_object()) {
        const auto ordinal = frozen.at("mostPlayed").at("ordinal").get<uint32_t>();
        cards["mostPlayed"] = {{"ordinal", ordinal},
                               {"title", titleIn(setsCase, ordinal)},
                               {"plays", frozen.at("mostPlayed").at("plays")}};
    }
    return cards;
}

json expectedGenres(const json& setsCase) {
    json genres = setsCase.at("genres");
    for (json& genre : genres) {
        json covers = json::array();
        for (const json& ordinal : genre.at("covers"))
            covers.push_back(pathIn(setsCase, ordinal.get<uint32_t>()));
        genre["covers"] = covers;
    }
    return genres;
}

std::vector<uint32_t> partOf(const json& setsCase, const json& set) {
    const std::string& part = set.at("part").get_ref<const std::string&>();
    const json& expected = sourceOf(setsCase).at("expected");
    if (part != "all")
        return expected.at(part).get<std::vector<uint32_t>>();

    std::set<uint32_t> all;
    for (const char* each : {"own", "shared", "guest"}) {
        const auto ordinals = expected.at(each).get<std::vector<uint32_t>>();
        all.insert(ordinals.begin(), ordinals.end());
    }
    return {all.begin(), all.end()};
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
    if (kind == "album")
        return questions.album(snapshot, roles, name,
                               question.contains("by")
                                   ? std::optional(question.at("by").get<std::string>())
                                   : std::nullopt);
    if (kind == "artist")
        return questions.artist(snapshot, roles, name, question.at("splitsCredits").get<bool>());
    REQUIRE(kind == "genre");
    // NOLINTNEXTLINE(readability-static-accessed-through-instance)
    return questions.genre(snapshot, roles, name);
}

const json& setNamed(const json& setsCase, const std::string_view part) {
    const json& sets = setsCase.at("sets");
    const auto found = std::find_if(sets.begin(), sets.end(), [&part](const json& set) {
        return set.at("part").get_ref<const std::string&>() == part;
    });
    REQUIRE_MESSAGE(found != sets.end(), "the case holds no ", part, " set");
    return *found;
}

struct Built {
    QuestionLibrary library;
    Snapshot snapshot;
    LibraryRoles roles;
};

Built builtFrom(const json& setsCase) {
    Built built{measuredLibraryOf(setsCase), {}, {}};
    built.snapshot = built.library.snapshot();
    built.roles = rolesOf(built.snapshot, built.library);
    return built;
}

constexpr char kQuartet[] = "Quartet";
constexpr char kOther[] = "Other";

// Ordinal 0 belongs to another artist and meets the genres in an order of its own, so the library's
// first sight of each genre, its bytewise order and the set's first sight all differ.
std::vector<std::vector<std::string>> quartetRows() {
    const std::vector<std::string> genres{"Polka",  "Mambo", "Ska",   "Bolero", "Zydeco", "Zydeco",
                                          "Zydeco", "Polka", "Mambo", "Ska",    "Bolero", "?"};
    std::vector<std::vector<std::string>> rows{{"A Other/", "01.flac", "0", kOther, "Elsewhere",
                                                "Bolero\x1fSka\x1fMambo\x1fPolka", "One"}};
    for (size_t at = 0; at < genres.size(); ++at)
        rows.push_back({"B Quartet/", (at < 9 ? "0" : "") + std::to_string(at + 1) + ".flac", "0",
                        kQuartet, "Dances", genres[at], "Dance " + std::to_string(at + 1)});
    return rows;
}

}  // namespace

TEST_CASE("every set of every case has the frozen header figures, cards and records") {
    size_t compared = 0;
    for (const json& setsCase : setCases()) {
        const std::string name = setsCase.at("name").get<std::string>();
        if (setsCase.at("sets").empty())
            continue;
        try {
            const Built built = builtFrom(setsCase);
            for (const json& set : setsCase.at("sets")) {
                const std::string part = set.at("part").get<std::string>();
                INFO("case: ", name, ", set: ", part);
                const std::vector<uint32_t> ordinals = partOf(setsCase, set);
                ++compared;

                CHECK(figuresJson(figuresOver(built.snapshot, built.roles, ordinals)) ==
                      set.at("figures"));
                if (set.at("kind") != "artist")
                    continue;
                CHECK(cardsJson(cardsOver(built.snapshot, built.roles, ordinals, kolkataTime())) ==
                      expectedCards(setsCase, set.at("cards")));
                CHECK(recordsJson(recordsOver(built.snapshot, built.roles, ordinals)) ==
                      set.at("records"));
            }
        } catch (const std::exception& error) {
            FAIL_CHECK("case: ", name, " threw: ", std::string(error.what()));
        }
    }
    CHECK(compared == 770);
}

TEST_CASE(
    "each answer carries the frozen figures of its set, and an artist's its cards and records") {
    size_t asked = 0;
    for (const json& setsCase : setCases()) {
        if (setsCase.at("sets").empty())
            continue;
        const std::string name = setsCase.at("name").get<std::string>();
        INFO("case: ", name);
        ++asked;
        try {
            const Built built = builtFrom(setsCase);
            LibraryQuestions questions(kolkataTime());
            const json& question = setsCase.at("sets").at(0).at("question");
            const json answer = ask(questions, built.snapshot, built.roles, question);

            if (question.at("kind") != "artist") {
                CHECK(answer.at("figures") == setsCase.at("sets").at(0).at("figures"));
                continue;
            }
            const json& all = setNamed(setsCase, "all");
            CHECK(answer.at("figures") == all.at("figures"));
            CHECK(answer.at("cards") == expectedCards(setsCase, all.at("cards")));

            json records = answer.at("records");
            for (const char* part : {"own", "shared"}) {
                INFO("records: ", part);
                json expected = setNamed(setsCase, part).at("records");
                for (json& record : expected)
                    record["cover"] = pathIn(setsCase, record.at("cover").get<uint32_t>());
                CHECK(records.at(part) == expected);
            }
        } catch (const std::exception& error) {
            FAIL_CHECK("threw: ", std::string(error.what()));
        }
    }
    CHECK(asked > 0);
}

TEST_CASE("every case's genres page lists each genre with its tracks, albums, artists and covers") {
    size_t listed = 0;
    for (const json& setsCase : setCases()) {
        const std::string name = setsCase.at("name").get<std::string>();
        INFO("case: ", name);
        try {
            const Built built = builtFrom(setsCase);
            const json document = json::parse(summariseLibrary(
                built.snapshot, built.roles, 0, kolkataTime(), SummaryParts{.genres = true}));
            REQUIRE(document.contains("genres"));
            CHECK(document.at("genres") == expectedGenres(setsCase));

            const json& listedGenres = document.at("genres");
            for (const json& frozen : setsCase.at("genres")) {
                INFO("genre: ", frozen.at("name").get<std::string>());
                const auto sent = std::find_if(
                    listedGenres.begin(), listedGenres.end(),
                    [&frozen](const json& genre) { return genre.at("name") == frozen.at("name"); });
                REQUIRE(sent != listedGenres.end());
                CHECK(sent->value("albumCount", json()) == frozen.at("albumCount"));
                CHECK(sent->value("artistCount", json()) == frozen.at("artistCount"));
            }
            listed += setsCase.at("genres").size();
        } catch (const std::exception& error) {
            FAIL_CHECK("threw: ", std::string(error.what()));
        }
    }
    CHECK(listed > 0);
}

TEST_CASE("each shelf's figures are over the tracks of the albums it lists, and no others") {
    size_t shelves = 0;
    for (const json& summaryCase : librarySummaryCases().at("cases")) {
        const std::string name = summaryCase.at("name").get<std::string>();
        INFO("case: ", name);
        const json& columns = summaryCase.at("columns");

        std::vector<std::string> declared;
        std::map<std::string, std::string> expressions;
        for (const auto& [role, values] : columns.items()) {
            declared.push_back("%" + role + "%");
            expressions[role] = declared.back();
        }
        std::vector<std::vector<std::string>> rows;
        for (size_t ordinal = 0; ordinal < summaryCase.at("directory").size(); ++ordinal) {
            std::vector<std::string> row{summaryCase.at("directory").at(ordinal),
                                         summaryCase.at("filename").at(ordinal),
                                         summaryCase.at("subsong").at(ordinal)};
            for (const auto& [role, values] : columns.items())
                row.push_back(values.at(ordinal).get<std::string>());
            rows.push_back(std::move(row));
        }
        const Snapshot snapshot = snapshotOf(declared, rows);
        const auto roles = rolesIn(snapshot, expressions);
        REQUIRE(roles.has_value());

        const json document = json::parse(summariseLibrary(
            snapshot, *roles, summaryCase.at("now").get<int64_t>(), kolkataTime()));
        for (const json& shelf : document.at("shelves")) {
            INFO("shelf: ", shelf.at("id").get<std::string>());
            ++shelves;
            std::vector<uint32_t> tracks;
            size_t listedTracks = 0;
            for (const json& album : shelf.at("albums")) {
                const auto ordinals = album.at("ordinals").get<std::vector<uint32_t>>();
                tracks.insert(tracks.end(), ordinals.begin(), ordinals.end());
                listedTracks += album.at("trackCount").get<size_t>();
            }
            std::sort(tracks.begin(), tracks.end());

            REQUIRE(shelf.contains("figures"));
            const json& figures = shelf.at("figures");
            CHECK(figures.at("albumCount") == shelf.at("albums").size());
            CHECK(figures.at("trackCount") == listedTracks);
            CHECK(figures == figuresJson(figuresOver(snapshot, *roles, tracks)));
        }
    }
    CHECK(shelves > 0);
}

TEST_CASE("an artist's top genres stop at four, largest first, and ties keep the set's own order") {
    const std::vector<std::string> declared{"%artist%", "%album%", "%genre%", "%title%"};
    const Snapshot snapshot = snapshotOf(declared, quartetRows());
    const auto roles = rolesIn(
        snapshot,
        {{"artist", "%artist%"}, {"album", "%album%"}, {"genre", "%genre%"}, {"title", "%title%"}});
    REQUIRE(roles.has_value());

    std::vector<uint32_t> quartet(snapshot.trackCount() - 1);
    std::iota(quartet.begin(), quartet.end(), 1);
    const ArtistCards cards = cardsOver(snapshot, *roles, quartet, kolkataTime());

    CHECK(cardsJson(cards).at("topGenres") == json::array({
                                                  {{"name", "Zydeco"}, {"count", 3}, {"share", 25}},
                                                  {{"name", "Polka"}, {"count", 2}, {"share", 17}},
                                                  {{"name", "Mambo"}, {"count", 2}, {"share", 17}},
                                                  {{"name", "Ska"}, {"count", 2}, {"share", 17}},
                                              }));
}

TEST_CASE("an artist's plays and last play read the higher of two sources, and a tie goes first") {
    const std::vector<std::string> declared{"%artist%",     "%album%",       "%title%",
                                            "%play_count%", "%lastfm_play%", "%last_played%",
                                            "%lastfm_last%"};
    const Snapshot snapshot = snapshotOf(
        declared, {
                      {"Duo/", "01.flac", "0", "Duo", "Pair", "Local", "2", "5",
                       "2026-03-01 10:00:00", "2026-05-01 10:00:00"},
                      {"Duo/", "02.flac", "0", "Duo", "Pair", "Scrobbled", "7", "?",
                       "2026-06-01 10:00:00", "N/A"},
                      {"Duo/", "03.flac", "0", "Duo", "Pair", "Unplayed", "0", "0", "N/A", "N/A"},
                      {"Duo/", "04.flac", "0", "Duo", "Pair", "Tied", "?", "7", "N/A", "N/A"},
                  });
    const auto roles = rolesIn(snapshot, {{"artist", "%artist%"},
                                          {"album", "%album%"},
                                          {"title", "%title%"},
                                          {"playCountLocal", "%play_count%"},
                                          {"playCount", "%lastfm_play%"},
                                          {"lastPlayedLocal", "%last_played%"},
                                          {"lastPlayed", "%lastfm_last%"}});
    REQUIRE(roles.has_value());

    const ArtistCards cards =
        cardsOver(snapshot, *roles, std::vector<uint32_t>{0, 1, 2, 3}, kolkataTime());
    CHECK(cards.plays == 19);
    CHECK(cards.neverPlayed == 1);
    CHECK(cardsJson(cards).at("mostPlayed") ==
          json{{"ordinal", 1}, {"title", "Scrobbled"}, {"plays", 7}});
    CHECK(cards.lastPlayed == kolkataTime().epochMs(2026, 6, 1, 10, 0, 0));
    CHECK(cardsOver(snapshot, *roles, std::vector<uint32_t>{0}, kolkataTime()).lastPlayed ==
          kolkataTime().epochMs(2026, 5, 1, 10, 0, 0));
}

TEST_CASE("a search that matches nothing to look for answers zero figures and no years") {
    const json zero{{"albumCount", 0},
                    {"trackCount", 0},
                    {"seconds", 0},
                    {"earliestYear", nullptr},
                    {"latestYear", nullptr}};

    for (const char* name :
         {"basic: search a query that folds to nothing, spaces",
          "basic: search a query that folds to nothing, a lone mark", "empty: search"}) {
        INFO("case: ", name);
        const json& setsCase = setCase(name);
        const Built built = builtFrom(setsCase);
        LibraryQuestions questions(kolkataTime());
        const json answer =
            ask(questions, built.snapshot, built.roles, sourceOf(setsCase).at("question"));
        REQUIRE(answer.at("matched").is_null());
        CHECK(answer.at("figures") == zero);
    }

    const Built built = builtFrom(setCase("basic: search one letter a"));
    CHECK(figuresJson(figuresOver(built.snapshot, built.roles, {})) == zero);
}
