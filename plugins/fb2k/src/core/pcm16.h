#pragma once

#include <cstddef>
#include <cstdint>
#include <random>
#include <vector>

namespace jean {

constexpr float kLimiterKnee = 0.95F;

float softLimit(float sample);

// Holds the dither's generator, so one converter serves one stream.
class Pcm16Converter {
public:
    void convert(const float* samples, size_t count, std::vector<std::int16_t>& out);

private:
    float triangularNoise();

    std::minstd_rand generator_;
    std::uniform_real_distribution<float> halfStep_{-0.5F, 0.5F};
};

}  // namespace jean
