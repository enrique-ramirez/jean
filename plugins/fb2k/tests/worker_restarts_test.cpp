#include "third_party/doctest.h"

#include "core/worker_restarts.h"

#include <chrono>
#include <vector>

using namespace jean;
using namespace std::chrono;

namespace {

constexpr steady_clock::time_point kStart{seconds(1000)};
constexpr auto kHaltWindow = minutes(10);

}  // namespace

TEST_CASE("failures in a row wait one, five, then fifteen seconds, and fifteen after that") {
    WorkerRestarts restarts;
    std::vector<seconds> waits;

    for (int failure = 0; failure < 4; ++failure) {
        const auto restart = restarts.failed(kStart + failure * kHaltWindow);
        REQUIRE_FALSE(restart.halts);
        waits.push_back(restart.after);
    }

    CHECK(waits == std::vector<seconds>{seconds(1), seconds(5), seconds(15), seconds(15)});
}

TEST_CASE("a third failure within ten minutes of the first halts the worker") {
    WorkerRestarts restarts;

    CHECK_FALSE(restarts.failed(kStart).halts);
    CHECK_FALSE(restarts.failed(kStart + minutes(4)).halts);
    CHECK(restarts.failed(kStart + kHaltWindow - seconds(1)).halts);
}

TEST_CASE("a failure ten minutes after the first no longer counts it towards a halt") {
    WorkerRestarts restarts;

    CHECK_FALSE(restarts.failed(kStart).halts);
    CHECK_FALSE(restarts.failed(kStart + minutes(4)).halts);

    const auto third = restarts.failed(kStart + kHaltWindow);
    CHECK_FALSE(third.halts);
    CHECK(third.after == seconds(15));
}

TEST_CASE("a run that finishes starts the count again") {
    WorkerRestarts restarts;
    REQUIRE_FALSE(restarts.failed(kStart).halts);
    REQUIRE_FALSE(restarts.failed(kStart + seconds(1)).halts);

    restarts.succeeded();

    const auto first = restarts.failed(kStart + seconds(2));
    const auto second = restarts.failed(kStart + seconds(3));
    CHECK_FALSE(first.halts);
    CHECK(first.after == seconds(1));
    CHECK_FALSE(second.halts);
    CHECK(second.after == seconds(5));
}
