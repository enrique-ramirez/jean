#include "core/worker_restarts.h"

#include <algorithm>
#include <array>

namespace jean {

namespace {

using std::chrono::seconds;

constexpr std::array<seconds, 3> kRestartAfter{seconds(1), seconds(5), seconds(15)};
constexpr auto kHaltWindow = std::chrono::minutes(10);
constexpr size_t kFailuresThatHalt = 3;

}  // namespace

WorkerRestart WorkerRestarts::failed(Clock::time_point now) {
    while (!recent_.empty() && now - recent_.front() >= kHaltWindow)
        recent_.pop_front();
    recent_.push_back(now);
    ++inARow_;

    if (recent_.size() >= kFailuresThatHalt)
        return {true, seconds(0)};

    return {false, kRestartAfter[std::min(inARow_, kRestartAfter.size()) - 1]};
}

void WorkerRestarts::succeeded() {
    inARow_ = 0;
    recent_.clear();
}

}  // namespace jean
