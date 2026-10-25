#pragma once

#include "core/library_summary.h"
#include "third_party/json.hpp"

#include <cstdint>

namespace jean::testing {

const nlohmann::json& casesIn(const char* fixtureFilename);

const nlohmann::json& librarySummaryCases();

// Asia/Kolkata, the zone library_summary_cases.json and library_sets_cases.json were frozen in.
LocalTime kolkataTime();

int64_t onThisMachine(int64_t epochMs);

}  // namespace jean::testing
