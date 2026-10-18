#pragma once

#include "core/library.h"
#include "core/library_roles.h"

#include <cstdint>
#include <functional>
#include <optional>
#include <string>

namespace jean {

using SummaryRoles = LibraryRoles;

struct LocalTime {
    std::function<int64_t(int year, int month, int day, int hour, int minute, int second)> epochMs;
    std::function<uint32_t(int64_t epochMs)> date;
};

std::string summariseLibrary(const Snapshot& snapshot, const SummaryRoles& roles, int64_t nowMs,
                             const LocalTime& local);

}  // namespace jean
