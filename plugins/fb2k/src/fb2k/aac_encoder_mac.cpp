#include "fb2k/aac_encoder.h"

#include <AudioToolbox/AudioToolbox.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace jean {

namespace {

constexpr UInt32 kSampleBytes = sizeof(float);

// Handed back by the input callback once its block is spent. AudioToolbox returns what it has
// converted when the callback fails, and passes the callback's status on, so this is how a call
// ends without telling the converter that the stream did.
constexpr OSStatus kInputSpent = 0x6a6e6d73;

std::string statusWords(OSStatus status) {
    const auto code = static_cast<std::uint32_t>(status);

    std::array<char, 4> characters{};
    for (std::size_t at = 0; at < characters.size(); ++at)
        characters[at] = static_cast<char>(code >> (8U * (3U - at)));

    const bool readable = std::all_of(characters.begin(), characters.end(), [](char character) {
        return character >= 0x20 && character < 0x7f;
    });
    if (!readable)
        return std::to_string(status);

    return "'" + std::string(characters.begin(), characters.end()) + "'";
}

std::string failure(const char* what, OSStatus status) {
    return std::string(what) + " (AudioToolbox answered " + statusWords(status) + ")";
}

struct BlockInput {
    const float* samples = nullptr;
    UInt32 channels = 0;
    UInt32 frames = 0;
    bool handedOver = false;
};

OSStatus handOverBlock(AudioConverterRef /*converter*/, UInt32* packets, AudioBufferList* data,
                       AudioStreamPacketDescription** /*descriptions*/, void* user) {
    auto& input = *static_cast<BlockInput*>(user);
    if (input.handedOver) {
        *packets = 0;
        return kInputSpent;
    }
    input.handedOver = true;

    *packets = input.frames;
    data->mNumberBuffers = 1;
    data->mBuffers[0].mNumberChannels = input.channels;
    data->mBuffers[0].mDataByteSize = input.frames * input.channels * kSampleBytes;
    data->mBuffers[0].mData = const_cast<float*>(input.samples);
    return noErr;
}

class AudioToolboxCodec final : public AacCodec {
public:
    AudioToolboxCodec() = default;
    ~AudioToolboxCodec() override { release(); }

    std::optional<std::string> open(unsigned channels, unsigned sampleRate, int bitrate) override;
    std::optional<std::string> encode(std::span<const float> block,
                                      std::vector<std::vector<std::uint8_t>>& packets) override;

    // AudioToolbox encodes with a reset converter as it does with a new one, priming frames
    // included.
    std::optional<std::string> reset() override {
        if (const OSStatus status = AudioConverterReset(converter_); status != noErr)
            return failure("AudioToolbox failed to reset its AAC encoder", status);
        return std::nullopt;
    }

    void close() override { release(); }

private:
    std::optional<std::string> refuse(std::string reason) {
        release();
        return reason;
    }

    void release() {
        if (converter_ != nullptr)
            static_cast<void>(AudioConverterDispose(converter_));
        converter_ = nullptr;
    }

    AudioConverterRef converter_ = nullptr;
    unsigned channels_ = 0;
    std::vector<std::uint8_t> packet_;
};

std::optional<std::string> AudioToolboxCodec::open(unsigned channels, unsigned sampleRate,
                                                   int bitrate) {
    channels_ = channels;

    AudioStreamBasicDescription pcm{};
    pcm.mSampleRate = sampleRate;
    pcm.mFormatID = kAudioFormatLinearPCM;
    pcm.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    pcm.mChannelsPerFrame = channels;
    pcm.mBitsPerChannel = 8 * kSampleBytes;
    pcm.mBytesPerFrame = channels * kSampleBytes;
    pcm.mFramesPerPacket = 1;
    pcm.mBytesPerPacket = pcm.mBytesPerFrame;

    AudioStreamBasicDescription aac{};
    aac.mSampleRate = sampleRate;
    aac.mFormatID = kAudioFormatMPEG4AAC;
    aac.mChannelsPerFrame = channels;
    aac.mFramesPerPacket = kAacBlockFrames;

    if (const OSStatus status = AudioConverterNew(&pcm, &aac, &converter_); status != noErr) {
        converter_ = nullptr;
        return refuse(failure("AudioToolbox has no AAC encoder for this stream", status));
    }

    // The default mode is a long-term average, which spends almost nothing on silence.
    const UInt32 mode = kAudioCodecBitRateControlMode_Constant;
    if (const OSStatus status = AudioConverterSetProperty(
            converter_, kAudioCodecPropertyBitRateControlMode, sizeof mode, &mode);
        status != noErr)
        return refuse(failure("AudioToolbox refused a constant bitrate", status));

    const auto asked = static_cast<UInt32>(bitrate);
    if (const OSStatus status = AudioConverterSetProperty(converter_, kAudioConverterEncodeBitRate,
                                                          sizeof asked, &asked);
        status != noErr)
        return refuse(failure("AudioToolbox refused this AAC bitrate", status));

    // A bitrate of 0 is accepted and encodes at 128000, so only reading it back tells a refused
    // setting from a replaced one.
    UInt32 got = 0;
    UInt32 size = sizeof got;
    if (const OSStatus status =
            AudioConverterGetProperty(converter_, kAudioConverterEncodeBitRate, &size, &got);
        status != noErr)
        return refuse(failure("AudioToolbox would not say its AAC bitrate", status));
    if (got != asked)
        return refuse("AudioToolbox encodes at " + std::to_string(got) + " bit/s, not the " +
                      std::to_string(asked) + " asked for");

    UInt32 longest = 0;
    size = sizeof longest;
    if (const OSStatus status = AudioConverterGetProperty(
            converter_, kAudioConverterPropertyMaximumOutputPacketSize, &size, &longest);
        status != noErr)
        return refuse(failure("AudioToolbox would not say its longest AAC packet", status));

    packet_.assign(longest, 0);
    return std::nullopt;
}

std::optional<std::string> AudioToolboxCodec::encode(
    std::span<const float> block, std::vector<std::vector<std::uint8_t>>& packets) {
    BlockInput input;
    input.samples = block.data();
    input.channels = channels_;
    input.frames = static_cast<UInt32>(block.size() / channels_);

    // A call hands over the block once and returns the packet it makes of it; the next finds the
    // block spent and returns none.
    for (;;) {
        AudioBufferList output{};
        output.mNumberBuffers = 1;
        output.mBuffers[0].mNumberChannels = channels_;
        output.mBuffers[0].mDataByteSize = static_cast<UInt32>(packet_.size());
        output.mBuffers[0].mData = packet_.data();

        AudioStreamPacketDescription description{};
        UInt32 produced = 1;

        const OSStatus status = AudioConverterFillComplexBuffer(converter_, handOverBlock, &input,
                                                                &produced, &output, &description);
        if (status != noErr && status != kInputSpent)
            return failure("AudioToolbox failed to encode a block", status);

        if (produced == 0)
            return std::nullopt;

        const auto first = static_cast<std::size_t>(description.mStartOffset);
        const std::size_t length = description.mDataByteSize;
        if (first + length > packet_.size())
            return std::string("AudioToolbox answered a packet longer than its buffer");

        const auto begin = packet_.begin() + static_cast<std::ptrdiff_t>(first);
        packets.emplace_back(begin, begin + static_cast<std::ptrdiff_t>(length));
    }
}

}  // namespace

std::unique_ptr<AacCodec> platformAacCodec() {
    return std::make_unique<AudioToolboxCodec>();
}

}  // namespace jean
