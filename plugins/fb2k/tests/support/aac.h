#pragma once

#include "core/aac_stream.h"
#include "core/stream.h"

#include <cstddef>
#include <memory>
#include <vector>

namespace jean::testing {

constexpr size_t kAacFrameSamples = kAacBlockFrames;

struct AacSetup {
    unsigned channels = 0;
    unsigned sampleRate = 0;
    int bitrate = 0;
};

// This platform's AAC encoder, or null where the suite was built without one.
std::unique_ptr<StreamEncoder> platformAacEncoder(unsigned channels, unsigned sampleRate,
                                                  int bitrate);

struct AacCodecFacts {
    size_t framesHeldBack = 0;
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
