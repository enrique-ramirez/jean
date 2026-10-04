#pragma once

#include <chrono>
#include <cstddef>
#include <optional>

namespace jean {

constexpr auto kSessionLead = std::chrono::milliseconds(500);

class Pacer {
public:
    using Clock = std::chrono::steady_clock;

    explicit Pacer(std::chrono::milliseconds lead);

    struct Verdict {
        bool release = false;
        Clock::time_point askAgain;
    };

    Verdict ask(size_t frames, unsigned sampleRate, double roomSeconds, Clock::time_point now);

private:
    const Clock::duration lead_;
    std::optional<Clock::time_point> startedAt_;
    double releasedSeconds_ = 0;
};

}  // namespace jean
