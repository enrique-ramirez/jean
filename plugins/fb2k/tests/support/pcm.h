#pragma once

#include <cstddef>
#include <vector>

namespace jean::testing {

std::vector<float> silence(size_t frames, unsigned channels);

// A 440 Hz sine on every channel under noise of its own on each, the same on every run and under
// every standard library.
std::vector<float> toneUnderNoise(size_t frames, unsigned channels, unsigned sampleRate);

// Block sizes adding up to `frames`, some of them zero, the same on every run and under every
// standard library.
std::vector<size_t> irregularBlocks(size_t frames);

}  // namespace jean::testing
