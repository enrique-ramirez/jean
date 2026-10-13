#include "third_party/doctest.h"

#include "support/adts.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

using namespace jean;
using testing::AdtsBreak;

namespace {

// ISO/IEC 14496-3 by hand: MPEG-4, layer 0, no CRC; AAC-LC, 48000 Hz, two channels; 378 bytes;
// variable bitrate; one raw data block.
constexpr std::array<std::uint8_t, 7> kPlainHeader = {0xFF, 0xF1, 0x4C, 0x80, 0x2F, 0x5F, 0xFC};
constexpr size_t kPlainLength = 378;

// ISO/IEC 14496-3 by hand, with every field somewhere a plain stream never puts it: MPEG-2,
// layer 2, a CRC; profile 2, sampling frequency index 11, channel configuration 5; 4660 bytes;
// a buffer fullness of 0x2AA; three raw data blocks.
constexpr std::array<std::uint8_t, 7> kUnusualHeader = {0xFF, 0xFC, 0xAD, 0x42, 0x46, 0x8A, 0xAA};
constexpr size_t kUnusualLength = 4660;

// ISO/IEC 14496-3 does not escape a sync word inside a raw data block, so a payload can hold twelve
// set bits. This payload is nothing else.
std::vector<std::uint8_t> frameOf(const std::array<std::uint8_t, 7>& header, size_t length) {
    std::vector<std::uint8_t> frame(length);
    for (size_t at = 0; at < length; ++at)
        frame[at] = at % 2 == 0 ? 0xFF : 0xF1;
    std::copy(header.begin(), header.end(), frame.begin());
    return frame;
}

std::vector<std::uint8_t> plainFrames(size_t count) {
    const auto frame = frameOf(kPlainHeader, kPlainLength);

    std::vector<std::uint8_t> bytes;
    for (size_t made = 0; made < count; ++made)
        bytes.insert(bytes.end(), frame.begin(), frame.end());
    return bytes;
}

}  // namespace

TEST_CASE("an ADTS header is read field by field") {
    SUBCASE("the header a plain AAC-LC stream carries") {
        const auto walk = testing::walkAdts(frameOf(kPlainHeader, kPlainLength));

        REQUIRE(walk.whole());
        REQUIRE(walk.frames.size() == 1);

        const auto& frame = walk.frames[0];
        CHECK(frame.offset == 0);
        CHECK_FALSE(frame.mpeg2);
        CHECK(frame.layer == 0);
        CHECK(frame.protectionAbsent);
        CHECK(frame.profile == testing::kAdtsProfileLc);
        CHECK(frame.samplingFrequencyIndex == 3);
        CHECK(frame.channelConfiguration == 2);
        CHECK(frame.length == kPlainLength);
        CHECK(frame.bufferFullness == testing::kAdtsVariableBitrate);
        CHECK(frame.rawDataBlocks == 1);
        CHECK(frame.headerBytes() == 7);
    }

    SUBCASE("a header with every field set otherwise") {
        const auto walk = testing::walkAdts(frameOf(kUnusualHeader, kUnusualLength));

        REQUIRE(walk.whole());
        REQUIRE(walk.frames.size() == 1);

        const auto& frame = walk.frames[0];
        CHECK(frame.mpeg2);
        CHECK(frame.layer == 2);
        CHECK_FALSE(frame.protectionAbsent);
        CHECK(frame.profile == 2);
        CHECK(frame.samplingFrequencyIndex == 11);
        CHECK(frame.channelConfiguration == 5);
        CHECK(frame.length == kUnusualLength);
        CHECK(frame.bufferFullness == 0x2AA);
        CHECK(frame.rawDataBlocks == 3);
        CHECK(frame.headerBytes() == 9);
    }
}

TEST_CASE("frames are found by their lengths, not by looking for the next sync word") {
    auto bytes = plainFrames(2);
    const auto unusual = frameOf(kUnusualHeader, kUnusualLength);
    bytes.insert(bytes.end(), unusual.begin(), unusual.end());

    const auto walk = testing::walkAdts(bytes);

    REQUIRE(walk.whole());
    REQUIRE(walk.frames.size() == 3);
    CHECK(walk.frames[1].offset == kPlainLength);
    CHECK(walk.frames[2].offset == 2 * kPlainLength);
    CHECK(walk.frames[2].length == kUnusualLength);
}

TEST_CASE("no bytes at all are a whole walk of no frames") {
    const auto walk = testing::walkAdts({});

    CHECK(walk.whole());
    CHECK(walk.frames.empty());
}

TEST_CASE("a walk stops where a frame should start and no sync word does") {
    SUBCASE("a frame one byte longer than its header says") {
        auto bytes = plainFrames(1);
        bytes.push_back(0x00);
        const auto next = plainFrames(1);
        bytes.insert(bytes.end(), next.begin(), next.end());

        const auto walk = testing::walkAdts(bytes);

        CHECK(walk.broke == AdtsBreak::BadSyncWord);
        CHECK(walk.brokeAt == kPlainLength);
        CHECK(walk.frames.size() == 1);
    }

    // ISO/IEC 14496-3: the sync word is twelve set bits, and eleven are an MPEG audio frame of
    // another kind.
    SUBCASE("eleven set bits where twelve belong") {
        auto bytes = plainFrames(1);
        bytes[1] = 0xE1;

        const auto walk = testing::walkAdts(bytes);

        CHECK(walk.broke == AdtsBreak::BadSyncWord);
        CHECK(walk.brokeAt == 0);
        CHECK(walk.frames.empty());
    }

    SUBCASE("a first byte that is not all ones") {
        auto bytes = plainFrames(1);
        bytes[0] = 0x7F;

        CHECK(testing::walkAdts(bytes).broke == AdtsBreak::BadSyncWord);
    }
}

TEST_CASE("a walk stops at a frame whose length runs past the end") {
    auto bytes = plainFrames(2);
    bytes.pop_back();

    const auto walk = testing::walkAdts(bytes);

    CHECK(walk.broke == AdtsBreak::LengthOverruns);
    CHECK(walk.brokeAt == kPlainLength);
    CHECK(walk.frames.size() == 1);
}

TEST_CASE("a walk stops at a frame whose length is shorter than its own header") {
    SUBCASE("six bytes where the header alone is seven") {
        // ISO/IEC 14496-3 by hand: the plain header with an aac_frame_length of 6.
        auto bytes = plainFrames(1);
        bytes[4] = 0x00;
        bytes[5] = 0xDF;

        const auto walk = testing::walkAdts(bytes);

        CHECK(walk.broke == AdtsBreak::LengthShorterThanHeader);
        CHECK(walk.brokeAt == 0);
        CHECK(walk.frames.empty());
    }

    SUBCASE("eight bytes where a CRC makes the header nine") {
        // ISO/IEC 14496-3 by hand: protection_absent cleared, and an aac_frame_length of 8.
        const std::vector<std::uint8_t> bytes = {0xFF, 0xF0, 0x4C, 0x80, 0x01, 0x1F, 0xFC, 0x00};

        const auto walk = testing::walkAdts(bytes);

        CHECK(walk.broke == AdtsBreak::LengthShorterThanHeader);
        CHECK(walk.frames.empty());
    }

    SUBCASE("exactly a header is a frame with nothing in it") {
        // ISO/IEC 14496-3 by hand: the plain header with an aac_frame_length of 7.
        const std::vector<std::uint8_t> bytes = {0xFF, 0xF1, 0x4C, 0x80, 0x00, 0xFF, 0xFC};

        const auto walk = testing::walkAdts(bytes);

        CHECK(walk.whole());
        REQUIRE(walk.frames.size() == 1);
        CHECK(walk.frames[0].length == 7);
    }
}

TEST_CASE("bytes too few to be a header are reported as left over") {
    auto bytes = plainFrames(1);
    bytes.insert(bytes.end(), kPlainHeader.begin(), kPlainHeader.end() - 1);

    const auto walk = testing::walkAdts(bytes);

    CHECK(walk.broke == AdtsBreak::TrailingBytes);
    CHECK(walk.brokeAt == kPlainLength);
    CHECK(walk.frames.size() == 1);
}

TEST_CASE("a sample rate has the index ISO/IEC 14496-3 gives it, or none") {
    CHECK(testing::adtsSamplingFrequencyIndex(96000) == 0U);
    CHECK(testing::adtsSamplingFrequencyIndex(48000) == 3U);
    CHECK(testing::adtsSamplingFrequencyIndex(44100) == 4U);
    CHECK(testing::adtsSamplingFrequencyIndex(8000) == 11U);
    CHECK(testing::adtsSamplingFrequencyIndex(7350) == 12U);
    CHECK_FALSE(testing::adtsSamplingFrequencyIndex(0).has_value());
    CHECK_FALSE(testing::adtsSamplingFrequencyIndex(12345).has_value());
}
