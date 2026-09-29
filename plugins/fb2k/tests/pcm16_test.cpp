#include "third_party/doctest.h"

#include "core/pcm16.h"

#include <algorithm>
#include <cstdint>
#include <numeric>
#include <vector>

using namespace jean;

namespace {

constexpr size_t kManySamples = 200000;

double meanOf(const std::vector<std::int16_t>& samples) {
    const double total = std::accumulate(samples.begin(), samples.end(), 0.0);
    return total / static_cast<double>(samples.size());
}

std::vector<std::int16_t> convertedConstant(float level, size_t count) {
    const std::vector<float> input(count, level);
    std::vector<std::int16_t> output;
    Pcm16Converter converter;
    converter.convert(input.data(), input.size(), output);
    return output;
}

}  // namespace

// Resampling a loud master and a positive ReplayGain both produce samples past full scale.
TEST_CASE("a sample above full scale comes out below the 16-bit ceiling") {
    std::vector<float> overs;
    constexpr int kSteps = 100;
    for (int step = 0; step <= kSteps; ++step) {
        const float level = 1.0F + (static_cast<float>(step) / kSteps);
        overs.push_back(level);
        overs.push_back(-level);
    }

    std::vector<std::int16_t> output;
    Pcm16Converter converter;
    converter.convert(overs.data(), overs.size(), output);

    REQUIRE(output.size() == overs.size());
    CHECK(*std::max_element(output.begin(), output.end()) < 32767);
    CHECK(*std::min_element(output.begin(), output.end()) > -32767);
}

TEST_CASE("a louder over still comes out louder, so its top is rounded rather than flat") {
    float previous = softLimit(1.0F);
    constexpr int kSteps = 60;
    for (int step = 1; step <= kSteps; ++step) {
        const float level = 1.0F + (static_cast<float>(step) * 0.05F);
        const float limited = softLimit(level);
        CHECK(limited > previous);
        CHECK(limited < 1.0F);
        CHECK(softLimit(-level) == -limited);
        previous = limited;
    }
}

TEST_CASE("a sample well inside full scale passes the limiter untouched") {
    CHECK(softLimit(0.5F) == 0.5F);
    CHECK(softLimit(-0.9F) == -0.9F);
    CHECK(softLimit(0.0F) == 0.0F);

    CHECK(meanOf(convertedConstant(0.5F, kManySamples)) ==
          doctest::Approx(0.5 * 32767).epsilon(0.0001));
}

TEST_CASE("dither adds nothing on average") {
    const auto output = convertedConstant(0.0F, kManySamples);

    CHECK(meanOf(output) == doctest::Approx(0.0).epsilon(0.01));
    CHECK(*std::max_element(output.begin(), output.end()) <= 1);
    CHECK(*std::min_element(output.begin(), output.end()) >= -1);
    CHECK(std::any_of(output.begin(), output.end(), [](std::int16_t s) { return s != 0; }));
}

// Without dither, rounding turns a level this quiet into silence; with it, the level survives
// as the average of the noise around it.
TEST_CASE("a level finer than one 16-bit step survives on average") {
    const float quarterStep = 0.25F / 32767.0F;

    CHECK(meanOf(convertedConstant(quarterStep, kManySamples)) ==
          doctest::Approx(0.25).epsilon(0.02));
}
