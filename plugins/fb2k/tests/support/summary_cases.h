#pragma once

#include "third_party/json.hpp"

namespace jean::testing {

const nlohmann::json& casesIn(const char* fixtureFilename);

const nlohmann::json& librarySummaryCases();

}  // namespace jean::testing
