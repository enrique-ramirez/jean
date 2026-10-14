#include "third_party/doctest.h"

#include "core/settings.h"
#include "core/text.h"
#include "support/aac.h"
#include "support/adts.h"
#include "support/pcm.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <numeric>
#include <optional>
#include <string>
#include <vector>

using namespace jean;
using testing::AacSetup;
using testing::kAacFrameSamples;

namespace {

constexpr AacSetup kStreamed{2, 48000, 128000};

struct Refusal {
    AacSetup setup;
    const char* says = "";
};

constexpr std::array<Refusal, 15> kRefusedBeforeTheCodec = {{
    {{2, 8000, 128000}, "44100 or 48000 Hz"},
    {{2, 22050, 128000}, "44100 or 48000 Hz"},
    {{2, 32000, 128000}, "44100 or 48000 Hz"},
    {{2, 88200, 128000}, "44100 or 48000 Hz"},
    {{2, 96000, 128000}, "44100 or 48000 Hz"},
    {{1, 96000, 128000}, "44100 or 48000 Hz"},
    {{3, 48000, 128000}, "channel"},
    {{4, 48000, 128000}, "channel"},
    {{5, 48000, 128000}, "channel"},
    {{7, 48000, 128000}, "channel"},
    {{2, 48000, 8000}, "bitrate"},
    {{2, 48000, 95999}, "bitrate"},
    {{2, 48000, 100000}, "bitrate"},
    {{2, 48000, 224000}, "bitrate"},
    {{1, 48000, 256000}, "bitrate"},
}};

std::string named(const AacSetup& setup) {
    return std::string(setup.channels == 1 ? "mono" : "stereo") + "-" +
           std::to_string(setup.sampleRate) + "-" + std::to_string(setup.bitrate);
}

std::vector<size_t> blocksOf(size_t frames, size_t block) {
    std::vector<size_t> blocks(frames / block, block);
    if (frames % block != 0)
        blocks.push_back(frames % block);
    return blocks;
}

size_t framesIn(const std::vector<size_t>& blocks) {
    return std::accumulate(blocks.begin(), blocks.end(), size_t{0});
}

struct Encoded {
    std::vector<std::uint8_t> bytes;
    std::vector<size_t> framesPerWrite;
    std::optional<size_t> firstWriteLeavingPartOfAFrame;
};

Encoded encode(const AacSetup& setup, const std::vector<float>& pcm,
               const std::vector<size_t>& blocks) {
    const auto encoder =
        testing::platformAacEncoder(setup.channels, setup.sampleRate, setup.bitrate);
    REQUIRE(encoder);
    REQUIRE_MESSAGE(encoder->ok(), encoder->error());
    REQUIRE(pcm.size() >= framesIn(blocks) * setup.channels);

    Encoded encoded;
    size_t fed = 0;

    for (size_t write = 0; write < blocks.size(); ++write) {
        const auto before = static_cast<std::ptrdiff_t>(encoded.bytes.size());
        encoder->write(pcm.data() + (fed * setup.channels), blocks[write], encoded.bytes);
        fed += blocks[write];

        const auto appended = testing::walkAdts(
            std::vector<std::uint8_t>(encoded.bytes.begin() + before, encoded.bytes.end()));
        encoded.framesPerWrite.push_back(appended.frames.size());
        if (!appended.whole() && !encoded.firstWriteLeavingPartOfAFrame)
            encoded.firstWriteLeavingPartOfAFrame = write;
    }

    REQUIRE_MESSAGE(encoder->ok(), encoder->error());
    return encoded;
}

size_t framesExpectedFor(size_t framesGiven) {
    const size_t whole = framesGiven / kAacFrameSamples;
    const size_t held = testing::platformAacFacts().framesHeldBack;
    return whole > held ? whole - held : 0;
}

std::string firstWrongHeader(const testing::AdtsWalk& walk, const AacSetup& setup) {
    const auto index = testing::adtsSamplingFrequencyIndex(setup.sampleRate);

    for (const auto& frame : walk.frames) {
        const bool says = !frame.mpeg2 && frame.layer == 0 && frame.protectionAbsent &&
                          frame.profile == testing::kAdtsProfileLc && index &&
                          frame.samplingFrequencyIndex == *index &&
                          frame.channelConfiguration == setup.channels &&
                          frame.bufferFullness == testing::kAdtsVariableBitrate &&
                          frame.rawDataBlocks == 1 && frame.length >= testing::kAdtsHeaderBytes;
        if (says)
            continue;

        return "the frame at byte " + std::to_string(frame.offset) + " says MPEG-" +
               (frame.mpeg2 ? "2" : "4") + ", layer " + std::to_string(frame.layer) +
               (frame.protectionAbsent ? ", no CRC" : ", a CRC") + ", profile " +
               std::to_string(frame.profile) + ", sampling frequency index " +
               std::to_string(frame.samplingFrequencyIndex) + ", channel configuration " +
               std::to_string(frame.channelConfiguration) + ", buffer fullness " +
               std::to_string(frame.bufferFullness) + ", " + std::to_string(frame.rawDataBlocks) +
               " raw data blocks, " + std::to_string(frame.length) + " bytes";
    }

    return {};
}

void checkFraming(const Encoded& encoded, const AacSetup& setup, size_t framesGiven) {
    const auto walk = testing::walkAdts(encoded.bytes);

    CHECK_MESSAGE(walk.whole(), testing::describeBreak(walk.broke), " at byte ", walk.brokeAt);
    CHECK_MESSAGE(!encoded.firstWriteLeavingPartOfAFrame.has_value(), "write ",
                  encoded.firstWriteLeavingPartOfAFrame.value_or(0), " left part of a frame");
    CHECK(walk.frames.size() == framesExpectedFor(framesGiven));

    const std::string wrong = firstWrongHeader(walk, setup);
    CHECK_MESSAGE(wrong.empty(), wrong);
}

void checkRefuses(const AacSetup& setup, const std::string& says) {
    INFO(setup.channels, " channels, ", setup.sampleRate, " Hz, ", setup.bitrate, " bit/s");

    const auto encoder =
        testing::platformAacEncoder(setup.channels, setup.sampleRate, setup.bitrate);
    REQUIRE(encoder);

    CHECK_FALSE(encoder->ok());
    CHECK_FALSE(encoder->error().empty());
    if (!says.empty())
        CHECK_MESSAGE(encoder->error().find(says) != std::string::npos, encoder->error());

    const auto audio =
        testing::toneUnderNoise(kAacFrameSamples * 4, std::max(setup.channels, 1U), 48000);
    std::vector<std::uint8_t> out;
    for (size_t block = 0; block < 4; ++block) {
        encoder->write(audio.data() + (block * kAacFrameSamples * setup.channels), kAacFrameSamples,
                       out);
    }
    encoder->write(audio.data(), 0, out);

    CHECK(out.empty());
    CHECK_FALSE(encoder->ok());
}

bool aacIsTested() {
    return testing::aacUnderTest() == testing::AacUnderTest::Tested;
}

std::vector<AacSetup> everySetupServed() {
    std::vector<AacSetup> setups;
    for (const int bitrate : kAacBitrates)
        setups.push_back({2, 48000, bitrate});

    setups.push_back({1, 48000, 128000});
    setups.push_back({2, 44100, 128000});
    setups.push_back({1, 44100, 96000});
    return setups;
}

double measuredBytesPerSecond(const Encoded& encoded, const AacSetup& setup) {
    const auto frames = testing::walkAdts(encoded.bytes).frames.size();
    REQUIRE(frames > 0);

    const double seconds = static_cast<double>(frames * kAacFrameSamples) / setup.sampleRate;
    return static_cast<double>(encoded.bytes.size()) / seconds;
}

Encoded encodeMusic(const AacSetup& setup, size_t seconds) {
    const size_t frames = setup.sampleRate * seconds;
    return encode(setup, testing::toneUnderNoise(frames, setup.channels, setup.sampleRate),
                  blocksOf(frames, kAacFrameSamples));
}

Encoded encodeSilence(const AacSetup& setup, size_t seconds) {
    const size_t frames = setup.sampleRate * seconds;
    return encode(setup, testing::silence(frames, setup.channels),
                  blocksOf(frames, kAacFrameSamples));
}

std::vector<std::uint8_t> written(StreamEncoder& encoder, const AacSetup& setup,
                                  const std::vector<float>& pcm) {
    const size_t frames = pcm.size() / setup.channels;

    std::vector<std::uint8_t> out;
    size_t fed = 0;
    for (const size_t block : blocksOf(frames, kAacFrameSamples)) {
        encoder.write(pcm.data() + (fed * setup.channels), block, out);
        fed += block;
    }
    return out;
}

std::string digestOf(const std::vector<std::uint8_t>& bytes) {
    return eTagFor(std::string(bytes.begin(), bytes.end()));
}

std::string firstDifference(const std::vector<std::uint8_t>& got,
                            const std::vector<std::uint8_t>& wanted) {
    if (got == wanted)
        return {};

    const auto gotFrames = testing::walkAdts(got).frames;
    const auto wantedFrames = testing::walkAdts(wanted).frames;

    const auto bytesOf = [](const std::vector<std::uint8_t>& bytes,
                            const testing::AdtsFrame& frame) {
        const auto first = bytes.begin() + static_cast<std::ptrdiff_t>(frame.offset);
        return std::vector<std::uint8_t>(first, first + static_cast<std::ptrdiff_t>(frame.length));
    };

    size_t same = 0;
    while (same < gotFrames.size() && same < wantedFrames.size() &&
           bytesOf(got, gotFrames[same]) == bytesOf(wanted, wantedFrames[same]))
        ++same;

    return "frame " + std::to_string(same) + " is the first to differ, of " +
           std::to_string(gotFrames.size()) + " frames in " + std::to_string(got.size()) +
           " bytes (digest " + digestOf(got) + ") against " + std::to_string(wantedFrames.size()) +
           " frames in " + std::to_string(wanted.size()) + " bytes (digest " + digestOf(wanted) +
           ") from a new encoder";
}

}  // namespace

TEST_CASE(
    "every bitrate, mono and stereo, at 44100 and 48000 Hz, comes out as whole AAC-LC "
    "frames after every write") {
    if (!aacIsTested())
        return;

    for (const AacSetup& setup : everySetupServed()) {
        INFO(named(setup));

        const size_t frames = setup.sampleRate + 300;
        const auto audio = testing::toneUnderNoise(frames, setup.channels, setup.sampleRate);

        checkFraming(encode(setup, audio, blocksOf(frames, kAacFrameSamples)), setup, frames);
        checkFraming(encode(setup, audio, testing::irregularBlocks(frames)), setup, frames);
    }
}

TEST_CASE("an encoder this machine cannot run says why and writes nothing") {
    if (testing::aacUnderTest() != testing::AacUnderTest::Unavailable)
        return;

    checkRefuses(kStreamed, "");
}

TEST_CASE("a stream the encoder cannot make is refused with a reason and nothing is appended") {
    if (!aacIsTested())
        return;

    SUBCASE("settings no AAC stream has") {
        checkRefuses({0, 48000, 128000}, "");
        checkRefuses({2, 0, 128000}, "");
        checkRefuses({2, 12345, 128000}, "");
        checkRefuses({2, 48000, 0}, "");
        checkRefuses({2, 48000, -1}, "");
    }

    SUBCASE("settings the shared stream refuses before a codec is asked") {
        for (const auto& refusal : kRefusedBeforeTheCodec)
            checkRefuses(refusal.setup, refusal.says);
    }
}

TEST_CASE("the same audio comes out as the same bytes however it is cut into blocks") {
    if (!aacIsTested())
        return;

    const size_t frames = (size_t{kStreamed.sampleRate} * 3) + 500;
    const auto audio = testing::toneUnderNoise(frames, kStreamed.channels, kStreamed.sampleRate);

    const auto whole = encode(kStreamed, audio, blocksOf(frames, kAacFrameSamples));
    checkFraming(whole, kStreamed, frames);

    const auto irregular = testing::irregularBlocks(frames);
    REQUIRE(std::find(irregular.begin(), irregular.end(), size_t{0}) != irregular.end());
    REQUIRE(framesIn(irregular) == frames);

    const std::vector<std::vector<size_t>> cuts = {
        blocksOf(frames, 1),
        blocksOf(frames, kAacFrameSamples - 1),
        blocksOf(frames, kAacFrameSamples + 1),
        blocksOf(frames, 4096),
        blocksOf(frames, frames),
        irregular,
    };

    for (const auto& blocks : cuts) {
        INFO(blocks.size(), " writes, the first of ", blocks.front(), " frames");

        const auto cut = encode(kStreamed, audio, blocks);

        checkFraming(cut, kStreamed, frames);
        CHECK(cut.bytes == whole.bytes);
    }
}

TEST_CASE("two encoders given the same audio produce the same bytes") {
    if (!aacIsTested())
        return;

    const size_t frames = size_t{kStreamed.sampleRate} * 2;
    const auto audio = testing::toneUnderNoise(frames, kStreamed.channels, kStreamed.sampleRate);
    const auto blocks = testing::irregularBlocks(frames);

    const auto first = encode(kStreamed, audio, blocks);
    const auto second = encode(kStreamed, audio, blocks);

    REQUIRE_FALSE(first.bytes.empty());
    CHECK(first.bytes == second.bytes);
}

// ISO/IEC 14496-3: ADTS puts seven bytes of header on each 1024-sample frame beyond the codec's
// bitrate, which the twentieth has to absorb.
TEST_CASE("a second of music costs the bytes its bitrate names, within a twentieth") {
    if (!aacIsTested())
        return;

    for (const int bitrate : kAacBitrates) {
        const AacSetup setup{2, 48000, bitrate};
        INFO(named(setup));

        const double asked = bytesPerSecond(bitrate);
        const double spent = measuredBytesPerSecond(encodeMusic(setup, 5), setup);

        CHECK(spent > asked * 0.95);
        CHECK(spent < asked * 1.05);
    }
}

TEST_CASE("a higher bitrate spends more bytes on the same music") {
    if (!aacIsTested())
        return;

    std::vector<int> ascending(std::begin(kAacBitrates), std::end(kAacBitrates));
    std::sort(ascending.begin(), ascending.end());
    REQUIRE(ascending.size() > 1);

    std::vector<size_t> spent;
    std::transform(ascending.begin(), ascending.end(), std::back_inserter(spent),
                   [](int bitrate) { return encodeMusic({2, 48000, bitrate}, 5).bytes.size(); });

    for (size_t at = 1; at < spent.size(); ++at) {
        INFO(ascending[at - 1], " then ", ascending[at]);
        CHECK(spent[at] > spent[at - 1]);
    }
}

TEST_CASE("silence costs no more than music, give or take a hundredth") {
    if (!aacIsTested())
        return;

    for (const int bitrate : kAacBitrates) {
        const AacSetup setup{2, 48000, bitrate};
        INFO(named(setup));

        const auto music = encodeMusic(setup, 5).bytes.size();
        const auto quiet = encodeSilence(setup, 5).bytes.size();

        CHECK(static_cast<double>(quiet) <= static_cast<double>(music) * 1.01);
    }
}

// ISO/IEC 14496-3: a frame is 1024 samples, so the samples past the last multiple of 1024 can
// never make one.
TEST_CASE(
    "a stream that ends loses the frames the codec was still holding and the samples "
    "short of a frame") {
    if (!aacIsTested())
        return;

    const size_t held = testing::platformAacFacts().framesHeldBack;
    const size_t longest = (held + 3) * kAacFrameSamples;
    const auto audio = testing::toneUnderNoise(longest, kStreamed.channels, kStreamed.sampleRate);

    const std::vector<size_t> lengths = {
        1,
        kAacFrameSamples - 1,
        kAacFrameSamples,
        (held * kAacFrameSamples) + kAacFrameSamples - 1,
        (held + 1) * kAacFrameSamples,
        ((held + 1) * kAacFrameSamples) + 1,
        ((held + 2) * kAacFrameSamples) - 1,
        (held + 2) * kAacFrameSamples,
        longest,
    };

    for (const size_t frames : lengths) {
        for (const size_t block : {kAacFrameSamples, size_t{333}}) {
            INFO(frames, " frames given in blocks of ", block);

            const auto encoded = encode(kStreamed, audio, blocksOf(frames, block));
            checkFraming(encoded, kStreamed, frames);

            const size_t carried =
                testing::walkAdts(encoded.bytes).frames.size() * kAacFrameSamples;
            REQUIRE(carried <= frames);
            CHECK(frames - carried ==
                  std::min(frames, (held * kAacFrameSamples) + (frames % kAacFrameSamples)));
        }
    }
}

TEST_CASE(
    "over a minute of music still comes out a frame a block, the last blocks costing what "
    "the first did") {
    if (!aacIsTested())
        return;

    constexpr size_t kSeconds = 75;
    constexpr size_t kCompared = 500;

    const size_t frames = size_t{kStreamed.sampleRate} * kSeconds;
    const auto audio = testing::toneUnderNoise(frames, kStreamed.channels, kStreamed.sampleRate);
    const auto encoded = encode(kStreamed, audio, blocksOf(frames, kAacFrameSamples));

    checkFraming(encoded, kStreamed, frames);

    const auto& perWrite = encoded.framesPerWrite;
    CHECK(*std::max_element(perWrite.begin(), perWrite.end()) == 1);

    const auto walk = testing::walkAdts(encoded.bytes);
    REQUIRE(walk.frames.size() > 2 * kCompared);

    const auto bytesIn = [&](size_t first) {
        return std::accumulate(
            walk.frames.begin() + static_cast<std::ptrdiff_t>(first),
            walk.frames.begin() + static_cast<std::ptrdiff_t>(first + kCompared), size_t{0},
            [](size_t sum, const testing::AdtsFrame& frame) { return sum + frame.length; });
    };

    const auto early = static_cast<double>(bytesIn(0));
    const auto late = static_cast<double>(bytesIn(walk.frames.size() - kCompared));

    CHECK(std::fabs((late / early) - 1.0) < 0.05);
}

TEST_CASE(
    "an encoder given one sound, told to drop what it holds, then given another gives the "
    "bytes a new encoder would give for the second") {
    if (!aacIsTested())
        return;

    for (const AacSetup& setup : {kStreamed, AacSetup{1, 44100, 96000}}) {
        INFO(named(setup));

        const size_t firstFrames = setup.sampleRate + 300;
        const size_t secondFrames = (size_t{setup.sampleRate} * 2) + 500;
        REQUIRE(firstFrames % kAacFrameSamples != 0);

        const auto audio =
            testing::toneUnderNoise(firstFrames + secondFrames, setup.channels, setup.sampleRate);
        const auto cut = audio.begin() + static_cast<std::ptrdiff_t>(firstFrames * setup.channels);
        const std::vector<float> first(audio.begin(), cut);
        const std::vector<float> second(cut, audio.end());

        const auto used =
            testing::platformAacEncoder(setup.channels, setup.sampleRate, setup.bitrate);
        const auto fresh =
            testing::platformAacEncoder(setup.channels, setup.sampleRate, setup.bitrate);
        REQUIRE(used);
        REQUIRE(fresh);

        REQUIRE_FALSE(written(*used, setup, first).empty());
        used->dropHeld();
        const auto afterTheDrop = written(*used, setup, second);
        const auto fromANewEncoder = written(*fresh, setup, second);

        REQUIRE_MESSAGE(used->ok(), used->error());
        REQUIRE_MESSAGE(fresh->ok(), fresh->error());
        REQUIRE(testing::walkAdts(fromANewEncoder).frames.size() ==
                framesExpectedFor(secondFrames));

        const std::string difference = firstDifference(afterTheDrop, fromANewEncoder);
        CHECK_MESSAGE(difference.empty(), difference);
    }
}

TEST_CASE(
    "the digests printed here are for comparing by hand on one machine before and after a "
    "change to the encoder, and are never asserted") {
    if (!aacIsTested())
        return;

    const std::vector<AacSetup> setups = {
        {2, 48000, 96000}, {2, 48000, 128000}, {2, 48000, 192000}, {1, 44100, 128000}};

    for (const AacSetup& setup : setups) {
        const size_t frames = (size_t{setup.sampleRate} * 3) + 500;
        const auto audio = testing::toneUnderNoise(frames, setup.channels, setup.sampleRate);
        const auto encoded = encode(setup, audio, blocksOf(frames, kAacFrameSamples));

        MESSAGE("aac digest ", named(setup), " = ",
                eTagFor(std::string(encoded.bytes.begin(), encoded.bytes.end())),
                " frames=", testing::walkAdts(encoded.bytes).frames.size(),
                " bytes=", encoded.bytes.size());
    }
}
