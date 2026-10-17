#pragma once

#include "core/library.h"
#include "core/library_summary.h"
#include "support/library_routes_server.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace jean::testing {

struct RoleAsked {
    std::string name;
    std::string expression;
};

const std::vector<RoleAsked>& everyRole();

std::vector<RoleAsked> everyRoleBut(const std::vector<std::string>& leftOut);

std::vector<RoleAsked> everyRoleWith(const RoleAsked& replacement);

constexpr char kSpareExpression[] = "%play_counter%";

std::vector<std::string> summaryColumns();
Snapshot summarySnapshot();

RowChange summaryTrackPlayed(uint32_t ordinal, int plays);

constexpr uint32_t kSummaryDate = 20260310;

int64_t localNoon(uint32_t yyyymmdd);

LocalTime localTimeOn(uint32_t yyyymmdd);

void declareAndBuild(const LibraryRoutesServer& server, Library& library);

SummaryRoles summaryRolesFor(const std::vector<RoleAsked>& roles);

std::string summaryPath(const std::vector<RoleAsked>& roles);
std::string exportPath(const std::vector<std::string>& columns);

nlohmann::json expectedSummary(const Library& library, const std::vector<RoleAsked>& roles,
                               int64_t nowMs, uint32_t yyyymmdd);

}  // namespace jean::testing
