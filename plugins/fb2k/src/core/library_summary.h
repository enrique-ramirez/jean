#pragma once

#include "core/library.h"
#include "core/library_roles.h"
#include "third_party/json.hpp"

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>

namespace jean {

using SummaryRoles = LibraryRoles;

struct LocalTime {
    std::function<int64_t(int year, int month, int day, int hour, int minute, int second)> epochMs;
    std::function<uint32_t(int64_t epochMs)> date;
};

struct SummaryParts {
    bool genres = false;
};

std::string summariseLibrary(const Snapshot& snapshot, const SummaryRoles& roles, int64_t nowMs,
                             const LocalTime& local, SummaryParts parts = {});

inline constexpr int kFirstRealYear = 1000;

std::optional<double> readNumber(std::string_view raw);

std::optional<double> readPlayCount(std::string_view raw);

std::optional<double> readPlayMoment(std::string_view raw, const LocalTime& local);

std::optional<double> higherOf(std::optional<double> a, std::optional<double> b);

double roundHalfUp(double value);

nlohmann::ordered_json numberJson(double value);
nlohmann::ordered_json optionalNumberJson(const std::optional<double>& value);

}  // namespace jean
