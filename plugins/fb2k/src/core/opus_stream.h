#pragma once

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
class OpusStream {
public:
    static constexpr unsigned kSampleRate = 48000;

    // 20 ms, which is Opus's default and what a live stream wants: shorter costs
    // bitrate, longer costs latency.
    static constexpr size_t kFrameSize = kSampleRate / 50;

    // How much audio a page is allowed to gather before it is emitted. libogg's own default
    // is 4096 bytes, which at 128 kbps is a quarter of a second held back before a listener
    // sees a byte; every millisecond of that becomes permanent lag, because the stream is
    // delivered at 1x and a listener never catches up. libogg will not build a page out of
    // fewer than four packets whatever this says, so 80 ms is the floor and asking for less
    // buys nothing.
    static constexpr double kPageSeconds = 0.1;

    OpusStream(unsigned channels, int bitrate);
    ~OpusStream();

    bool ok() const;
    const std::string& error() const;

    // OpusHead and OpusTags. Every listener MUST be sent these before any audio.
    const std::vector<std::uint8_t>& headers() const;

    // Appends whole Ogg pages, so `out` is always safe to hand a listener joining
    // mid-stream. Buffers whatever does not fill a frame.
    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out);

    OpusStream(const OpusStream&) = delete;
    OpusStream& operator=(const OpusStream&) = delete;

private:
    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace jean
