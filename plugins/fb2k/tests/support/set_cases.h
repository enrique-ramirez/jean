#pragma once

#include "support/question_library.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <string>

namespace jean::testing {

const nlohmann::json& setCases();

const nlohmann::json& setCase(const std::string& name);

const nlohmann::json& sourceOf(const nlohmann::json& setsCase);

QuestionLibrary measuredLibraryOf(const nlohmann::json& setsCase);

std::string pathIn(const nlohmann::json& setsCase, uint32_t ordinal);

std::string titleIn(const nlohmann::json& setsCase, uint32_t ordinal);

}  // namespace jean::testing
