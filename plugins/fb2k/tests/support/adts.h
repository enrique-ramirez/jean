#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <vector>

namespace jean::testing {

// ISO/IEC 14496-3, adts_fixed_header and adts_variable_header: 56 bits when protection_absent is
// set, and a 16-bit CRC after them when it is not.
constexpr size_t kAdtsHeaderBytes = 7;
constexpr size_t kAdtsCrcBytes = 2;

// ISO/IEC 14496-3: ADTS carries the audio object type less one, and AAC-LC is object type 2.
constexpr unsigned kAdtsProfileLc = 1;

// ISO/IEC 14496-3: an adts_buffer_fullness of all ones says the stream is variable bitrate.
constexpr unsigned kAdtsVariableBitrate = 0x7FF;

struct AdtsFrame {
    size_t offset = 0;
    bool mpeg2 = false;
    unsigned layer = 0;
    bool protectionAbsent = false;
    unsigned profile = 0;
    unsigned samplingFrequencyIndex = 0;
    unsigned channelConfiguration = 0;
    size_t length = 0;
    unsigned bufferFullness = 0;
    unsigned rawDataBlocks = 0;

    size_t headerBytes() const;
};

enum class AdtsBreak {
    None,
    BadSyncWord,
    TrailingBytes,
    LengthShorterThanHeader,
    LengthOverruns,
};

struct AdtsWalk {
    std::vector<AdtsFrame> frames;
    AdtsBreak broke = AdtsBreak::None;
    size_t brokeAt = 0;

    bool whole() const { return broke == AdtsBreak::None; }
};

AdtsWalk walkAdts(const std::vector<std::uint8_t>& bytes);

const char* describeBreak(AdtsBreak broke);

std::optional<unsigned> adtsSamplingFrequencyIndex(unsigned sampleRate);

}  // namespace jean::testing
