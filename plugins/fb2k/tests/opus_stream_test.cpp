#include "third_party/doctest.h"

#include "core/opus_stream.h"

#include <ogg/ogg.h>
#include <opus.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <set>
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

// The loudest decoded sample, which is what distinguishes real audio from well-formed silence.
float loudestAfterDecoding(const std::vector<std::uint8_t>& bytes, unsigned channels) {
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
    float loudest = 0;
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

            for (size_t i = 0; i < static_cast<size_t>(frames) * channels; ++i)
                loudest = std::max(loudest, std::fabs(decoded[i]));
        }
    }

    if (started)
        ogg_stream_clear(&stream);
    opus_decoder_destroy(decoder);
    ogg_sync_clear(&sync);

    return loudest;
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
// delivered at 1x, so a listener who starts behind stays behind. libogg's own default gathers
// 4096 bytes, a quarter of a second at this bitrate.
TEST_CASE("a page carries about as much audio as it was asked to") {
    OpusStream stream(2, 128000);
    const auto pcm = tone(OpusStream::kSampleRate * 5, 2);

    std::vector<std::uint8_t> out;
    stream.write(pcm.data(), OpusStream::kSampleRate * 5, out);

    const auto seen = scan(out);
    REQUIRE(seen.granules.size() > 4);

    std::int64_t widest = 0;
    for (size_t i = 1; i < seen.granules.size(); ++i)
        widest = std::max(widest, seen.granules[i] - seen.granules[i - 1]);

    const double seconds = static_cast<double>(widest) / OpusStream::kSampleRate;

    CHECK(seconds <= OpusStream::kPageSeconds * 1.5);

    // And not a page per packet, which would spend a tenth of the bitrate on page headers.
    CHECK(seconds >= 4 * static_cast<double>(OpusStream::kFrameSize) / OpusStream::kSampleRate);
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
