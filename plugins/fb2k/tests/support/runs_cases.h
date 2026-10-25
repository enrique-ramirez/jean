#pragma once

#include "core/library.h"
#include "core/library_roles.h"
#include "support/question_library.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace jean::testing {

struct RunsCase {
    std::string name;
    QuestionLibrary library;
    std::vector<uint32_t> lengths;
    std::vector<uint32_t> covers;
    std::vector<uint32_t> untagged;
};

const nlohmann::json& runsCases();

RunsCase runsCaseOf(const nlohmann::json& expected);

RunsCase runsCase(std::string_view name);

std::map<std::string, std::string> expressionsOf(const QuestionLibrary& library);

LibraryRoles rolesOf(const Snapshot& snapshot, const QuestionLibrary& library);

std::string runsPath(const std::vector<RoleAsked>& roles);

}  // namespace jean::testing
