#include "core/opus_stream.h"

#include <ogg/ogg.h>
#include <opus.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <random>
#include <string>
#include <utility>

namespace jean {

namespace {

constexpr char kVendor[] = "foo_jean";

constexpr int kHighestComplexity = 10;

constexpr int kUnconstrainedVbr = 0;

constexpr std::int64_t kPacketsPerPage =
    static_cast<std::int64_t>(OpusStream::kPageSeconds * OpusStream::kSampleRate) /
    static_cast<std::int64_t>(OpusStream::kFrameSize);

void appendPage(std::vector<std::uint8_t>& out, const ogg_page& page) {
    out.insert(out.end(), page.header, page.header + page.header_len);
    out.insert(out.end(), page.body, page.body + page.body_len);
}

void appendLittleEndian(std::vector<std::uint8_t>& out, std::uint32_t value) {
    for (unsigned shift = 0; shift < 32; shift += 8)
        out.push_back(static_cast<std::uint8_t>((value >> shift) & 0xffU));
}

// RFC 7845 section 5.1.
std::vector<std::uint8_t> opusHead(unsigned channels, std::uint16_t preSkip) {
    std::vector<std::uint8_t> head{'O', 'p', 'u', 's', 'H', 'e', 'a', 'd'};
    head.push_back(1);
    head.push_back(static_cast<std::uint8_t>(channels));
    head.push_back(static_cast<std::uint8_t>(preSkip & 0xffU));
    head.push_back(static_cast<std::uint8_t>(static_cast<unsigned>(preSkip) >> 8U));
    appendLittleEndian(head, OpusStream::kSampleRate);
    head.push_back(0);  // output gain
    head.push_back(0);
    head.push_back(0);  // channel mapping family
    return head;
}

std::vector<std::uint8_t> opusTags() {
    std::vector<std::uint8_t> tags{'O', 'p', 'u', 's', 'T', 'a', 'g', 's'};
    const std::string vendor = kVendor;
    appendLittleEndian(tags, static_cast<std::uint32_t>(vendor.size()));
    tags.insert(tags.end(), vendor.begin(), vendor.end());
    appendLittleEndian(tags, 0);  // no user comments
    return tags;
}

enum class StreamPlace { first, later };

// e_o_s is always zero: the stream never ends, so nothing here is ever the last packet.
ogg_packet packetOf(const std::uint8_t* payload, size_t bytes, StreamPlace place,
                    std::int64_t granule, std::int64_t sequence) {
    ogg_packet packet{};
    packet.packet = const_cast<unsigned char*>(payload);
    packet.bytes = static_cast<long>(bytes);
    packet.b_o_s = place == StreamPlace::first ? 1 : 0;
    packet.e_o_s = 0;
    packet.granulepos = granule;
    packet.packetno = sequence;
    return packet;
}

}  // namespace

struct OpusStream::State {
    OpusEncoder* encoder = nullptr;
    ogg_stream_state ogg{};
    bool oggReady = false;

    unsigned channels = 2;

    // The string belongs to the encoder thread that wrote it; the flag is what every other
    // thread reads through ok(), because assigning a std::string is not atomic and a reader
    // calling empty() mid-assignment sees a pointer and a size that do not go together.
    std::string error;
    std::atomic<bool> failed{false};

    void fail(std::string message) {
        error = std::move(message);
        failed.store(true);
    }

    std::vector<float> pending;
    std::vector<std::uint8_t> headerBytes;
    std::vector<std::uint8_t> packet;

    std::int64_t granule = 0;
    std::int64_t packets = 0;
    std::int64_t packetsOnPage = 0;

    ~State() {
        if (encoder != nullptr)
            opus_encoder_destroy(encoder);
        if (oggReady)
            ogg_stream_clear(&ogg);
    }
};

OpusStream::OpusStream(unsigned channels, int bitrate) : state_(std::make_unique<State>()) {
    auto& state = *state_;
    state.channels = channels;

    if (channels != 1 && channels != 2) {
        state.fail("Opus needs mono or stereo");
        return;
    }

    int failure = OPUS_OK;
    state.encoder =
        opus_encoder_create(static_cast<opus_int32>(kSampleRate), static_cast<int>(channels),
                            OPUS_APPLICATION_AUDIO, &failure);
    if (failure != OPUS_OK || state.encoder == nullptr) {
        state.fail(std::string("could not start the Opus encoder: ") + opus_strerror(failure));
        return;
    }

    opus_encoder_ctl(state.encoder, OPUS_SET_BITRATE(bitrate));
    opus_encoder_ctl(state.encoder, OPUS_SET_SIGNAL(OPUS_SIGNAL_MUSIC));
    opus_encoder_ctl(state.encoder, OPUS_SET_VBR_CONSTRAINT(kUnconstrainedVbr));
    opus_encoder_ctl(state.encoder, OPUS_SET_COMPLEXITY(kHighestComplexity));

    // RFC 7845 section 4.2: the pre-skip is the encoder's own delay, which a player drops from
    // the start of what it decodes.
    opus_int32 lookahead = 0;
    opus_encoder_ctl(state.encoder, OPUS_GET_LOOKAHEAD(&lookahead));

    // A random serial rather than a fixed one, so two streams from one player cannot be
    // mistaken for each other by anything that multiplexes Ogg.
    std::random_device entropy;
    if (ogg_stream_init(&state.ogg, static_cast<int>(entropy())) != 0) {
        state.fail("could not start the Ogg stream");
        return;
    }
    state.oggReady = true;

    const auto head = opusHead(channels, static_cast<std::uint16_t>(lookahead));
    const auto tags = opusTags();

    auto headPacket = packetOf(head.data(), head.size(), StreamPlace::first, 0, state.packets++);
    ogg_stream_packetin(&state.ogg, &headPacket);

    auto tagsPacket = packetOf(tags.data(), tags.size(), StreamPlace::later, 0, state.packets++);
    ogg_stream_packetin(&state.ogg, &tagsPacket);

    // Flushed rather than paged out: RFC 7845 requires both headers to end their pages,
    // and audio MUST NOT share a page with them.
    ogg_page page;
    while (ogg_stream_flush(&state.ogg, &page) != 0)
        appendPage(state.headerBytes, page);

    state.packet.resize(4000);
}

OpusStream::~OpusStream() = default;

bool OpusStream::ok() const {
    return !state_->failed.load();
}

const std::string& OpusStream::error() const {
    return state_->error;
}

const std::vector<std::uint8_t>& OpusStream::headers() const {
    return state_->headerBytes;
}

void OpusStream::write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) {
    auto& state = *state_;
    if (!ok())
        return;

    state.pending.insert(state.pending.end(), samples, samples + (frames * state.channels));

    const size_t frameSamples = kFrameSize * state.channels;

    size_t consumed = 0;
    while (state.pending.size() - consumed >= frameSamples) {
        const auto encoded = opus_encode_float(state.encoder, state.pending.data() + consumed,
                                               static_cast<int>(kFrameSize), state.packet.data(),
                                               static_cast<opus_int32>(state.packet.size()));
        consumed += frameSamples;

        if (encoded < 0) {
            state.fail(std::string("Opus encoding failed: ") + opus_strerror(encoded));
            return;
        }

        state.granule += static_cast<std::int64_t>(kFrameSize);

        auto packet = packetOf(state.packet.data(), static_cast<size_t>(encoded),
                               StreamPlace::later, state.granule, state.packets++);
        ogg_stream_packetin(&state.ogg, &packet);

        if (++state.packetsOnPage < kPacketsPerPage)
            continue;

        state.packetsOnPage = 0;
        ogg_page page;
        while (ogg_stream_flush(&state.ogg, &page) != 0)
            appendPage(out, page);
    }

    state.pending.erase(state.pending.begin(),
                        state.pending.begin() + static_cast<std::ptrdiff_t>(consumed));
}

void OpusStream::dropHeld() {
    auto& state = *state_;
    if (!ok())
        return;

    state.pending.clear();
    opus_encoder_ctl(state.encoder, OPUS_RESET_STATE);

    // ogg_stream_reset empties libogg's queue of packets, and also restarts the page count and
    // marks the next page a first page, which would start a second stream.
    const auto pageNumber = state.ogg.pageno;
    const auto firstPageWritten = state.ogg.b_o_s;
    ogg_stream_reset(&state.ogg);
    state.ogg.pageno = pageNumber;
    state.ogg.b_o_s = firstPageWritten;

    state.granule -= state.packetsOnPage * static_cast<std::int64_t>(kFrameSize);
    state.packetsOnPage = 0;
}

}  // namespace jean
