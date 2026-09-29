#include "third_party/doctest.h"

#include "core/opus_stream.h"

#include <ogg/ogg.h>
#include <opus.h>

#include <algorithm>
#include <cmath>
#include <cstring>
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
