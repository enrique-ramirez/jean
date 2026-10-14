// Both real codecs give the same bytes however their input is cut into blocks, so
// tests/aac_encoder_test.cpp cannot tell those cuts apart.

#include "third_party/doctest.h"

#include "core/aac_stream.h"
#include "core/text.h"
#include "support/adts.h"
#include "support/fake_aac_codec.h"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <memory>
#include <numeric>
#include <string>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

using Bytes = std::vector<std::uint8_t>;
using Header = std::array<std::uint8_t, kAdtsHeaderBytes>;

struct Setup {
    unsigned channels = 2;
    unsigned sampleRate = 48000;
    int bitrate = 128000;
};

struct Streamed {
    std::shared_ptr<AacCodecCalls> calls = std::make_shared<AacCodecCalls>();
    std::unique_ptr<AacStream> stream;
};

Streamed streamOver(AacCodecScript script, const Setup& setup = {}) {
    Streamed streamed;
    streamed.stream = std::make_unique<AacStream>(fakeAacCodec(streamed.calls, std::move(script)),
                                                  setup.channels, setup.sampleRate, setup.bitrate);
    return streamed;
}

Streamed streamOverACodecRefusingToReset(std::string words) {
    const Setup setup;

    Streamed streamed;
    streamed.stream =
        std::make_unique<AacStream>(fakeAacCodec(streamed.calls, {}, std::move(words)),
                                    setup.channels, setup.sampleRate, setup.bitrate);
    return streamed;
}

AacBlockAnswer packetsOf(std::vector<size_t> payloadBytes) {
    AacBlockAnswer answer;
    std::transform(payloadBytes.begin(), payloadBytes.end(), std::back_inserter(answer.packets),
                   aacPayload);
    return answer;
}

AacBlockAnswer failingAfterAPacket(std::string words) {
    AacBlockAnswer answer = packetsOf({kAacUnscriptedPayloadBytes});
    answer.failure = std::move(words);
    return answer;
}

// IEEE 754: a float holds every whole number up to 2^24 exactly, so each sample can be its own
// index.
std::vector<float> ramp(size_t frames, unsigned channels) {
    std::vector<float> samples(frames * channels);
    std::iota(samples.begin(), samples.end(), 0.0F);
    return samples;
}

std::vector<float> quiet(size_t frames, unsigned channels = 2) {
    return std::vector<float>(frames * channels, 0.0F);
}

Bytes framed(const Header& header, size_t payloadBytes) {
    Bytes frame(header.begin(), header.end());
    const Bytes payload = aacPayload(payloadBytes);
    frame.insert(frame.end(), payload.begin(), payload.end());
    return frame;
}

Bytes joined(const std::vector<Bytes>& frames) {
    Bytes all;
    for (const auto& frame : frames)
        all.insert(all.end(), frame.begin(), frame.end());
    return all;
}

std::vector<float> joined(const std::vector<std::vector<float>>& blocks) {
    std::vector<float> all;
    for (const auto& block : blocks)
        all.insert(all.end(), block.begin(), block.end());
    return all;
}

bool says(const std::string& error, const std::string& words) {
    return toLower(error).find(toLower(words)) != std::string::npos;
}

std::string refusalOf(const Setup& setup) {
    INFO(setup.channels, " channels, ", setup.sampleRate, " Hz, ", setup.bitrate, " bit/s");

    auto streamed = streamOver({}, setup);
    const std::string error = streamed.stream->error();

    REQUIRE_FALSE(streamed.stream->ok());
    CHECK_FALSE(error.empty());
    for (const char* platform : {"Windows", "Media Foundation", "macOS", "Apple", "AudioToolbox"}) {
        CHECK_MESSAGE(!says(error, platform), error);
    }

    Bytes out;
    const auto pcm = quiet(2 * kAacBlockFrames, 8);
    streamed.stream->write(pcm.data(), 2 * kAacBlockFrames, out);
    streamed.stream.reset();

    CHECK(out.empty());
    CHECK(streamed.calls->opened.empty());
    CHECK(streamed.calls->blocks.empty());
    CHECK(streamed.calls->closed == 0);

    return error;
}

}  // namespace

TEST_CASE(
    "the codec is handed whole 1024-frame blocks in order, whatever sizes the audio is "
    "written in, and the remainder waits for the next write") {
    const std::vector<std::vector<size_t>> orders{
        {0, 1, 1023, 1024, 1025, 4096},
        {4096, 1025, 1024, 1023, 1, 0},
    };

    for (const unsigned channels : {1U, 2U}) {
        for (const auto& writes : orders) {
            const size_t frames = std::accumulate(writes.begin(), writes.end(), size_t{0});
            const auto pcm = ramp(frames, channels);
            const size_t blockSamples = kAacBlockFrames * channels;

            auto streamed = streamOver({}, {channels, 48000, 128000});
            Bytes out;
            size_t written = 0;

            for (const size_t write : writes) {
                streamed.stream->write(pcm.data() + (written * channels), write, out);
                written += write;

                INFO(channels, " channels, after a write of ", write, " frames making ", written);
                CHECK(streamed.calls->blocks.size() == written / kAacBlockFrames);
                CHECK(walkAdts(out).frames.size() == written / kAacBlockFrames);
            }

            INFO(channels, " channels, first write of ", writes.front(), " frames");
            REQUIRE(frames / kAacBlockFrames == 7);
            CHECK(std::all_of(
                streamed.calls->blocks.begin(), streamed.calls->blocks.end(),
                [blockSamples](const auto& block) { return block.size() == blockSamples; }));
            CHECK(joined(streamed.calls->blocks) ==
                  std::vector<float>(pcm.begin(),
                                     pcm.begin() + static_cast<std::ptrdiff_t>(7 * blockSamples)));
            CHECK(streamed.stream->ok());
        }
    }
}

// ISO/IEC 14496-3, adts_fixed_header and adts_variable_header, for a 5-byte access unit, 12 bytes
// with its header: syncword 0xFFF, MPEG-4, layer 0 and no CRC are 0xFF 0xF1; then AAC-LC as
// profile 1, sampling frequency index 3 for 48000 Hz and 4 for 44100 Hz, and the channel
// configuration split across two bytes; a 13-bit length; a buffer fullness of 0x7FF; and one raw
// data block, written as zero.
TEST_CASE("a packet is sent behind the seven ADTS header bytes for its channels and rate") {
    struct Case {
        Setup setup;
        Header header;
    };

    const std::vector<Case> cases{
        {{2, 48000, 128000}, {0xFF, 0xF1, 0x4C, 0x80, 0x01, 0x9F, 0xFC}},
        {{1, 48000, 128000}, {0xFF, 0xF1, 0x4C, 0x40, 0x01, 0x9F, 0xFC}},
        {{2, 44100, 128000}, {0xFF, 0xF1, 0x50, 0x80, 0x01, 0x9F, 0xFC}},
        {{1, 44100, 128000}, {0xFF, 0xF1, 0x50, 0x40, 0x01, 0x9F, 0xFC}},
    };

    for (const auto& [setup, header] : cases) {
        INFO(setup.channels, " channels at ", setup.sampleRate, " Hz");

        auto streamed = streamOver({{}, {packetsOf({5})}}, setup);
        Bytes out;
        const auto pcm = quiet(kAacBlockFrames, setup.channels);
        streamed.stream->write(pcm.data(), kAacBlockFrames, out);

        CHECK(out == framed(header, 5));
    }
}

// ISO/IEC 14496-3: aac_frame_length counts the header's own seven bytes, and its 13 bits sit as
// two at the foot of the fourth byte, eight in the fifth and three at the head of the sixth.
TEST_CASE("the header's length counts its own seven bytes, across each byte the field crosses") {
    struct Case {
        size_t payloadBytes;
        Header header;
    };

    const std::vector<Case> cases{
        {248, {0xFF, 0xF1, 0x4C, 0x80, 0x1F, 0xFF, 0xFC}},
        {249, {0xFF, 0xF1, 0x4C, 0x80, 0x20, 0x1F, 0xFC}},
        {2040, {0xFF, 0xF1, 0x4C, 0x80, 0xFF, 0xFF, 0xFC}},
        {2041, {0xFF, 0xF1, 0x4C, 0x81, 0x00, 0x1F, 0xFC}},
        {8184, {0xFF, 0xF1, 0x4C, 0x83, 0xFF, 0xFF, 0xFC}},
    };

    for (const auto& [payloadBytes, header] : cases) {
        INFO("a payload of ", payloadBytes, " bytes");

        auto streamed = streamOver({{}, {packetsOf({payloadBytes})}});
        Bytes out;
        const auto pcm = quiet(kAacBlockFrames);
        streamed.stream->write(pcm.data(), kAacBlockFrames, out);

        CHECK(streamed.stream->ok());
        CHECK(out == framed(header, payloadBytes));
    }
}

TEST_CASE(
    "a block answered with no packet sends nothing, and one answered with two sends two "
    "frames") {
    auto streamed = streamOver({{}, {packetsOf({}), packetsOf({3, 9}), packetsOf({5})}});
    const auto pcm = quiet(kAacBlockFrames);
    Bytes out;

    streamed.stream->write(pcm.data(), kAacBlockFrames, out);
    CHECK(out.empty());
    CHECK(streamed.stream->ok());

    streamed.stream->write(pcm.data(), kAacBlockFrames, out);
    const Bytes two = joined({framed({0xFF, 0xF1, 0x4C, 0x80, 0x01, 0x5F, 0xFC}, 3),
                              framed({0xFF, 0xF1, 0x4C, 0x80, 0x02, 0x1F, 0xFC}, 9)});
    CHECK(out == two);

    streamed.stream->write(pcm.data(), kAacBlockFrames, out);
    CHECK(out == joined({two, framed({0xFF, 0xF1, 0x4C, 0x80, 0x01, 0x9F, 0xFC}, 5)}));
    CHECK(streamed.stream->ok());
}

TEST_CASE(
    "a stream of 1 or 2 channels at 44100 or 48000 Hz and a listed bitrate opens the codec "
    "once, with what it was asked for") {
    for (const unsigned channels : {1U, 2U}) {
        for (const unsigned sampleRate : {44100U, 48000U}) {
            for (const int bitrate : {96000, 128000, 160000, 192000}) {
                INFO(channels, " channels, ", sampleRate, " Hz, ", bitrate, " bit/s");

                const auto streamed = streamOver({}, {channels, sampleRate, bitrate});

                CHECK_MESSAGE(streamed.stream->ok(), streamed.stream->error());
                CHECK(streamed.calls->opened ==
                      std::vector<AacCodecCalls::Opened>{{channels, sampleRate, bitrate}});
            }
        }
    }
}

TEST_CASE("a stream of 0, 3, 6 or 8 channels is refused by name before the codec is opened") {
    for (const unsigned channels : {0U, 3U, 6U, 8U}) {
        const std::string error = refusalOf({channels, 48000, 128000});

        CHECK_MESSAGE(says(error, "channel"), error);
    }
}

TEST_CASE(
    "a rate other than 44100 or 48000 Hz is refused in those words before the codec is "
    "opened") {
    for (const unsigned sampleRate : {0U, 12345U, 32000U, 96000U}) {
        const std::string error = refusalOf({2, sampleRate, 128000});

        CHECK_MESSAGE(error.find("44100 or 48000 Hz") != std::string::npos, error);
    }
}

TEST_CASE("a bitrate outside the four listed is refused by name before the codec is opened") {
    for (const int bitrate : {0, -1, 95999, 100000, 224000}) {
        const std::string error = refusalOf({2, 48000, bitrate});

        CHECK_MESSAGE(says(error, "bitrate"), error);
    }
}

TEST_CASE(
    "a codec that refuses to open leaves the stream failed in the codec's words, and is "
    "neither handed audio nor closed") {
    AacCodecScript script;
    script.refusesToOpen = "this machine has no encoder to give";
    auto streamed = streamOver(script);

    CHECK_FALSE(streamed.stream->ok());
    CHECK_MESSAGE(
        streamed.stream->error().find("this machine has no encoder to give") != std::string::npos,
        streamed.stream->error());
    CHECK(streamed.calls->opened.size() == 1);

    Bytes out;
    const auto pcm = quiet(2 * kAacBlockFrames);
    streamed.stream->write(pcm.data(), 2 * kAacBlockFrames, out);
    streamed.stream.reset();

    CHECK(out.empty());
    CHECK(streamed.calls->blocks.empty());
    CHECK(streamed.calls->closed == 0);
}

TEST_CASE(
    "a codec failing on a block sends nothing for it, leaves the stream failed in the "
    "codec's words, and is not asked again") {
    auto streamed =
        streamOver({{}, {packetsOf({5}), failingAfterAPacket("the encoder ran out of memory")}});
    const auto pcm = quiet(4 * kAacBlockFrames);
    const Bytes oneFrame = framed({0xFF, 0xF1, 0x4C, 0x80, 0x01, 0x9F, 0xFC}, 5);
    Bytes out;

    streamed.stream->write(pcm.data(), 4 * kAacBlockFrames, out);

    CHECK(out == oneFrame);
    CHECK_FALSE(streamed.stream->ok());
    CHECK_MESSAGE(
        streamed.stream->error().find("the encoder ran out of memory") != std::string::npos,
        streamed.stream->error());
    CHECK(streamed.calls->blocks.size() == 2);

    streamed.stream->write(pcm.data(), 4 * kAacBlockFrames, out);

    CHECK(out == oneFrame);
    CHECK(streamed.calls->blocks.size() == 2);
    CHECK_FALSE(streamed.stream->ok());
}

// ISO/IEC 14496-3: aac_frame_length is 13 bits, so 8191 is the longest frame a header can
// declare, and seven of those bytes are the header.
TEST_CASE(
    "a packet of 8185 bytes, one more than a header can declare, fails the stream and sends "
    "nothing") {
    auto streamed = streamOver({{}, {packetsOf({8185})}});
    const auto pcm = quiet(kAacBlockFrames);
    Bytes out;

    streamed.stream->write(pcm.data(), kAacBlockFrames, out);

    CHECK(out.empty());
    CHECK_FALSE(streamed.stream->ok());
    CHECK_FALSE(streamed.stream->error().empty());

    streamed.stream->write(pcm.data(), kAacBlockFrames, out);

    CHECK(out.empty());
    CHECK(streamed.calls->blocks.size() == 1);
}

TEST_CASE("a codec the stream opened is closed once, when the stream is destroyed, failed or not") {
    SUBCASE("a stream that never failed") {
        auto streamed = streamOver({});
        const auto pcm = quiet(3 * kAacBlockFrames);
        Bytes out;
        streamed.stream->write(pcm.data(), 3 * kAacBlockFrames, out);

        CHECK(streamed.calls->closed == 0);
        streamed.stream.reset();
        CHECK(streamed.calls->closed == 1);
    }

    SUBCASE("a stream that never wrote") {
        auto streamed = streamOver({});

        streamed.stream.reset();
        CHECK(streamed.calls->closed == 1);
    }

    SUBCASE("a stream whose codec failed on a block") {
        auto streamed = streamOver({{}, {failingAfterAPacket("the encoder ran out of memory")}});
        const auto pcm = quiet(kAacBlockFrames);
        Bytes out;
        streamed.stream->write(pcm.data(), kAacBlockFrames, out);
        REQUIRE_FALSE(streamed.stream->ok());

        streamed.stream.reset();
        CHECK(streamed.calls->closed == 1);
    }
}

TEST_CASE(
    "a drop empties the remainder: the next block the codec is handed is made of samples "
    "written after it alone, and the codec is reset once before that block") {
    for (const unsigned channels : {1U, 2U}) {
        CAPTURE(channels);

        constexpr size_t kShortOfABlock = kAacBlockFrames - 24;
        auto streamed = streamOver({}, {channels, 48000, 128000});

        const auto pcm = ramp(kShortOfABlock + kAacBlockFrames, channels);
        const std::vector<float> later(
            pcm.begin() + static_cast<std::ptrdiff_t>(kShortOfABlock * channels), pcm.end());
        Bytes out;

        streamed.stream->write(pcm.data(), kShortOfABlock, out);
        streamed.stream->dropHeld();
        streamed.stream->write(later.data(), kAacBlockFrames, out);

        CHECK(streamed.stream->ok());
        REQUIRE(streamed.calls->blocks.size() == 1);
        CHECK(streamed.calls->blocks[0] == later);
        CHECK(streamed.calls->blocksBeforeEachReset == std::vector<size_t>{0});
        CHECK(walkAdts(out).frames.size() == 1);
        CHECK(out.size() == kAdtsHeaderBytes + kAacUnscriptedPayloadBytes);
    }
}

TEST_CASE("each drop resets the codec once, where it stood, and sends nothing itself") {
    auto streamed = streamOver({});
    const auto pcm = quiet(2 * kAacBlockFrames);
    Bytes out;

    streamed.stream->write(pcm.data(), 2 * kAacBlockFrames, out);
    streamed.stream->dropHeld();
    streamed.stream->write(pcm.data(), kAacBlockFrames, out);
    streamed.stream->dropHeld();
    streamed.stream->write(pcm.data(), kAacBlockFrames, out);

    CHECK(streamed.stream->ok());
    CHECK(streamed.calls->blocksBeforeEachReset == std::vector<size_t>{2, 3});
    CHECK(streamed.calls->blocks.size() == 4);
    CHECK(walkAdts(out).frames.size() == 4);
    CHECK(out.size() == 4 * (kAdtsHeaderBytes + kAacUnscriptedPayloadBytes));
    CHECK(streamed.calls->opened.size() == 1);
    CHECK(streamed.calls->closed == 0);
}

TEST_CASE("a stream that was refused stays refused through a drop, and no codec is reset") {
    SUBCASE("refused before the codec was asked") {
        auto streamed = streamOver({}, {3, 48000, 128000});
        REQUIRE_FALSE(streamed.stream->ok());
        const std::string refusal = streamed.stream->error();

        streamed.stream->dropHeld();

        CHECK_FALSE(streamed.stream->ok());
        CHECK(streamed.stream->error() == refusal);
        CHECK(streamed.calls->opened.empty());
        CHECK(streamed.calls->blocksBeforeEachReset.empty());
    }

    SUBCASE("refused by the codec") {
        AacCodecScript script;
        script.refusesToOpen = "this machine has no encoder to give";
        auto streamed = streamOver(std::move(script));
        REQUIRE_FALSE(streamed.stream->ok());
        const std::string refusal = streamed.stream->error();

        streamed.stream->dropHeld();
        Bytes out;
        const auto pcm = quiet(kAacBlockFrames);
        streamed.stream->write(pcm.data(), kAacBlockFrames, out);
        streamed.stream.reset();

        CHECK(out.empty());
        CHECK(streamed.calls->blocksBeforeEachReset.empty());
        CHECK(streamed.calls->blocks.empty());
        CHECK(streamed.calls->closed == 0);
        CHECK_MESSAGE(refusal.find("this machine has no encoder to give") != std::string::npos,
                      refusal);
    }
}

TEST_CASE(
    "a stream whose codec failed on a block stays failed through a drop, in the same words, "
    "and its codec is neither reset nor asked again") {
    auto streamed = streamOver({{}, {failingAfterAPacket("the encoder ran out of memory")}});
    const auto pcm = quiet(kAacBlockFrames);
    Bytes out;

    streamed.stream->write(pcm.data(), kAacBlockFrames, out);
    REQUIRE_FALSE(streamed.stream->ok());
    const std::string failure = streamed.stream->error();

    streamed.stream->dropHeld();
    streamed.stream->write(pcm.data(), kAacBlockFrames, out);

    CHECK_FALSE(streamed.stream->ok());
    CHECK(streamed.stream->error() == failure);
    CHECK(out.empty());
    CHECK(streamed.calls->blocks.size() == 1);
    CHECK(streamed.calls->blocksBeforeEachReset.empty());
}

TEST_CASE(
    "a codec that fails to reset leaves the stream failed in the codec's words, and is not "
    "asked again") {
    auto streamed = streamOverACodecRefusingToReset("the encoder lost its place");
    const auto pcm = quiet(2 * kAacBlockFrames);
    Bytes out;

    streamed.stream->write(pcm.data(), kAacBlockFrames, out);
    const Bytes sentBefore = out;
    REQUIRE(streamed.stream->ok());

    streamed.stream->dropHeld();
    streamed.stream->write(pcm.data(), 2 * kAacBlockFrames, out);

    CHECK_FALSE(streamed.stream->ok());
    CHECK_MESSAGE(streamed.stream->error().find("the encoder lost its place") != std::string::npos,
                  streamed.stream->error());
    CHECK(out == sentBefore);
    CHECK(streamed.calls->blocks.size() == 1);

    streamed.stream->dropHeld();
    streamed.stream->write(pcm.data(), 2 * kAacBlockFrames, out);

    CHECK(out == sentBefore);
    CHECK(streamed.calls->blocks.size() == 1);
    CHECK(streamed.calls->blocksBeforeEachReset == std::vector<size_t>{1});

    streamed.stream.reset();
    CHECK(streamed.calls->closed == 1);
}

// Media Foundation's encoder answers a block's packet two blocks later, so what it holds is whole
// blocks the stream never sees in `out` until then, and they count as held as surely as the
// remainder short of a block does.
TEST_CASE("a stream counts as held its remainder and every block the codec has not answered") {
    auto streamed =
        streamOver({.refusesToOpen = std::nullopt, .blocks = {packetsOf({}), packetsOf({})}});
    const size_t remainder = 100;
    const auto pcm = quiet((5 * kAacBlockFrames) + remainder);
    Bytes out;

    streamed.stream->write(pcm.data(), (5 * kAacBlockFrames) + remainder, out);
    CHECK(walkAdts(out).frames.size() == 3);
    CHECK(streamed.stream->heldFrames() == (2 * kAacBlockFrames) + remainder);

    streamed.stream->dropHeld();
    CHECK(streamed.stream->heldFrames() == 0);
}
