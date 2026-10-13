#pragma once

#include "core/stream.h"

#include <cstddef>
#include <memory>
#include <vector>

namespace jean::testing {

// ISO/IEC 14496-3: an AAC access unit is 1024 samples a channel.
constexpr size_t kAacFrameSamples = 1024;

struct AacSetup {
    unsigned channels = 0;
    unsigned sampleRate = 0;
    int bitrate = 0;
};

// This platform's AAC encoder, or null where the suite was built without one.
std::unique_ptr<StreamEncoder> platformAacEncoder(unsigned channels, unsigned sampleRate,
                                                  int bitrate);

struct AacRefusal {
    AacSetup setup;
    const char* says = "";
};

struct AacCodecFacts {
    size_t framesHeldBack = 0;
    std::vector<AacRefusal> refusals;
};

const AacCodecFacts& platformAacFacts();

enum class AacUnderTest {
    Tested,
    Unavailable,
    NotBuilt,
};

// Decided once a run, by asking for the stereo 48000 Hz stream the component serves, and said
// once in the run's output.
AacUnderTest aacUnderTest();

}  // namespace jean::testing
