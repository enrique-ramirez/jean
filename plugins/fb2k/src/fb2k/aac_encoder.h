#pragma once

#include "core/stream.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace jean {

// AAC-LC in ADTS, through the encoder that ships with Windows. Windows only, so unlike
// core/opus_stream it is not covered by the portable test suite.
class AacEncoder : public StreamEncoder {
public:
    AacEncoder(unsigned channels, unsigned sampleRate, int bitrate);
    ~AacEncoder() override;

    bool ok() const override;
    const std::string& error() const override;

    // Interleaved float at the sample rate given to the constructor. Appends whole ADTS
    // frames.
    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) override;

private:
    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace jean
