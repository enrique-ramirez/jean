#include "support/adts.h"

#include <array>

namespace jean::testing {

namespace {

// ISO/IEC 14496-3, the sampling frequency index table. Indices 13 and 14 are reserved and 15
// is an escape ADTS cannot carry.
constexpr std::array<unsigned, 13> kSamplingFrequencies = {
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350};

// ISO/IEC 14496-3, adts_fixed_header then adts_variable_header, most significant bit first:
// syncword 12, ID 1, layer 2, protection_absent 1, profile 2, sampling_frequency_index 4,
// private_bit 1, channel_configuration 3, original_copy 1, home 1,
// copyright_identification_bit 1, copyright_identification_start 1, aac_frame_length 13,
// adts_buffer_fullness 11, number_of_raw_data_blocks_in_frame 2, which is the count less one.
AdtsFrame readHeader(const std::uint8_t* header, size_t offset) {
    const auto byte = [&](size_t index) { return static_cast<unsigned>(header[index]); };

    AdtsFrame frame;
    frame.offset = offset;
    frame.mpeg2 = ((byte(1) >> 3U) & 1U) != 0;
    frame.layer = (byte(1) >> 1U) & 3U;
    frame.protectionAbsent = (byte(1) & 1U) != 0;
    frame.profile = byte(2) >> 6U;
    frame.samplingFrequencyIndex = (byte(2) >> 2U) & 0xFU;
    frame.channelConfiguration = ((byte(2) & 1U) << 2U) | (byte(3) >> 6U);
    frame.length = (size_t{byte(3) & 3U} << 11U) | (size_t{byte(4)} << 3U) | (byte(5) >> 5U);
    frame.bufferFullness = ((byte(5) & 0x1FU) << 6U) | (byte(6) >> 2U);
    frame.rawDataBlocks = (byte(6) & 3U) + 1;
    return frame;
}

bool startsWithSyncWord(const std::uint8_t* header) {
    return header[0] == 0xFF && (header[1] & 0xF0U) == 0xF0U;
}

}  // namespace

size_t AdtsFrame::headerBytes() const {
    return protectionAbsent ? kAdtsHeaderBytes : kAdtsHeaderBytes + kAdtsCrcBytes;
}

AdtsWalk walkAdts(const std::vector<std::uint8_t>& bytes) {
    AdtsWalk walk;

    const auto breakAt = [&](AdtsBreak broke, size_t offset) {
        walk.broke = broke;
        walk.brokeAt = offset;
        return walk;
    };

    size_t at = 0;
    while (at < bytes.size()) {
        const size_t left = bytes.size() - at;
        if (left < kAdtsHeaderBytes)
            return breakAt(AdtsBreak::TrailingBytes, at);

        const std::uint8_t* const header = bytes.data() + at;
        if (!startsWithSyncWord(header))
            return breakAt(AdtsBreak::BadSyncWord, at);

        const AdtsFrame frame = readHeader(header, at);
        if (frame.length < frame.headerBytes())
            return breakAt(AdtsBreak::LengthShorterThanHeader, at);
        if (frame.length > left)
            return breakAt(AdtsBreak::LengthOverruns, at);

        walk.frames.push_back(frame);
        at += frame.length;
    }

    return walk;
}

const char* describeBreak(AdtsBreak broke) {
    switch (broke) {
        case AdtsBreak::None:
            return "whole frames";
        case AdtsBreak::BadSyncWord:
            return "no sync word where a frame should start";
        case AdtsBreak::TrailingBytes:
            return "fewer bytes than a header after the last frame";
        case AdtsBreak::LengthShorterThanHeader:
            return "a frame length shorter than its own header";
        case AdtsBreak::LengthOverruns:
            return "a frame length running past the end";
    }

    return "an unknown break";
}

std::optional<unsigned> adtsSamplingFrequencyIndex(unsigned sampleRate) {
    for (unsigned index = 0; index < kSamplingFrequencies.size(); ++index) {
        if (kSamplingFrequencies[index] == sampleRate)
            return index;
    }

    return std::nullopt;
}

}  // namespace jean::testing
