#include "core/pacer.h"

#include <algorithm>

namespace jean {

namespace {

// Rounded up, so an instant answered as askAgain is never a nanosecond short of the due one: a
// block's length is seldom a whole number of nanoseconds.
Pacer::Clock::duration atLeast(double seconds) {
    return std::chrono::ceil<Pacer::Clock::duration>(std::chrono::duration<double>(seconds));
}

}  // namespace

Pacer::Pacer(std::chrono::milliseconds lead) : lead_(lead) {}

Pacer::Verdict Pacer::ask(size_t frames, unsigned sampleRate, double roomSeconds,
                          Clock::time_point now) {
    if (frames == 0 || sampleRate == 0)
        return {true, now};

    const double blockSeconds = static_cast<double>(frames) / sampleRate;

    if (!startedAt_)
        startedAt_ = now;

    Clock::time_point due = *startedAt_ + atLeast(releasedSeconds_) - lead_;
    if (now - due > lead_) {
        startedAt_ = now;
        releasedSeconds_ = 0;
        due = now - lead_;
    }

    if (now < due)
        return {false, due};

    if (roomSeconds < blockSeconds) {
        const auto shortfall = std::chrono::duration_cast<Clock::duration>(
            std::chrono::duration<double>(blockSeconds - roomSeconds));
        return {false, now + std::max(shortfall, Clock::duration(1))};
    }

    releasedSeconds_ += blockSeconds;
    return {true, now};
}

}  // namespace jean
