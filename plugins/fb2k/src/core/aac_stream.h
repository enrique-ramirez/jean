#pragma once

#include "core/stream.h"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace jean {

// ISO/IEC 14496-3: an AAC-LC access unit is 1024 samples a channel.
constexpr size_t kAacBlockFrames = 1024;

class AacCodec {
public:
    virtual ~AacCodec() = default;

    virtual std::optional<std::string> open(unsigned channels, unsigned sampleRate,
                                            int bitrate) = 0;

    virtual std::optional<std::string> encode(std::span<const float> block,
                                              std::vector<std::vector<std::uint8_t>>& packets) = 0;

    virtual std::optional<std::string> reset() = 0;

    virtual void close() = 0;

    AacCodec(const AacCodec&) = delete;
    AacCodec& operator=(const AacCodec&) = delete;

protected:
    AacCodec() = default;
};

class AacStream : public StreamEncoder {
public:
    AacStream(std::unique_ptr<AacCodec> codec, unsigned channels, unsigned sampleRate, int bitrate);
    ~AacStream() override;

    bool ok() const override;

    const std::string& error() const override;

    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) override;

    void dropHeld() override;

private:
    void fail(std::string message);
    void encodeBlocks(std::vector<std::uint8_t>& out);

    std::unique_ptr<AacCodec> codec_;
    unsigned channels_;
    unsigned frequencyIndex_ = 0;
    bool opened_ = false;

    std::string error_;
    std::atomic<bool> broken_{false};

    std::vector<float> pending_;
    std::vector<std::vector<std::uint8_t>> packets_;
};

}  // namespace jean
