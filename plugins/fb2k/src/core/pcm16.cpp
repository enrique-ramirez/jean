#include "core/pcm16.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace jean {

namespace {

constexpr float kFullScale = std::numeric_limits<std::int16_t>::max();
constexpr float kLowest = std::numeric_limits<std::int16_t>::min();

}  // namespace

float softLimit(float sample) {
    const float magnitude = std::fabs(sample);
    if (magnitude <= kLimiterKnee)
        return sample;

    const float room = 1.0F - kLimiterKnee;
    const float over = (magnitude - kLimiterKnee) / room;
    const float limited = kLimiterKnee + (room * over / (1.0F + over));
    return std::copysign(limited, sample);
}

float Pcm16Converter::triangularNoise() {
    return halfStep_(generator_) + halfStep_(generator_);
}

void Pcm16Converter::convert(const float* samples, size_t count, std::vector<std::int16_t>& out) {
    out.resize(count);
    std::transform(samples, samples + count, out.begin(), [this](float sample) {
        const float dithered = (softLimit(sample) * kFullScale) + triangularNoise();
        return static_cast<std::int16_t>(std::lround(std::clamp(dithered, kLowest, kFullScale)));
    });
}

}  // namespace jean
