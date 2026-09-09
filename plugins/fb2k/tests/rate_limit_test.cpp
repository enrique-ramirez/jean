// RateLimiter::allow takes the time rather than reading a clock, so nothing here sleeps: a
// rate limit asserted by sleeping is a test that fails on a loaded machine.

#include "third_party/doctest.h"

#include "core/rate_limit.h"

using namespace jean;
using namespace std::chrono;

namespace {

constexpr steady_clock::time_point kStart{seconds(1000)};

steady_clock::time_point at(int64_t millis) {
    return kStart + milliseconds(millis);
}

}  // namespace

TEST_CASE("a full bucket lets a burst through and then stops") {
    RateLimiter limiter(3, seconds(1));

    CHECK(limiter.allow(kStart));
    CHECK(limiter.allow(kStart));
    CHECK(limiter.allow(kStart));
    CHECK_FALSE(limiter.allow(kStart));
}

TEST_CASE("tokens come back at the rate they are refilled") {
    RateLimiter limiter(2, seconds(1));

    CHECK(limiter.allow(kStart));
    CHECK(limiter.allow(kStart));
    CHECK_FALSE(limiter.allow(kStart));

    CHECK_FALSE(limiter.allow(at(999)));
    CHECK(limiter.allow(at(1000)));
    CHECK_FALSE(limiter.allow(at(1000)));
    CHECK(limiter.allow(at(2000)));
}

TEST_CASE("fractions of a token accumulate rather than being rounded away") {
    RateLimiter limiter(1, seconds(1));

    CHECK(limiter.allow(kStart));

    for (int64_t millis = 1; millis < 1000; millis++)
        CHECK_FALSE(limiter.allow(at(millis)));

    CHECK(limiter.allow(at(1000)));
}

TEST_CASE("the bucket does not fill beyond its burst however long nobody asks") {
    RateLimiter limiter(2, seconds(1));

    CHECK(limiter.allow(at(3600'000)));
    CHECK(limiter.allow(at(3600'000)));
    CHECK_FALSE(limiter.allow(at(3600'000)));
}

TEST_CASE("the first request, the one with no history behind it, is allowed") {
    RateLimiter limiter(1, hours(1));
    CHECK(limiter.allow(kStart));
}
