#include "support/summary_cases.h"

#include "core/local_time.h"
#include "support/repository.h"

#include "third_party/doctest.h"

#include <fstream>
#include <iterator>
#include <map>
#include <mutex>
#include <string>

namespace jean::testing {

namespace {

constexpr int64_t kMsPerSecond = 1000;
constexpr int64_t kMsPerMinute = 60 * kMsPerSecond;
constexpr int64_t kMsPerHour = 60 * kMsPerMinute;
constexpr int64_t kMsPerDay = 24 * kMsPerHour;

// UTC+05:30 all year, with no daylight saving.
constexpr int64_t kZoneOffsetMs = (5 * kMsPerHour) + (30 * kMsPerMinute);

struct Civil {
    int year = 0;
    int month = 0;
    int day = 0;
    int hour = 0;
    int minute = 0;
    int second = 0;
};

int64_t daysFromCivil(int year, const int month, const int day) {
    year -= month <= 2 ? 1 : 0;
    const int64_t era = (year >= 0 ? year : year - 399) / 400;
    const int64_t yearOfEra = year - (era * 400);
    const int64_t dayOfYear = (((153 * (month > 2 ? month - 3 : month + 9)) + 2) / 5) + day - 1;
    const int64_t dayOfEra = (yearOfEra * 365) + (yearOfEra / 4) - (yearOfEra / 100) + dayOfYear;
    return (era * 146097) + dayOfEra - 719468;
}

int64_t floorDivide(const int64_t value, const int64_t divisor) {
    return (value >= 0 ? value : value - divisor + 1) / divisor;
}

Civil civilOf(const int64_t localMs) {
    int64_t days = floorDivide(localMs, kMsPerDay);
    const int64_t within = localMs - (days * kMsPerDay);
    days += 719468;
    const int64_t era = (days >= 0 ? days : days - 146096) / 146097;
    const int64_t dayOfEra = days - (era * 146097);
    const int64_t yearOfEra =
        (dayOfEra - (dayOfEra / 1460) + (dayOfEra / 36524) - (dayOfEra / 146096)) / 365;
    const int64_t dayOfYear = dayOfEra - ((365 * yearOfEra) + (yearOfEra / 4) - (yearOfEra / 100));
    const int64_t shiftedMonth = ((5 * dayOfYear) + 2) / 153;
    const int64_t month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
    return Civil{static_cast<int>(yearOfEra + (era * 400) + (month <= 2 ? 1 : 0)),
                 static_cast<int>(month),
                 static_cast<int>(dayOfYear - (((153 * shiftedMonth) + 2) / 5) + 1),
                 static_cast<int>(within / kMsPerHour),
                 static_cast<int>(within % kMsPerHour / kMsPerMinute),
                 static_cast<int>(within % kMsPerMinute / kMsPerSecond)};
}

}  // namespace

const nlohmann::json& casesIn(const char* fixtureFilename) {
    static std::mutex lock;
    static std::map<std::string, nlohmann::json> parsed;

    const std::lock_guard<std::mutex> guard(lock);
    const auto held = parsed.find(fixtureFilename);
    if (held != parsed.end())
        return held->second;

    const std::string path = repositoryRoot() + "plugins/fb2k/tests/fixtures/" + fixtureFilename;
    std::ifstream file(path, std::ios::binary);
    REQUIRE_MESSAGE(file.is_open(), "cannot read ", path);
    return parsed
        .emplace(fixtureFilename, nlohmann::json::parse(std::istreambuf_iterator<char>(file),
                                                        std::istreambuf_iterator<char>()))
        .first->second;
}

const nlohmann::json& librarySummaryCases() {
    return casesIn("library_summary_cases.json");
}

LocalTime kolkataTime() {
    return LocalTime{
        [](const int year, const int month, const int day, const int hour, const int minute,
           const int second) {
            const int64_t seconds = (((int64_t{hour} * 60) + minute) * 60) + second;
            return (daysFromCivil(year, month, day) * kMsPerDay) + (seconds * kMsPerSecond) -
                   kZoneOffsetMs;
        },
        [](const int64_t epochMs) {
            const Civil civil = civilOf(epochMs + kZoneOffsetMs);
            return static_cast<uint32_t>((civil.year * 10000) + (civil.month * 100) + civil.day);
        },
    };
}

int64_t onThisMachine(const int64_t epochMs) {
    const Civil civil = civilOf(epochMs + kZoneOffsetMs);
    return systemLocalTime().epochMs(civil.year, civil.month, civil.day, civil.hour, civil.minute,
                                     civil.second);
}

}  // namespace jean::testing
