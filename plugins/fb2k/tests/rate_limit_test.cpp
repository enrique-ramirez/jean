// RateLimiter::allow takes the time rather than reading a clock, so nothing here sleeps: a
// rate limit asserted by sleeping is a test that fails on a loaded machine.

#include "third_party/doctest.h"

#include "core/rate_limit.h"

#include <atomic>
#include <cstddef>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace std::chrono;

namespace {

constexpr steady_clock::time_point kStart{seconds(1000)};

steady_clock::time_point at(int64_t millis) {
    return kStart + milliseconds(millis);
}

constexpr int kPollBurst = 30;
constexpr auto kPollRefill = milliseconds(100);

constexpr size_t kTrackedClients = 256;

constexpr const char* kPhone = "192.168.1.20";
constexpr const char* kLaptop = "192.168.1.21";

steady_clock::time_point atMicros(int64_t micros) {
    return kStart + microseconds(micros);
}

std::string address(size_t index) {
    return "10.0." + std::to_string(index / 256) + "." + std::to_string(index % 256);
}

void spendBurst(PerClientRateLimiter& limiter, const char* client, steady_clock::time_point now) {
    for (int i = 0; i < kPollBurst; i++)
        limiter.allow(client, now);
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

TEST_CASE("one address spending its whole budget does not refuse another") {
    PerClientRateLimiter limiter(kPollBurst, kPollRefill);

    for (int i = 0; i < kPollBurst; i++)
        CHECK(limiter.allow(kPhone, kStart));
    CHECK_FALSE(limiter.allow(kPhone, kStart));

    for (int i = 0; i < kPollBurst; i++)
        CHECK(limiter.allow(kLaptop, kStart));
    CHECK_FALSE(limiter.allow(kLaptop, kStart));

    CHECK_FALSE(limiter.allow(kPhone, kStart));
}

TEST_CASE("an address gets a token back every hundred milliseconds, ten polls a second") {
    PerClientRateLimiter limiter(kPollBurst, kPollRefill);

    spendBurst(limiter, kPhone, kStart);
    CHECK_FALSE(limiter.allow(kPhone, kStart));

    CHECK_FALSE(limiter.allow(kPhone, at(99)));
    CHECK(limiter.allow(kPhone, at(100)));
    CHECK_FALSE(limiter.allow(kPhone, at(100)));

    for (int64_t poll = 0; poll < 10; poll++)
        CHECK(limiter.allow(kPhone, at(200 + (poll * 100))));
}

TEST_CASE("an address that will not stop asking keeps its empty bucket") {
    PerClientRateLimiter limiter(kPollBurst, kPollRefill);

    spendBurst(limiter, kPhone, kStart);
    CHECK_FALSE(limiter.allow(kPhone, kStart));

    int allowed = 0;
    for (size_t i = 0; i < 4 * kTrackedClients; i++) {
        const auto now = atMicros(static_cast<int64_t>(i) + 1);
        limiter.allow(address(i), now);
        if (limiter.allow(kPhone, now))
            allowed++;
    }

    CHECK(allowed == 0);
}

TEST_CASE("a bucket survives 255 other addresses arriving after it") {
    PerClientRateLimiter limiter(kPollBurst, kPollRefill);

    spendBurst(limiter, kPhone, kStart);

    for (size_t i = 0; i + 1 < kTrackedClients; i++)
        limiter.allow(address(i), atMicros(static_cast<int64_t>(i) + 1));

    CHECK_FALSE(limiter.allow(kPhone, atMicros(kTrackedClients)));
}

TEST_CASE("the address that stopped asking is the one dropped when a 257th arrives") {
    PerClientRateLimiter limiter(kPollBurst, kPollRefill);

    spendBurst(limiter, kPhone, kStart);

    for (size_t i = 0; i < kTrackedClients; i++)
        limiter.allow(address(i), atMicros(static_cast<int64_t>(i) + 1));

    CHECK(limiter.allow(kPhone, atMicros(kTrackedClients + 1)));
}

TEST_CASE("connection threads asking for one address spend one bucket between them") {
    PerClientRateLimiter limiter(kPollBurst, kPollRefill);

    std::atomic<int> allowed{0};
    std::vector<std::thread> threads;

    for (int worker = 0; worker < 8; worker++)
        threads.emplace_back([&limiter, &allowed] {
            for (int i = 0; i < 100; i++)
                if (limiter.allow(kPhone, kStart))
                    allowed++;
        });

    for (auto& thread : threads)
        thread.join();

    CHECK(allowed.load() == kPollBurst);
}
