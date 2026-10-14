#include "third_party/doctest.h"

#include "core/opus_stream.h"

#include <ogg/ogg.h>
#include <opus.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <functional>
#include <random>
#include <set>
#include <string>
#include <vector>

using namespace jean;

namespace {

std::vector<float> tone(size_t frames, unsigned channels) {
    std::vector<float> pcm(frames * channels);

    for (size_t frame = 0; frame < frames; ++frame) {
        const auto value = static_cast<float>(
            0.5 * std::sin(2.0 * 3.14159265358979 * 440.0 * static_cast<double>(frame) /
                           OpusStream::kSampleRate));
        for (unsigned channel = 0; channel < channels; ++channel)
            pcm[(frame * channels) + channel] = value;
    }

    return pcm;
}

struct Pages {
    int count = 0;
    int bos = 0;
    std::set<long> serials;
    std::vector<long> numbers;
    std::vector<std::int64_t> granules;
    std::int64_t lastGranule = -1;
    size_t consumed = 0;
};

Pages scan(const std::vector<std::uint8_t>& bytes) {
    Pages seen;

    ogg_sync_state sync;
    ogg_sync_init(&sync);
    char* buffer = ogg_sync_buffer(&sync, static_cast<long>(bytes.size()));
    std::memcpy(buffer, bytes.data(), bytes.size());
    ogg_sync_wrote(&sync, static_cast<long>(bytes.size()));

    ogg_page page;
    while (ogg_sync_pageout(&sync, &page) == 1) {
        seen.count++;
        seen.bos += ogg_page_bos(&page) != 0 ? 1 : 0;
        seen.serials.insert(ogg_page_serialno(&page));
        seen.numbers.push_back(ogg_page_pageno(&page));
        seen.granules.push_back(ogg_page_granulepos(&page));
        seen.lastGranule = ogg_page_granulepos(&page);
        seen.consumed += static_cast<size_t>(page.header_len + page.body_len);
    }

    ogg_sync_clear(&sync);
    return seen;
}

// What a player reads before any audio: RFC 7845 section 5.1 puts the pre-skip at bytes 10
// and 11 of OpusHead, little-endian.
unsigned preSkipOf(const std::vector<std::uint8_t>& headers) {
    const std::string text(headers.begin(), headers.end());
    const size_t head = text.find("OpusHead");
    REQUIRE(head != std::string::npos);
    return static_cast<unsigned>(headers[head + 10]) |
           (static_cast<unsigned>(headers[head + 11]) << 8U);
}

// Every audio packet decoded in order, interleaved, the way a player would hand it on before
// dropping the pre-skip.
std::vector<float> decodeAll(const std::vector<std::uint8_t>& bytes, unsigned channels) {
    ogg_sync_state sync;
    ogg_sync_init(&sync);
    char* buffer = ogg_sync_buffer(&sync, static_cast<long>(bytes.size()));
    std::memcpy(buffer, bytes.data(), bytes.size());
    ogg_sync_wrote(&sync, static_cast<long>(bytes.size()));

    int failure = OPUS_OK;
    OpusDecoder* decoder = opus_decoder_create(static_cast<opus_int32>(OpusStream::kSampleRate),
                                               static_cast<int>(channels), &failure);
    REQUIRE(failure == OPUS_OK);

    ogg_stream_state stream;
    bool started = false;
    int skipped = 0;
    std::vector<float> all;
    std::vector<float> decoded(OpusStream::kFrameSize * channels * 6);

    ogg_page page;
    while (ogg_sync_pageout(&sync, &page) == 1) {
        if (!started) {
            ogg_stream_init(&stream, ogg_page_serialno(&page));
            started = true;
        }

        ogg_stream_pagein(&stream, &page);

        ogg_packet packet;
        while (ogg_stream_packetout(&stream, &packet) == 1) {
            if (skipped < 2) {  // OpusHead and OpusTags
                skipped++;
                continue;
            }

            const int frames =
                opus_decode_float(decoder, packet.packet, static_cast<opus_int32>(packet.bytes),
                                  decoded.data(), static_cast<int>(decoded.size() / channels), 0);
            REQUIRE(frames > 0);

            all.insert(all.end(), decoded.begin(),
                       decoded.begin() + (static_cast<std::ptrdiff_t>(frames) * channels));
        }
    }

    if (started)
        ogg_stream_clear(&stream);
    opus_decoder_destroy(decoder);
    ogg_sync_clear(&sync);

    return all;
}

// The loudest decoded sample, which is what distinguishes real audio from well-formed silence.
float loudestAfterDecoding(const std::vector<std::uint8_t>& bytes, unsigned channels) {
    const auto decoded = decodeAll(bytes, channels);
    float loudest = 0;
    for (const float sample : decoded)
        loudest = std::max(loudest, std::fabs(sample));
    return loudest;
}

std::vector<std::uint8_t> encodeWhole(OpusStream& stream, const std::vector<float>& pcm,
                                      unsigned channels) {
    std::vector<std::uint8_t> whole = stream.headers();
    stream.write(pcm.data(), pcm.size() / channels, whole);
    return whole;
}

std::vector<std::uint8_t> written(OpusStream& stream, const std::vector<float>& pcm,
                                  unsigned channels) {
    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), pcm.size() / channels, out);
    return out;
}

// What a listener joining at `later` is sent. RFC 7845 section 3 puts the two header pages first,
// and RFC 3533 section 6 lets a decoder pick an Ogg stream up at any page after them.
std::vector<std::uint8_t> asJoinedAt(const OpusStream& stream,
                                     const std::vector<std::uint8_t>& later) {
    std::vector<std::uint8_t> sent = stream.headers();
    sent.insert(sent.end(), later.begin(), later.end());
    return sent;
}

std::vector<float> quiet(size_t frames, unsigned channels) {
    return std::vector<float>(frames * channels, 0.0F);
}

constexpr size_t kPacketsAPage = 5;
constexpr int kPagesBeforeTheDrop = 5;
constexpr size_t kPacketsWaiting = 3;
constexpr size_t kFramesShortOfAPacket = 500;

constexpr size_t kFramesLeavingSomethingHeld =
    (((size_t{kPagesBeforeTheDrop} * kPacketsAPage) + kPacketsWaiting) * OpusStream::kFrameSize) +
    kFramesShortOfAPacket;

// libopus 1.5.2, measured through a new decoder: silence from an encoder that was reset peaks at
// 2e-34. The held tone peaks at 0.36 to 0.51, and silence from an encoder left as the tone left it
// at 3.4.
constexpr float kSilent = 0.001F;

bool risesByOne(const std::vector<long>& numbers) {
    return std::adjacent_find(numbers.begin(), numbers.end(), [](long earlier, long later) {
               return later != earlier + 1;
           }) == numbers.end();
}

bool rises(const std::vector<std::int64_t>& granules) {
    return std::adjacent_find(granules.begin(), granules.end(), std::greater_equal<>()) ==
           granules.end();
}

double widestPageSeconds(const std::vector<std::uint8_t>& bytes) {
    const auto seen = scan(bytes);
    REQUIRE(seen.granules.size() > 4);

    std::int64_t widest = 0;
    for (size_t i = 1; i < seen.granules.size(); ++i)
        widest = std::max(widest, seen.granules[i] - seen.granules[i - 1]);

    return static_cast<double>(widest) / OpusStream::kSampleRate;
}

}  // namespace

TEST_CASE("the headers are the two pages RFC 7845 asks for") {
    const OpusStream stream(2, 128000);
    REQUIRE(stream.ok());

    const auto& headers = stream.headers();
    const auto seen = scan(headers);

    CHECK(seen.count == 2);
    CHECK(seen.bos == 1);
    CHECK(seen.consumed == headers.size());

    const std::string text(headers.begin(), headers.end());
    CHECK(text.find("OpusHead") != std::string::npos);
    CHECK(text.find("OpusTags") != std::string::npos);
    CHECK(text.find("foo_jean") != std::string::npos);
}

TEST_CASE("audio shorter than one frame is buffered rather than emitted") {
    OpusStream stream(2, 128000);
    const auto pcm = tone(OpusStream::kFrameSize - 1, 2);

    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kFrameSize - 1, out);

    CHECK(out.empty());
}

TEST_CASE("the output is whole Ogg pages and nothing else") {
    OpusStream stream(2, 128000);
    const auto pcm = tone(OpusStream::kSampleRate, 2);

    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kSampleRate, out);

    const auto seen = scan(out);
    REQUIRE(seen.count > 0);

    // Every write ending on a page boundary is what lets a listener join mid-stream.
    CHECK(seen.consumed == out.size());
}

// Firefox stops at the first chained Ogg boundary, so the encoder is never restarted at a
// track change: one serial, one BOS, and page numbers that only ever go up.
TEST_CASE("a second write continues the same logical stream") {
    OpusStream stream(2, 128000);
    const auto pcm = tone(OpusStream::kSampleRate / 2, 2);

    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kSampleRate / 2, out);
    stream.write(pcm.data(), OpusStream::kSampleRate / 2, out);

    std::vector<std::uint8_t> whole = stream.headers();
    whole.insert(whole.end(), out.begin(), out.end());

    const auto seen = scan(whole);

    CHECK(seen.serials.size() == 1);
    CHECK(seen.bos == 1);
    REQUIRE(seen.numbers.size() > 2);

    for (size_t i = 1; i < seen.numbers.size(); ++i)
        CHECK(seen.numbers[i] == seen.numbers[i - 1] + 1);
}

// Every millisecond a page waits to fill is a millisecond of permanent lag: the stream is
// delivered at 1x, so a listener who starts behind stays behind.
TEST_CASE("a page carries about as much audio as it was asked to") {
    OpusStream stream(2, 128000);
    std::vector<std::uint8_t> out;
    const auto pcm = tone(size_t{OpusStream::kSampleRate} * 5, 2);
    stream.write(pcm.data(), pcm.size() / 2, out);

    const double seconds = widestPageSeconds(out);

    CHECK(seconds <= OpusStream::kPageSeconds * 1.5);

    // And not a page per packet, which would spend a tenth of the bitrate on page headers.
    CHECK(seconds >= 4 * static_cast<double>(OpusStream::kFrameSize) / OpusStream::kSampleRate);
}

// libopus spends a few bytes on a frame of silence, so a page gathered to a byte count holds a
// quiet passage back for seconds, and a listener's buffer runs dry waiting for it.
TEST_CASE("a silent passage is paged as promptly as music") {
    OpusStream stream(2, 128000);
    std::vector<std::uint8_t> out;
    const std::vector<float> silence(size_t{OpusStream::kSampleRate} * 5 * 2, 0.0F);
    stream.write(silence.data(), silence.size() / 2, out);

    CHECK(widestPageSeconds(out) <= OpusStream::kPageSeconds * 1.5);
}

TEST_CASE("granule position advances with the audio") {
    OpusStream stream(2, 128000);
    const auto pcm = tone(OpusStream::kSampleRate, 2);

    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kSampleRate, out);

    const auto seen = scan(out);
    CHECK(seen.lastGranule > 0);
    CHECK(seen.lastGranule <= static_cast<std::int64_t>(OpusStream::kSampleRate));
}

TEST_CASE("what comes out decodes back to the audio that went in") {
    OpusStream stream(2, 128000);
    const auto pcm = tone(OpusStream::kSampleRate, 2);

    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kSampleRate, out);

    std::vector<std::uint8_t> whole = stream.headers();
    whole.insert(whole.end(), out.begin(), out.end());

    CHECK(loudestAfterDecoding(whole, 2) > 0.3F);
}

TEST_CASE("mono encodes too") {
    OpusStream stream(1, 96000);
    REQUIRE(stream.ok());

    const auto pcm = tone(OpusStream::kSampleRate / 2, 1);
    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kSampleRate / 2, out);

    std::vector<std::uint8_t> whole = stream.headers();
    whole.insert(whole.end(), out.begin(), out.end());

    CHECK(loudestAfterDecoding(whole, 1) > 0.3F);
}

TEST_CASE("a channel count Opus cannot carry is refused rather than guessed at") {
    const OpusStream stream(6, 128000);

    CHECK_FALSE(stream.ok());
    CHECK(stream.error().find("mono or stereo") != std::string::npos);
    CHECK(stream.headers().empty());
}

TEST_CASE("samples above full scale do not break the encoder") {
    OpusStream stream(2, 128000);

    auto pcm = tone(OpusStream::kSampleRate / 2, 2);
    for (auto& sample : pcm)
        sample *= 2.4F;

    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kSampleRate / 2, out);

    CHECK(stream.ok());
    CHECK_FALSE(out.empty());
}

// RFC 7845 section 4.2: a player drops the pre-skip from the start of what it decodes, and
// whatever the encoder's own delay is beyond that is heard late by that much.
TEST_CASE("once the pre-skip is dropped, a sound is heard where it was played") {
    const size_t onset = (OpusStream::kSampleRate / 2) + 123;

    const size_t channels = 2;
    std::vector<float> pcm(size_t{OpusStream::kSampleRate} * 2 * channels, 0.0F);
    const auto burst = tone(OpusStream::kSampleRate / 2, 2);
    std::copy(burst.begin(), burst.end(), pcm.begin() + static_cast<std::ptrdiff_t>(onset * 2));

    OpusStream stream(2, 128000);
    const auto whole = encodeWhole(stream, pcm, 2);
    const auto decoded = decodeAll(whole, 2);
    const unsigned preSkip = preSkipOf(stream.headers());

    CHECK(preSkip > 0);

    const auto loud = std::find_if(decoded.begin() + (static_cast<std::ptrdiff_t>(preSkip) * 2),
                                   decoded.end(), [](float s) { return std::fabs(s) > 0.05F; });
    REQUIRE(loud != decoded.end());

    const auto heardAt =
        static_cast<long>((loud - decoded.begin()) / 2) - static_cast<long>(preSkip);
    CHECK(std::labs(heardAt - static_cast<long>(onset)) <= 48);
}

// Constrained VBR holds every stretch of a second or so near the target, so a dense passage
// gets the same bytes as a sparse one. Unconstrained, the encoder spends where the music asks.
TEST_CASE("the bitrate follows the music rather than the clock") {
    const size_t frames = size_t{OpusStream::kSampleRate} * 2;

    std::vector<float> noise(frames * 2);
    // The same noise on every run.
    // NOLINTNEXTLINE(bugprone-random-generator-seed,cert-msc32-c,cert-msc51-cpp)
    std::mt19937 generator(7);
    std::uniform_real_distribution<float> level(-0.5F, 0.5F);
    std::generate(noise.begin(), noise.end(), [&] { return level(generator); });

    OpusStream sparse(2, 128000);
    OpusStream dense(2, 128000);
    std::vector<std::uint8_t> sparseBytes;
    std::vector<std::uint8_t> denseBytes;
    const auto pure = tone(frames, 2);
    sparse.write(pure.data(), frames, sparseBytes);
    dense.write(noise.data(), frames, denseBytes);

    const double ratio =
        static_cast<double>(sparseBytes.size()) / static_cast<double>(denseBytes.size());
    CHECK(std::fabs(ratio - 1.0) > 0.15);
}

TEST_CASE(
    "after a loud tone and a drop, silence decodes to silence from the first page a new "
    "listener is sent") {
    for (const unsigned channels : {1U, 2U}) {
        CAPTURE(channels);

        OpusStream stream(channels, 128000);
        const auto before = written(stream, tone(kFramesLeavingSomethingHeld, channels), channels);
        REQUIRE(scan(before).count == kPagesBeforeTheDrop);
        REQUIRE(loudestAfterDecoding(asJoinedAt(stream, before), channels) > 0.3F);

        stream.dropHeld();
        const auto after = written(stream, quiet(OpusStream::kSampleRate, channels), channels);

        REQUIRE(scan(after).count > 0);
        CHECK(loudestAfterDecoding(asJoinedAt(stream, after), channels) < kSilent);
    }
}

TEST_CASE(
    "a drop leaves the stream going: whole pages, one serial, one first page, page numbers "
    "and granule positions still rising, and the same headers") {
    OpusStream stream(2, 128000);
    const std::vector<std::uint8_t> headers = stream.headers();

    const auto before = written(stream, tone(kFramesLeavingSomethingHeld, 2), 2);
    stream.dropHeld();
    CHECK(stream.headers() == headers);

    const auto after = written(stream, quiet(OpusStream::kSampleRate, 2), 2);
    CHECK(stream.ok());
    CHECK(stream.headers() == headers);

    const auto pagesBefore = scan(before);
    const auto pagesAfter = scan(after);
    REQUIRE(pagesBefore.count == kPagesBeforeTheDrop);
    REQUIRE(pagesAfter.count > 2);

    CHECK(pagesAfter.consumed == after.size());
    CHECK(pagesAfter.bos == 0);
    CHECK(pagesAfter.serials == scan(headers).serials);
    CHECK(pagesAfter.serials == pagesBefore.serials);

    CHECK(pagesAfter.numbers.front() > pagesBefore.numbers.back());
    CHECK(risesByOne(pagesAfter.numbers));

    CHECK(pagesAfter.granules.front() ==
          pagesBefore.lastGranule +
              static_cast<std::int64_t>(kPacketsAPage * OpusStream::kFrameSize));
    CHECK(rises(pagesAfter.granules));
}

TEST_CASE("a sound played after a drop is heard, whether the stream held anything or not") {
    const auto sound = tone(OpusStream::kSampleRate / 2, 2);

    SUBCASE("a stream holding packets and part of a frame") {
        OpusStream stream(2, 128000);
        written(stream, quiet(kFramesLeavingSomethingHeld, 2), 2);

        stream.dropHeld();
        const auto after = written(stream, sound, 2);

        CHECK(scan(after).consumed == after.size());
        CHECK(loudestAfterDecoding(asJoinedAt(stream, after), 2) > 0.3F);
    }

    SUBCASE("a stream that ended its last write on a page") {
        OpusStream stream(2, 128000);
        const auto before = written(stream, quiet(kPacketsAPage * OpusStream::kFrameSize, 2), 2);
        REQUIRE(scan(before).count == 1);

        stream.dropHeld();
        const auto after = written(stream, sound, 2);

        CHECK(scan(after).consumed == after.size());
        CHECK(scan(after).numbers.front() > scan(before).numbers.back());
        CHECK(loudestAfterDecoding(asJoinedAt(stream, after), 2) > 0.3F);
    }

    SUBCASE("a stream never written to") {
        OpusStream stream(2, 128000);
        const std::vector<std::uint8_t> headers = stream.headers();

        stream.dropHeld();
        const auto after = written(stream, sound, 2);

        CHECK(stream.headers() == headers);
        CHECK(scan(asJoinedAt(stream, after)).bos == 1);
        CHECK(scan(after).consumed == after.size());
        CHECK(loudestAfterDecoding(asJoinedAt(stream, after), 2) > 0.3F);
    }
}

TEST_CASE("a stream that was refused is still refused after a drop, in the same words") {
    OpusStream stream(6, 128000);
    REQUIRE_FALSE(stream.ok());
    const std::string refusal = stream.error();

    stream.dropHeld();

    REQUIRE_FALSE(stream.ok());
    CHECK(stream.error() == refusal);
    CHECK(stream.headers().empty());

    const auto after = written(stream, tone(OpusStream::kSampleRate, 6), 6);
    CHECK(after.empty());
    CHECK_FALSE(stream.ok());
}

TEST_CASE("what a stream held, written again after a drop, leaves it as long as if never dropped") {
    const auto before = quiet(kFramesLeavingSomethingHeld, 2);
    const auto after = tone(OpusStream::kSampleRate / 2, 2);

    OpusStream untouched(2, 128000);
    auto untouchedBytes = written(untouched, before, 2);
    const auto untouchedAfter = written(untouched, after, 2);
    untouchedBytes.insert(untouchedBytes.end(), untouchedAfter.begin(), untouchedAfter.end());

    OpusStream dropped(2, 128000);
    auto droppedBytes = written(dropped, before, 2);
    const size_t held = dropped.heldFrames();
    CHECK(held == (kPacketsWaiting * OpusStream::kFrameSize) + kFramesShortOfAPacket);

    dropped.dropHeld();
    CHECK(dropped.heldFrames() == 0);

    for (const auto& next : {quiet(held, 2), after}) {
        const auto bytes = written(dropped, next, 2);
        droppedBytes.insert(droppedBytes.end(), bytes.begin(), bytes.end());
    }

    CHECK(scan(droppedBytes).granules == scan(untouchedBytes).granules);
}
