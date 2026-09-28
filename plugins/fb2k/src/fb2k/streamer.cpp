#include "fb2k/PCH.h"

#include "fb2k/streamer.h"

#include "core/documents.h"
#include "core/broadcast_ring.h"
#include "core/log.h"
#include "core/opus_stream.h"
#include "core/pcm_ring.h"
#include "core/stream.h"
#include "core/timeline.h"
#include "fb2k/aac_encoder.h"
#include "fb2k/tracks.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <initializer_list>
#include <iterator>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace jean {

namespace {

constexpr unsigned kOutputChannels = 2;

constexpr double kCaptureInterval = 0.05;

constexpr size_t kTimelineMarks = 8;

constexpr auto kIdlePatience = std::chrono::seconds(1);

constexpr int kBroadcastSeconds = 8;

size_t broadcastBytes(int bitrate) {
    return static_cast<size_t>(bytesPerSecond(bitrate)) * kBroadcastSeconds;
}

// audio_sample is float or double depending on audio_sample_size, and Opus takes float.
template <typename To, typename From>
void copyAs(const From* first, size_t count, std::vector<To>& out) {
    out.resize(count);
    std::transform(first, first + count, out.begin(),
                   [](From value) { return static_cast<To>(value); });
}

}  // namespace

struct Format {
    Format(std::string name, std::string contentType, int bitrate, StreamEncoder& encoder)
        : name(std::move(name)),
          contentType(std::move(contentType)),
          encoder(encoder),
          broadcast(broadcastBytes(bitrate)) {}

    const std::string name;
    const std::string contentType;
    StreamEncoder& encoder;

    BroadcastRing broadcast;
    std::atomic<int> listeners{0};
    std::vector<std::uint8_t> preamble;
};

struct Streamer::State {
    PcmRing pcm;
    OpusStream opus;
    AacEncoder aac;
    Format ogg;
    Format adts;
    Timeline timeline;
    std::thread thread;
    std::atomic<bool> stopping{false};

    State(int opusBitrate, int aacBitrate, double bufferSeconds, PlayerStateStore& playerState)
        : pcm(bufferSeconds),
          opus(kOutputChannels, opusBitrate),
          aac(kOutputChannels, OpusStream::kSampleRate, aacBitrate),
          ogg("opus", "audio/ogg", opusBitrate, opus),
          adts("aac", "audio/aac", aacBitrate, aac),
          timeline(kTimelineMarks, [&playerState] { playerState.timelineMarked(); }) {
        ogg.preamble = opus.headers();

        for (Format* format : {&ogg, &adts}) {
            if (format->encoder.ok())
                working.push_back(format);
            else
                logError(format->name + " streaming is unavailable: " + format->encoder.error());
        }
    }

    bool anyoneListening() const {
        return std::any_of(working.begin(), working.end(),
                           [](const Format* format) { return format->listeners > 0; });
    }

    Format* formatNamed(const std::string& name) const {
        const auto found = std::find_if(working.begin(), working.end(),
                                        [&name](const Format* f) { return f->name == name; });
        return found == working.end() ? nullptr : *found;
    }

    std::vector<Format*> working;
};

struct Streamer::Capture : public playback_stream_capture_callback_impl,
                           public play_callback_impl_base {
    explicit Capture(std::shared_ptr<State> state)
        : playback_stream_capture_callback_impl(kCaptureInterval),
          play_callback_impl_base(flag_on_playback_new_track | flag_on_playback_seek),
          state_(std::move(state)) {}

    void on_playback_new_track(metadb_handle_ptr track) override {
        pending_ = markOf(track, playback_control::get()->playback_get_position());
    }

    void on_playback_seek(double time) override {
        metadb_handle_ptr track;
        if (playback_control::get()->get_now_playing(track))
            pending_ = markOf(track, time);
    }

    void on_chunk(const audio_chunk& chunk) override {
        if (chunk.is_empty())
            return;

        PcmBlock block;
        block.spec = {chunk.get_srate(), chunk.get_channels()};

        copyAs(chunk.get_data(), chunk.get_sample_count() * chunk.get_channels(), block.samples);

        block.mark = std::move(pending_);
        pending_.reset();

        state_->pcm.write(std::move(block));
    }

    static StreamMark markOf(const metadb_handle_ptr& track, double position) {
        StreamMark mark;
        mark.position = position;

        mark.path = displayPathOf(track);
        if (track.is_valid())
            mark.subsong = static_cast<int>(track->get_subsong_index());

        return mark;
    }

    std::shared_ptr<State> state_;
    std::optional<StreamMark> pending_;
};

namespace {

// Resampling and channel conversion through the player's own resampler, so a user who chose
// SoX gets SoX. PPHS ships with foobar2000 and accepts every ratio, so the chain exists on a
// bare install.
class Converter {
public:
    bool convert(const PcmBlock& block, std::vector<float>& out) {
        out.clear();

        if (block.spec != configured_) {
            drain(out);
            if (!reconfigure(block.spec))
                return false;
        }

        copyAs(block.samples.data(), block.samples.size(), incoming_);

        dsp_chunk_list_impl list;
        audio_chunk* chunk = list.add_item(block.samples.size());
        chunk->set_data(incoming_.data(), block.frames(), block.spec.channels,
                        block.spec.sampleRate, 0);

        dsp_.run(&list, dsp_track_t(), 0, fb2k::noAbort);
        appendConverted(list, out);

        return true;
    }

private:
    // The foobar2000 SDK's dsp_impl_base hands back what a DSP has buffered ahead from
    // on_endofplayback, which only dsp::FLUSH calls. END_OF_TRACK alone reaches on_endoftrack,
    // and only in a DSP that asked for track change marks.
    void drain(std::vector<float>& out) {
        if (configured_ == AudioSpec{})
            return;

        dsp_chunk_list_impl list;
        dsp_.run(&list, dsp_track_t(), dsp::END_OF_TRACK | dsp::FLUSH, fb2k::noAbort);
        appendConverted(list, out);
    }

    void appendConverted(const dsp_chunk_list& list, std::vector<float>& out) {
        for (size_t i = 0; i < list.get_count(); ++i) {
            const audio_chunk* produced = list.get_item(i);
            if (produced == nullptr || produced->is_empty())
                continue;

            if (produced->get_srate() != OpusStream::kSampleRate ||
                produced->get_channels() != kOutputChannels)
                continue;

            copyAs(produced->get_data(), produced->get_sample_count() * produced->get_channels(),
                   outgoing_);
            out.insert(out.end(), outgoing_.begin(), outgoing_.end());
        }
    }

    bool reconfigure(const AudioSpec& spec) {
        auto resamplers = resampler_manager_v3::tryGet();
        if (resamplers.is_empty()) {
            if (!complained_) {
                logError(
                    "this foobar2000 has no resampler that can convert channels; "
                    "streaming is unavailable");
                complained_ = true;
            }
            return false;
        }

        dsp_chain_config_impl chain;
        resamplers->make_chain_v3(chain, spec.sampleRate, OpusStream::kSampleRate, 1.0F,
                                  audio_chunk::channel_config_stereo);

        dsp_.close();
        dsp_.set_config(chain);
        configured_ = spec;

        logInfo("streaming " + std::to_string(spec.sampleRate) + " Hz, " +
                std::to_string(spec.channels) + " ch as 48000 Hz stereo Opus");
        return true;
    }

    dsp_manager dsp_;
    AudioSpec configured_{};
    std::vector<audio_sample> incoming_;
    std::vector<float> outgoing_;
    bool complained_ = false;
};

class Session : public StreamSession {
public:
    Session(std::shared_ptr<Streamer::State> state, Format* format)
        : state_(std::move(state)), format_(format), cursor_(format->broadcast.subscribe()) {
        ++format_->listeners;
    }

    ~Session() override { --format_->listeners; }

    bool next(std::vector<std::uint8_t>& out) override {
        if (!sentPreamble_) {
            out = format_->preamble;
            sentPreamble_ = true;
            return true;
        }

        out.clear();

        switch (format_->broadcast.read(cursor_, out, kIdlePatience)) {
            case BroadcastRing::Read::Ok:
            case BroadcastRing::Read::Idle:
                return true;
            default:
                return false;
        }
    }

private:
    std::shared_ptr<Streamer::State> state_;
    Format* format_;
    BroadcastRing::Cursor cursor_;
    bool sentPreamble_ = false;
};

struct ComOnThisThread {
    ComOnThisThread() { CoInitializeEx(nullptr, COINIT_MULTITHREADED); }
    ~ComOnThisThread() { CoUninitialize(); }
};

void encode(const std::shared_ptr<Streamer::State>& state) {
    const ComOnThisThread com;
    Converter converter;
    std::vector<float> converted;
    std::vector<std::uint8_t> encoded;
    double streamSeconds = 0;

    PcmBlock block;
    while (state->pcm.read(block)) {
        if (block.mark) {
            block.mark->at = streamSeconds;
            state->timeline.mark(std::move(*block.mark));
        }

        streamSeconds += block.seconds();
        state->timeline.setStreamTime(streamSeconds);

        if (!state->anyoneListening())
            continue;

        if (!converter.convert(block, converted) || converted.empty())
            continue;

        const size_t frames = converted.size() / kOutputChannels;

        // The formats fail apart on purpose; see ARCHITECTURE.md, "The audio path".
        for (Format* format : state->working) {
            if (format->listeners == 0 || !format->encoder.ok())
                continue;

            encoded.clear();
            format->encoder.write(converted.data(), frames, encoded);

            if (!encoded.empty())
                format->broadcast.write(encoded.data(), encoded.size());

            if (!format->encoder.ok()) {
                logError(format->name + " streaming stopped: " + format->encoder.error());
                format->broadcast.close();
            }
        }
    }
}

// The one thread entry point in this component, and an exception leaving it calls
// std::terminate: the SDK throws in the resampler and the DSP chain, and taking the player
// down with no message is not what a failed stream is worth.
void runEncoder(const std::shared_ptr<Streamer::State>& state) {
    try {
        encode(state);
    } catch (const std::exception& e) {
        logError(std::string("the stream encoder stopped: ") + e.what());
    } catch (...) {
        logError("the stream encoder stopped with an unknown exception");
    }

    state->ogg.broadcast.close();
    state->adts.broadcast.close();
}

}  // namespace

Streamer::Streamer(int opusBitrate, int aacBitrate, double bufferSeconds,
                   PlayerStateStore& playerState)
    : state_(std::make_shared<State>(opusBitrate, aacBitrate, bufferSeconds, playerState)) {
    if (state_->working.empty()) {
        logError("streaming is unavailable: no encoder started");
        return;
    }

    capture_ = std::make_unique<Capture>(state_);
    state_->thread = std::thread([state = state_] { runEncoder(state); });
}

Streamer::~Streamer() {
    stop();
}

std::string Streamer::timeline() const {
    if (state_->working.empty())
        return {};

    return streamTimelineDocument(state_->timeline.streamTime(), state_->timeline.marks());
}

std::vector<std::string> Streamer::formats() const {
    std::vector<std::string> available;
    available.reserve(state_->working.size());
    std::transform(state_->working.begin(), state_->working.end(), std::back_inserter(available),
                   [](const Format* format) { return format->name; });
    return available;
}

StreamOpener Streamer::opener() const {
    if (state_->working.empty())
        return {};

    return [state = state_](const std::string& name) -> OpenedStream {
        Format* format = state->formatNamed(name);
        if (format == nullptr)
            return {};

        return {format->contentType, std::make_unique<Session>(state, format)};
    };
}

void Streamer::stop() {
    if (state_->stopping.exchange(true))
        return;

    capture_.reset();
    state_->pcm.close();
    state_->ogg.broadcast.close();
    state_->adts.broadcast.close();

    if (state_->thread.joinable())
        state_->thread.join();
}

}  // namespace jean
