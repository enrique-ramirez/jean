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

    size_t frames() const;
    double seconds() const;
};

// Carries audio from foobar2000's main thread to the encoder thread.
class PcmRing {
public:
    explicit PcmRing(double capacitySeconds);

    // MUST NOT block: the caller is the player's main thread.
    void write(PcmBlock block);

    bool read(PcmBlock& out);

    void close();

    double bufferedSeconds() const;
    double droppedSeconds() const;

    PcmRing(const PcmRing&) = delete;
    PcmRing& operator=(const PcmRing&) = delete;

private:
    double bufferedLocked() const;

    mutable std::mutex mutex_;
    std::condition_variable ready_;
    std::deque<PcmBlock> blocks_;
    const double capacitySeconds_;
    double dropped_ = 0;
    bool closed_ = false;
};

}  // namespace jean
