#include "support/pcm.h"

#include <algorithm>
#include <cmath>
#include <random>

namespace jean::testing {

namespace {

constexpr double kTwoPi = 6.283185307179586;
constexpr double kToneHz = 440.0;
constexpr float kToneLevel = 0.4F;
constexpr float kNoiseLevel = 0.1F;

constexpr size_t kLongestIrregularBlock = 3000;
constexpr unsigned kOneBlockInThisManyIsEmpty = 8;

// The C++ standard fixes std::mt19937's output for a seed and leaves every distribution's to the
// library, so the generator's own bits are what is the same under MSVC, libc++ and libstdc++.
float unitNoise(std::mt19937& generator) {
    const float zeroToOne = static_cast<float>(generator() >> 8U) / 16777216.0F;
    return (zeroToOne * 2.0F) - 1.0F;
}

}  // namespace

std::vector<float> silence(size_t frames, unsigned channels) {
    return std::vector<float>(frames * channels, 0.0F);
}

std::vector<float> toneUnderNoise(size_t frames, unsigned channels, unsigned sampleRate) {
    // NOLINTNEXTLINE(bugprone-random-generator-seed,cert-msc32-c,cert-msc51-cpp)
    std::mt19937 generator(7);

    std::vector<float> pcm(frames * channels);
    for (size_t frame = 0; frame < frames; ++frame) {
        const auto tone =
            kToneLevel * static_cast<float>(std::sin(kTwoPi * kToneHz * static_cast<double>(frame) /
                                                     static_cast<double>(sampleRate)));
        for (unsigned channel = 0; channel < channels; ++channel)
            pcm[(frame * channels) + channel] = tone + (kNoiseLevel * unitNoise(generator));
    }

    return pcm;
}

std::vector<size_t> irregularBlocks(size_t frames) {
    // NOLINTNEXTLINE(bugprone-random-generator-seed,cert-msc32-c,cert-msc51-cpp)
    std::mt19937 generator(11);

    std::vector<size_t> blocks;
    size_t left = frames;
    while (left > 0) {
        const bool empty = generator() % kOneBlockInThisManyIsEmpty == 0;
        const size_t block =
            empty ? 0 : std::min<size_t>(left, 1 + (generator() % kLongestIrregularBlock));
        blocks.push_back(block);
        left -= block;
    }

    return blocks;
}

}  // namespace jean::testing
