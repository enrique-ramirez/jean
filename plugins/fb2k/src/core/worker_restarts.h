#pragma once

#include <chrono>
#include <cstddef>
#include <deque>

namespace jean {

struct WorkerRestart {
    bool halts = false;
    std::chrono::seconds after{0};
};

class WorkerRestarts {
public:
    using Clock = std::chrono::steady_clock;

    WorkerRestart failed(Clock::time_point now);
    void succeeded();

private:
    size_t inARow_ = 0;
    std::deque<Clock::time_point> recent_;
};

}  // namespace jean
