#include "core/local_time.h"

#include <cstdint>
#include <ctime>
#include <limits>
#include <unordered_map>

namespace jean {

namespace {

constexpr int kFirstCalendarYear = 1900;
constexpr uint32_t kYearScale = 10000;
constexpr uint32_t kMonthScale = 100;
constexpr int64_t kMsPerSecond = 1000;

// std::chrono::current_zone is missing from the macOS toolchain, so the zone comes from the C
// library, whose thread-safe localtime is spelled differently on Windows.
bool localCalendar(std::time_t instant, std::tm& calendar) {
#ifdef _WIN32
    return localtime_s(&calendar, &instant) == 0;
#else
    return localtime_r(&instant, &calendar) != nullptr;
#endif
}

constexpr std::time_t kNoInstant = -1;

std::time_t mktimeAt(int year, int month, int day, int hour, int minute, int second) {
    std::tm calendar{};
    calendar.tm_year = year - kFirstCalendarYear;
    calendar.tm_mon = month - 1;
    calendar.tm_mday = day;
    calendar.tm_hour = hour;
    calendar.tm_min = minute;
    calendar.tm_sec = second;
    calendar.tm_isdst = -1;
    return std::mktime(&calendar);
}

int64_t msOrZero(std::time_t instant) {
    return instant == kNoInstant ? 0 : int64_t{instant} * kMsPerSecond;
}

// An hour whose first and last seconds are 3599 s apart has one offset throughout. One holding a
// transition, such as Lord Howe Island's half-hour shift, does not.
class HourCache {
public:
    int64_t epochMs(int year, int month, int day, int hour, int minute, int second) {
        constexpr int kSecondsPerMinute = 60;

        const Hour& known = hourOf(year, month, day, hour);
        if (!known.steady)
            return msOrZero(mktimeAt(year, month, day, hour, minute, second));

        return known.startMs + (((minute * kSecondsPerMinute) + second) * kMsPerSecond);
    }

private:
    struct Hour {
        int64_t startMs = 0;
        bool steady = false;
    };

    const Hour& hourOf(int year, int month, int day, int hour) {
        constexpr int64_t kMonths = 12;
        constexpr int64_t kDays = 31;
        constexpr int64_t kHours = 24;
        constexpr int kLastMinute = 59;
        constexpr int kLastSecond = 59;
        constexpr std::time_t kSecondsInSteadyHour = 3599;
        const int64_t key = (((((year * kMonths) + month) * kDays) + day) * kHours) + hour;

        const auto held = hours_.find(key);
        if (held != hours_.end())
            return held->second;

        const std::time_t first = mktimeAt(year, month, day, hour, 0, 0);
        const std::time_t last = mktimeAt(year, month, day, hour, kLastMinute, kLastSecond);
        const bool steady =
            first != kNoInstant && last != kNoInstant && last - first == kSecondsInSteadyHour;
        return hours_.emplace(key, Hour{msOrZero(first), steady}).first->second;
    }

    std::unordered_map<int64_t, Hour> hours_;
};

uint32_t dateOf(int64_t epochMs) {
    std::tm calendar{};
    if (!localCalendar(static_cast<std::time_t>(epochMs / kMsPerSecond), calendar))
        return 0;

    return ((static_cast<uint32_t>(calendar.tm_year + kFirstCalendarYear)) * kYearScale) +
           (static_cast<uint32_t>(calendar.tm_mon + 1) * kMonthScale) +
           static_cast<uint32_t>(calendar.tm_mday);
}

}  // namespace

LocalTime systemLocalTime() {
    return LocalTime{[hours = HourCache()](int year, int month, int day, int hour, int minute,
                                           int second) mutable {
                         return hours.epochMs(year, month, day, hour, minute, second);
                     },
                     dateOf};
}

}  // namespace jean
