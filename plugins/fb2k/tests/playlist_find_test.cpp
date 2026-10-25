#include "third_party/doctest.h"

#include "core/documents.h"
#include "core/library.h"
#include "core/library_entities.h"
#include "core/library_roles.h"
#include "core/playlist_find.h"
#include "support/question_library.h"
#include "support/summary_cases.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

using namespace jean;
using namespace jean::testing;
using nlohmann::json;

namespace {

constexpr char kFindCases[] = "playlist_find_cases.json";
constexpr size_t kCaseCount = 19;
constexpr size_t kQueryCount = 195;

constexpr char kBasic[] = "basic: search a query that folds to nothing, empty";

constexpr std::array<const char*, kSearchedColumnCount> kOutsideFields{
    "title", "artist", "albumArtist", "album", "artistSort"};

const json& findCase(std::string_view name) {
    for (const json& found : casesIn(kFindCases).at("cases")) {
        if (found.at("name").get_ref<const std::string&>() == name)
            return found;
    }
    FAIL("the find cases hold no case named ", std::string(name));
    return casesIn(kFindCases);
}

std::vector<PlaylistTrack> playlistOf(const json& findCase) {
    std::vector<PlaylistTrack> rows;
    for (const json& row : findCase.at("rows")) {
        PlaylistTrack track;
        if (row.contains("ordinal")) {
            track.ordinal = row.at("ordinal").get<uint32_t>();
        } else {
            for (const char* field : kOutsideFields)
                track.columns.push_back(row.at(field).get<std::string>());
        }
        rows.push_back(std::move(track));
    }
    return rows;
}

struct Held {
    Snapshot snapshot;
    LibraryRoles roles;
    SearchText folded;
    SearchText glyphs;
    std::vector<PlaylistTrack> rows;

    std::vector<uint32_t> find(std::string_view query) const {
        return playlistMatches(snapshot, roles, folded, glyphs, rows, query);
    }
};

Held heldFor(const json& findCase) {
    REQUIRE(findCase.at("source") == "library_questions_cases.json");
    const QuestionLibrary library =
        questionLibraryOf(questionCase(findCase.at("name").get<std::string>()));

    Held held;
    held.snapshot = library.snapshot();
    std::map<std::string, std::string> expressions;
    for (const RoleAsked& role : library.roles)
        expressions[role.name] = role.expression;
    const std::optional<LibraryRoles> roles = rolesIn(held.snapshot, expressions);
    REQUIRE(roles);
    held.roles = *roles;
    held.folded = *searchTextOf(held.snapshot, held.roles);
    held.glyphs = *glyphTextOf(held.snapshot, held.roles);
    held.rows = playlistOf(findCase);
    return held;
}

std::vector<uint32_t> everyPosition(size_t rows) {
    std::vector<uint32_t> positions(rows);
    for (size_t at = 0; at < rows; ++at)
        positions[at] = static_cast<uint32_t>(at);
    return positions;
}

std::vector<uint32_t> outsideRowsTitled(const json& findCase, const std::string& title) {
    std::vector<uint32_t> positions;
    const json& rows = findCase.at("rows");
    for (size_t at = 0; at < rows.size(); ++at) {
        if (!rows[at].contains("ordinal") && rows[at].at("title") == title)
            positions.push_back(static_cast<uint32_t>(at));
    }
    return positions;
}

}  // namespace

TEST_CASE("every query of every find case matches the positions today's rowMatches gives") {
    size_t cases = 0;
    size_t queries = 0;
    for (const json& findCase : casesIn(kFindCases).at("cases")) {
        const std::string& name = findCase.at("name").get_ref<const std::string&>();
        const Held held = heldFor(findCase);
        ++cases;

        for (const json& asked : findCase.at("queries")) {
            const std::string& query = asked.at("query").get_ref<const std::string&>();
            INFO("case: ", name);
            INFO("query: '", query, "'");
            CHECK(held.find(query) == asked.at("matched").get<std::vector<uint32_t>>());
            ++queries;
        }
    }
    CHECK(cases == kCaseCount);
    CHECK(queries == kQueryCount);
}

// The generator's last two outside rows share no word with any library, so only folding a row's
// own values finds them: Ñ and é have to fold for the first two queries to match at all.
TEST_CASE("a row outside the library is found by its own values, folded as a query is") {
    const json& asked = findCase(kBasic);
    const Held held = heldFor(asked);
    const auto accented = outsideRowsTitled(asked, "Año de Ñandú");
    const auto plain = outsideRowsTitled(asked, "Zyxwv Qrstu");
    REQUIRE_FALSE(accented.empty());
    REQUIRE_FALSE(plain.empty());

    CHECK(held.find("nandu") == accented);
    CHECK(held.find("Ñandú réveil") == accented);
    CHECK(held.find("solstice ensemble") == accented);
    CHECK(held.find("quux plinth") == plain);
    CHECK(held.find("zyxwv nandu").empty());
}

TEST_CASE("a library row is matched on the text held for the snapshot, not on its values") {
    const json& asked = findCase(kBasic);
    Held held = heldFor(asked);
    REQUIRE(held.roles.title);
    const Column& titles = held.snapshot.columns[*held.roles.title];

    const auto first = std::find_if(held.rows.begin(), held.rows.end(),
                                    [](const PlaylistTrack& row) { return row.ordinal; });
    REQUIRE(first != held.rows.end());
    const uint32_t id = titles.ids[*first->ordinal];

    std::vector<uint32_t> sharingTheTitle;
    for (size_t at = 0; at < held.rows.size(); ++at) {
        if (held.rows[at].ordinal && titles.ids[*held.rows[at].ordinal] == id)
            sharingTheTitle.push_back(static_cast<uint32_t>(at));
    }

    held.folded.folded[0][id] = "heldonly";
    held.glyphs.folded[0][id] = "-.-.-";

    CHECK(held.find("heldonly") == sharingTheTitle);
    CHECK(held.find("HELDONLY") == sharingTheTitle);
    CHECK(held.find("-.-.-") == sharingTheTitle);
    CHECK(held.find("- . - . -") == sharingTheTitle);

    // A query of marks alone is one token with its spaces dropped, as queryOf makes it, so "- -"
    // asks for two dashes side by side, which "-.-.-" does not hold.
    CHECK(held.find("- -").empty());
}

TEST_CASE("a query that folds to no words matches every row, as rowMatches does today") {
    const Held held = heldFor(findCase(kBasic));
    const auto every = everyPosition(held.rows.size());
    REQUIRE(every.size() > 6);

    for (const std::string query : {"", "   \t ", "\xcc\x81"}) {
        INFO("query: '", query, "'");
        CHECK(held.find(query) == every);
    }
}

TEST_CASE("an empty playlist matches nothing, whatever is asked") {
    Held held = heldFor(findCase(kBasic));
    held.rows.clear();

    for (const std::string query : {"", "a", "..."}) {
        INFO("query: '", query, "'");
        CHECK(held.find(query).empty());
    }
}
