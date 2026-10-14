#include "core/aac_stream.h"

#include "core/settings.h"

#include <algorithm>
#include <utility>

namespace jean {

namespace {

// ISO/IEC 14496-3 sampling frequency indices, for the two rates the stream serves.
std::optional<unsigned> samplingFrequencyIndex(unsigned sampleRate) {
    switch (sampleRate) {
        case 48000:
            return 3;
        case 44100:
            return 4;
        default:
            return std::nullopt;
    }
}

constexpr size_t kAdtsHeaderBytes = 7;

// aac_frame_length is 13 bits and counts the header.
constexpr size_t kMaxAdtsFrameBytes = 0x1FFF;
constexpr size_t kMaxPayloadBytes = kMaxAdtsFrameBytes - kAdtsHeaderBytes;

void appendAdtsHeader(std::vector<std::uint8_t>& out, size_t payload, unsigned frequencyIndex,
                      unsigned channels) {
    const size_t total = payload + kAdtsHeaderBytes;

    out.push_back(0xff);
    out.push_back(0xf1);  // MPEG-4, layer 0, no CRC
    out.push_back(
        static_cast<std::uint8_t>((1U << 6U) | (frequencyIndex << 2U) | ((channels >> 2U) & 1U)));
    out.push_back(static_cast<std::uint8_t>(((channels & 3U) << 6U) | ((total >> 11U) & 3U)));
    out.push_back(static_cast<std::uint8_t>((total >> 3U) & 0xffU));
    out.push_back(static_cast<std::uint8_t>(((total & 7U) << 5U) | 0x1fU));
    out.push_back(0xfc);
}

std::string listedBitrates() {
    std::string list;
    for (const int bitrate : kAacBitrates)
        list += (list.empty() ? "" : ", ") + std::to_string(bitrate);
    return list;
}

}  // namespace

AacStream::AacStream(std::unique_ptr<AacCodec> codec, unsigned channels, unsigned sampleRate,
                     int bitrate)
    : codec_(std::move(codec)), channels_(channels) {
    if (channels != 1 && channels != 2) {
        fail("AAC streaming takes 1 or 2 channels, not " + std::to_string(channels));
        return;
    }

    const auto index = samplingFrequencyIndex(sampleRate);
    if (!index) {
        fail("AAC streaming takes 44100 or 48000 Hz only, not " + std::to_string(sampleRate) +
             " Hz");
        return;
    }
    frequencyIndex_ = *index;

    if (std::find(std::begin(kAacBitrates), std::end(kAacBitrates), bitrate) ==
        std::end(kAacBitrates)) {
        fail("the AAC bitrate must be one of " + listedBitrates() + " bit/s, not " +
             std::to_string(bitrate));
        return;
    }

    if (const auto refused = codec_->open(channels, sampleRate, bitrate)) {
        fail(*refused);
        return;
    }
    opened_ = true;
}

AacStream::~AacStream() {
    if (opened_)
        codec_->close();
}

bool AacStream::ok() const {
    return !broken_.load();
}

const std::string& AacStream::error() const {
    return error_;
}

void AacStream::fail(std::string message) {
    if (broken_.load())
        return;

    error_ = std::move(message);
    broken_.store(true);
    pending_.clear();
}

void AacStream::write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) {
    if (broken_.load() || frames == 0)
        return;

    pending_.insert(pending_.end(), samples, samples + (frames * channels_));
    encodeBlocks(out);
}

void AacStream::dropHeld() {
    pending_.clear();
    if (!opened_ || broken_.load())
        return;

    if (const auto failure = (*codec_).reset())
        fail(*failure);
}

void AacStream::encodeBlocks(std::vector<std::uint8_t>& out) {
    const size_t blockSamples = kAacBlockFrames * channels_;

    size_t consumed = 0;
    while (pending_.size() - consumed >= blockSamples) {
        packets_.clear();
        const std::span<const float> block(pending_.data() + consumed, blockSamples);
        consumed += blockSamples;

        if (const auto failure = codec_->encode(block, packets_)) {
            fail(*failure);
            return;
        }

        const bool tooLong = std::any_of(packets_.begin(), packets_.end(), [](const auto& packet) {
            return packet.size() > kMaxPayloadBytes;
        });
        if (tooLong) {
            fail("the AAC encoder made a packet longer than a stream header can declare");
            return;
        }

        for (const auto& packet : packets_) {
            appendAdtsHeader(out, packet.size(), frequencyIndex_, channels_);
            out.insert(out.end(), packet.begin(), packet.end());
        }
    }

    pending_.erase(pending_.begin(), pending_.begin() + static_cast<std::ptrdiff_t>(consumed));
}

}  // namespace jean
