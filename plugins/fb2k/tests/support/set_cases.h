#pragma once

#include "support/question_library.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <string>
#include <string_view>

namespace jean::testing {

const nlohmann::json& setCases();

const nlohmann::json& setCase(std::string_view name);

const nlohmann::json& sourceOf(const nlohmann::json& setsCase);

QuestionLibrary measuredLibraryOf(const nlohmann::json& setsCase);

std::string pathIn(const nlohmann::json& setsCase, uint32_t ordinal);

std::string titleIn(const nlohmann::json& setsCase, uint32_t ordinal);

}  // namespace jean::testing
