#pragma once

#include "core/stream.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace jean {

// Encodes interleaved 48 kHz float into one continuous Ogg Opus stream.
//
// Opus accepts 8, 12, 16, 24 or 48 kHz only, so callers MUST resample before this.
// Samples MAY exceed +/-1.0; libopus clamps them.
//
// The stream never restarts. A track change is not a new logical stream, because Firefox
// stops at the first chained Ogg boundary (bug 455165) and the symptom is audio that
// freezes while bytes keep arriving.
class OpusStream : public StreamEncoder {
public:
    static constexpr unsigned kSampleRate = 48000;

    // 20 ms, which is Opus's default and what a live stream wants: shorter costs
    // bitrate, longer costs latency.
    static constexpr size_t kFrameSize = kSampleRate / 50;

    // How much audio a page carries. Every millisecond of it becomes permanent lag, because the
    // stream is delivered at 1x and a listener never catches up. A page is cut by duration rather
    // than by libogg's byte count, because libopus spends three bytes on a frame of silence, and a
    // byte count would hold a quiet passage back until the listener ran dry.
    static constexpr double kPageSeconds = 0.1;

    OpusStream(unsigned channels, int bitrate);
    ~OpusStream() override;

    bool ok() const override;
    const std::string& error() const override;

    // OpusHead and OpusTags. Every listener MUST be sent these before any audio.
    const std::vector<std::uint8_t>& headers() const;

    // Appends whole Ogg pages, so `out` is always safe to hand a listener joining
    // mid-stream. Buffers whatever does not fill a frame.
    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) override;

    void dropHeld() override;
    size_t heldFrames() const override;
    unsigned channels() const override;

private:
    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace jean
