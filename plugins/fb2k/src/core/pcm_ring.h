#pragma once

#include "core/timeline.h"

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <mutex>
#include <optional>
#include <vector>

namespace jean {

struct AudioSpec {
    unsigned sampleRate = 0;
    unsigned channels = 0;
};

bool operator==(const AudioSpec& a, const AudioSpec& b);
inline bool operator!=(const AudioSpec& a, const AudioSpec& b) {
    return !(a == b);
}

// The spec travels per block: a mixed-rate library changes it at a track boundary.
struct PcmBlock {
    AudioSpec spec;

    // Interleaved.
    std::vector<float> samples;

    // Set on the first block after a track change or a seek; see ARCHITECTURE.md, *The
    // audio path*, for why it travels with the block rather than being read separately.
    std::optional<StreamMark> mark;

    // The first block after a seek, a skip or a play from stopped: nothing from before it may
    // still be heard ahead of it.
    bool cut = false;

    size_t frames() const;
    double seconds() const;
};

// Carries audio from foobar2000's main thread to the encoder thread.
class PcmRing {
public:
    explicit PcmRing(double capacitySeconds);

    // MUST NOT block: the engine's writer is foobar2000's main thread.
    void write(PcmBlock block);

    // Seconds a write can add before the oldest block is dropped, never negative, and 0 once
    // closed. Only a writer that must not lose audio asks, and since it is the only writer, the
    // room can only grow between the ask and the write.
    double roomSeconds() const;

    bool read(PcmBlock& out);

    void close();

    size_t waitingReaders() const;

    PcmRing(const PcmRing&) = delete;
    PcmRing& operator=(const PcmRing&) = delete;

private:
    PcmBlock takeFrontLocked();

    mutable std::mutex mutex_;
    std::condition_variable ready_;
    std::deque<PcmBlock> blocks_;
    double bufferedSeconds_ = 0.0;
    const double capacitySeconds_;
    bool closed_ = false;
    size_t waiting_ = 0;
};

}  // namespace jean
