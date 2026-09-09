#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace jean {

// AAC-LC in ADTS, through the encoder that ships with Windows. Windows only, so unlike
// core/opus_stream it is not covered by the portable test suite.
class AacEncoder {
public:
    AacEncoder(unsigned channels, unsigned sampleRate, int bitrate);
    ~AacEncoder();

    bool ok() const;
    const std::string& error() const;

    // Interleaved float at the sample rate given to the constructor. Appends whole ADTS
    // frames.
    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out);

    AacEncoder(const AacEncoder&) = delete;
    AacEncoder& operator=(const AacEncoder&) = delete;

private:
    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace jean
