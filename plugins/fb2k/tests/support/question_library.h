#pragma once

#include "core/library.h"
#include "support/library_routes_server.h"
#include "support/summary_library.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace jean::testing {

const nlohmann::json& questionCase(std::string_view name);

struct QuestionLibrary {
    std::vector<std::string> declared;
    std::vector<RoleAsked> roles;
    std::vector<std::vector<std::string>> rows;

    Snapshot snapshot() const;

    size_t columnOf(std::string_view role) const;

    RowChange changed(uint32_t ordinal, std::string_view role, const std::string& value) const;
};

QuestionLibrary questionLibraryOf(const nlohmann::json& questionCase);

void declareAndBuild(const LibraryRoutesServer& server, Library& library,
                     const QuestionLibrary& questions);

struct Owned {
    std::string name;
    std::string value;
};

std::string questionPath(std::string_view kind, const std::vector<Owned>& owned,
                         const std::vector<RoleAsked>& roles);

std::string questionPathOf(const nlohmann::json& questionCase, const std::vector<RoleAsked>& roles);

nlohmann::json expectedAnswer(const nlohmann::json& questionCase, const Library::State& state);

}  // namespace jean::testing
