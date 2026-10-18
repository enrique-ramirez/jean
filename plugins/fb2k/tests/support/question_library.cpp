#include "support/question_library.h"

#include "core/library_roles.h"
#include "core/ordinal_sets.h"
#include "support/fixtures.h"
#include "support/summary_cases.h"

#include "third_party/doctest.h"
#include "third_party/httplib.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iterator>
#include <ranges>
#include <utility>

namespace jean::testing {

namespace {

constexpr std::array<std::string_view, 11> kReadRoles{
    "title",     "artist",       "album",          "albumArtist", "genre",     "artists",
    "artistIds", "albumArtists", "albumArtistIds", "trackNumber", "discNumber"};

constexpr char kUnreadValue[] = "1";

bool isRead(const std::string_view role) {
    return std::find(kReadRoles.begin(), kReadRoles.end(), role) != kReadRoles.end();
}

std::string encoded(const std::string& value) {
    return httplib::encode_query_component(value, false);
}

}  // namespace

const nlohmann::json& questionCase(const std::string_view name) {
    const nlohmann::json& cases = casesIn("library_questions_cases.json").at("cases");
    const auto found =
        std::find_if(cases.begin(), cases.end(), [name](const nlohmann::json& questionCase) {
            return questionCase.at("name").get_ref<const std::string&>() == name;
        });
    REQUIRE_MESSAGE(found != cases.end(), "the cases file holds no case named ", std::string(name));
    return *found;
}

Snapshot QuestionLibrary::snapshot() const {
    return snapshotOf(declared, rows);
}

size_t QuestionLibrary::columnOf(const std::string_view role) const {
    const auto named = std::find_if(roles.begin(), roles.end(),
                                    [role](const RoleAsked& asked) { return asked.name == role; });
    REQUIRE(named != roles.end());
    const auto column = std::find(declared.begin(), declared.end(), named->expression);
    REQUIRE(column != declared.end());
    return kSpineFieldCount + static_cast<size_t>(std::distance(declared.begin(), column));
}

RowChange QuestionLibrary::changed(const uint32_t ordinal, const std::string_view role,
                                   const std::string& value) const {
    std::vector<std::string> row = rows.at(ordinal);
    row.at(columnOf(role)) = value;
    return {ordinal, std::move(row)};
}

QuestionLibrary questionLibraryOf(const nlohmann::json& questionCase) {
    const nlohmann::json& columns = questionCase.at("columns");

    QuestionLibrary library;
    std::vector<const nlohmann::json*> values;
    for (const RoleName& role : std::views::reverse(kRoleNames)) {
        const bool carried = columns.contains(role.name);
        if (!carried && isRead(role.name))
            continue;
        const std::string expression = std::string("%") + role.name + "%";
        library.declared.push_back(expression);
        library.roles.push_back({role.name, expression});
        values.push_back(carried ? &columns.at(role.name) : nullptr);
    }

    const nlohmann::json& directory = questionCase.at("directory");
    for (size_t ordinal = 0; ordinal < directory.size(); ++ordinal) {
        std::vector<std::string> row{directory.at(ordinal).get<std::string>(),
                                     questionCase.at("filename").at(ordinal).get<std::string>(),
                                     questionCase.at("subsong").at(ordinal).get<std::string>()};
        for (const nlohmann::json* column : values)
            row.push_back(column ? column->at(ordinal).get<std::string>() : kUnreadValue);
        library.rows.push_back(std::move(row));
    }
    return library;
}

void declareAndBuild(const LibraryRoutesServer& server, Library& library,
                     const QuestionLibrary& questions) {
    const auto declared = server.client().Get(exportPath(questions.declared));
    REQUIRE(declared);
    REQUIRE(declared->status == 202);

    library.replace(questions.snapshot());
    REQUIRE(library.state().ready);
}

std::string questionPath(const std::string_view kind, const std::vector<Owned>& owned,
                         const std::vector<RoleAsked>& roles) {
    std::string path = "/api/library/" + std::string(kind);
    char separator = '?';
    for (const auto& parameter : owned) {
        path += separator + parameter.name + "=" + encoded(parameter.value);
        separator = '&';
    }
    for (const auto& role : roles) {
        path += separator + role.name + "=" + encoded(role.expression);
        separator = '&';
    }
    return path;
}

std::string questionPathOf(const nlohmann::json& questionCase,
                           const std::vector<RoleAsked>& roles) {
    const nlohmann::json& question = questionCase.at("question");
    const std::string& kind = question.at("kind").get_ref<const std::string&>();

    std::vector<Owned> owned;
    if (question.contains("query")) {
        owned.push_back({"query", question.at("query").get<std::string>()});
        owned.push_back({"limit", std::to_string(question.at("limit").get<uint64_t>())});
        owned.push_back(
            {"entityLimit", std::to_string(question.at("entityLimit").get<uint64_t>())});
    } else {
        owned.push_back({"name", question.at("name").get<std::string>()});
    }
    if (question.contains("by"))
        owned.push_back({"by", question.at("by").get<std::string>()});
    if (question.contains("splitsCredits"))
        owned.push_back(
            {"splitsCredits", question.at("splitsCredits").get<bool>() ? "true" : "false"});
    return questionPath(kind, owned, roles);
}

nlohmann::json expectedAnswer(const nlohmann::json& questionCase, const Library::State& state) {
    nlohmann::json expected = questionCase.at("expected");
    for (const char* set : {"refs", "own", "shared", "guest", "matched"}) {
        if (expected.contains(set) && expected.at(set).is_array())
            expected.at(set) =
                ordinalSetDocument(expected.at(set).get<std::vector<uint32_t>>(), state.trackCount);
    }
    expected["structure"] = state.structure;
    expected["revision"] = state.revision;
    return expected;
}

}  // namespace jean::testing
