#include "support/set_cases.h"

#include "support/summary_cases.h"

#include "third_party/doctest.h"

#include <algorithm>

namespace jean::testing {

namespace {

constexpr char kZone[] = "Asia/Kolkata";

constexpr char kUnresolvedValue[] = "?";

}  // namespace

const nlohmann::json& setCases() {
    const nlohmann::json& file = casesIn("library_sets_cases.json");
    REQUIRE(file.at("zone") == kZone);
    return file.at("cases");
}

const nlohmann::json& setCase(const std::string& name) {
    const nlohmann::json& cases = setCases();
    const auto found = std::find_if(cases.begin(), cases.end(), [&name](const nlohmann::json& c) {
        return c.at("name").get_ref<const std::string&>() == name;
    });
    REQUIRE_MESSAGE(found != cases.end(), "the sets file holds no case named ", name);
    return *found;
}

const nlohmann::json& sourceOf(const nlohmann::json& setsCase) {
    return questionCase(setsCase.at("name").get<std::string>());
}

QuestionLibrary measuredLibraryOf(const nlohmann::json& setsCase) {
    const nlohmann::json& source = sourceOf(setsCase);
    const nlohmann::json& carried = source.at("columns");
    const nlohmann::json& measures = setsCase.at("measures");

    QuestionLibrary library = questionLibraryOf(source);
    for (const RoleAsked& role : library.roles) {
        if (carried.contains(role.name))
            continue;
        const size_t column = library.columnOf(role.name);
        const nlohmann::json* measured =
            measures.contains(role.name) ? &measures.at(role.name) : nullptr;
        if (measured)
            REQUIRE(measured->size() == library.rows.size());
        for (size_t ordinal = 0; ordinal < library.rows.size(); ++ordinal)
            library.rows[ordinal].at(column) =
                measured ? measured->at(ordinal).get<std::string>() : kUnresolvedValue;
    }
    return library;
}

std::string pathIn(const nlohmann::json& setsCase, const uint32_t ordinal) {
    const nlohmann::json& source = sourceOf(setsCase);
    return source.at("directory").at(ordinal).get<std::string>() +
           source.at("filename").at(ordinal).get<std::string>();
}

std::string titleIn(const nlohmann::json& setsCase, const uint32_t ordinal) {
    return sourceOf(setsCase).at("columns").at("title").at(ordinal).get<std::string>();
}

}  // namespace jean::testing
