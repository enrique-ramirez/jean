#include "fb2k/PCH.h"

#include "fb2k/decoder_source.h"

#include "core/ask_player.h"
#include "core/log.h"
#include "core/main_thread_queue.h"
#include "core/pacer.h"
#include "core/pcm_ring.h"
#include "core/player_outcome.h"
#include "core/session.h"
#include "core/session_audio.h"
#include "core/session_order.h"
#include "core/settings.h"
#include "core/stream.h"
#include "core/timeline.h"
#include "fb2k/com_thread.h"
#include "fb2k/player_audio_settings.h"
#include "fb2k/streamer.h"
#include "fb2k/tracks.h"

#include <foobar2000/helpers/input_helpers.h>

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <exception>
#include <functional>
#include <memory>
#include <numeric>
#include <optional>
#include <string>
#include <thread>
#include <utility>

namespace jean {

namespace {

using Clock = Session::Clock;

// Well under kSessionLead. The pacer never releases a block longer than the ring's room, so a
// chunk handed on whole could wait on a short ring for ever.
constexpr double kLongestBlockSeconds = 0.1;
static_assert(std::chrono::duration<double>(kLongestBlockSeconds) < kSessionLead / 4);

std::optional<std::string> thrownBy(const std::function<void()>& step) {
    try {
        step();
    } catch (const std::exception& e) {
        return std::string(e.what());
    } catch (...) {
        return std::string("an unknown exception");
    }

    return std::nullopt;
}

void splitInto(const audio_chunk& chunk, std::deque<PcmBlock>& blocks) {
    const unsigned rate = chunk.get_srate();
    const unsigned channels = chunk.get_channels();
    const size_t frames = chunk.get_sample_count();
    if (rate == 0 || channels == 0)
        return;

    const size_t longest = std::max<size_t>(1, static_cast<size_t>(rate * kLongestBlockSeconds));
    const audio_sample* const samples = chunk.get_data();

    for (size_t first = 0; first < frames; first += longest) {
        const size_t count = std::min(longest, frames - first);
        const audio_sample* const from = samples + (first * channels);

        PcmBlock block;
        block.spec = {rate, channels};
        block.samples.resize(count * channels);

        // The foobar2000 SDK's audio_sample is double on x64, and the ring carries float.
        std::transform(from, from + (count * channels), block.samples.begin(),
                       [](audio_sample sample) { return static_cast<float>(sample); });

        blocks.push_back(std::move(block));
    }
}

void appendOutput(const dsp_chunk_list& list, std::deque<PcmBlock>& blocks) {
    for (size_t i = 0; i < list.get_count(); ++i) {
        const audio_chunk* const produced = list.get_item(i);
        if (produced != nullptr && !produced->is_empty())
            splitInto(*produced, blocks);
    }
}

double secondsOf(const std::deque<PcmBlock>& blocks) {
    return std::accumulate(
        blocks.begin(), blocks.end(), 0.0,
        [](double total, const PcmBlock& block) { return total + block.seconds(); });
}

GainSetting gainSettingOf(t_replaygain_config::t_source_mode mode) {
    switch (mode) {
        case t_replaygain_config::source_mode_track:
            return GainSetting::track;
        case t_replaygain_config::source_mode_album:
            return GainSetting::album;
        case t_replaygain_config::source_mode_byPlaybackOrder:
            return GainSetting::byPlaybackOrder;
        default:
            return GainSetting::none;
    }
}

t_replaygain_config::t_source_mode sourceModeOf(GainSource source) {
    switch (source) {
        case GainSource::track:
            return t_replaygain_config::source_mode_track;
        case GainSource::album:
            return t_replaygain_config::source_mode_album;
        case GainSource::none:
            break;
    }

    return t_replaygain_config::source_mode_none;
}

// foobar2000's query_scale applies no gain at all for source_mode_byPlaybackOrder, so a session
// hands it the mode its own order resolves to.
t_replaygain_config resolvedFor(t_replaygain_config config, SessionOrder order) {
    config.m_source_mode =
        sourceModeOf(replayGainSourceFor(gainSettingOf(config.m_source_mode), order));
    return config;
}

unsigned dspFlagsOf(const ChainFlags& flags) {
    unsigned answer = 0;
    if (flags.endOfTrack)
        answer |= dsp::END_OF_TRACK;
    if (flags.handBack)
        answer |= dsp::FLUSH;
    return answer;
}

struct Pipeline {
    input_helper input;
    metadb_handle_ptr track;
    file_info_impl info;
    audio_sample scale = 1;

    dsp_manager chain{dsp_entry::flag_playback};
    bool chainDropped = false;

    double latency = 0;

    uint64_t serial = 0;
    bool decoding = false;

    // The open track started from its beginning and has decoded nothing yet. A turn a seek
    // started further in may end with no audio at all, as a seek to the very end does.
    bool owesAudio = false;
    std::deque<PcmBlock> waiting;
};

class Decoder : public PcmSource {
public:
    Decoder(Session& session, PcmRing& ring, const PlayerAudioSettings& audio,
            PlayerAudioSettings::Latest initial)
        : session_(session), ring_(ring), audio_(audio), settings_(std::move(initial)) {}

    // The abort cuts short whatever input_helper or the chain is in the middle of: foobar2000
    // throws it as "User abort".
    ~Decoder() override {
        if (thread_.joinable()) {
            session_.closeWithoutStopping();
            abort_.abort();
            thread_.join();
        }
    }

    Decoder(const Decoder&) = delete;
    Decoder& operator=(const Decoder&) = delete;

    void start() {
        thread_ = std::thread([this] { run(); });
    }

private:
    void run();
    void decode();
    void releaseIfStopped(Pipeline& pipeline);
    void takeNewSettings(Pipeline& pipeline);
    void openTurn(Pipeline& pipeline, const Turn& turn, MarkPlacer& marks);
    void decodeChunk(Pipeline& pipeline, audio_chunk& chunk);
    void finishTrack(Pipeline& pipeline);
    void writeTail(const dsp_chunk_list& tail);
    audio_sample gainFor(const file_info& info) const;
    bool trackStep(Pipeline& pipeline, uint64_t serial, const std::function<void()>& step);
    bool chainStep(Pipeline& pipeline, const std::function<void()>& step);
    void reportFailure(uint64_t serial, const std::string& what);

    Session& session_;
    PcmRing& ring_;
    const PlayerAudioSettings& audio_;

    PlayerAudioSettings::Latest settings_;

    abort_callback_impl abort_;
    std::thread thread_;
};

// A thread entry point: an exception leaving it calls std::terminate.
void Decoder::run() {
    try {
        decode();
    } catch (const std::exception& e) {
        logError(std::string("a session's decoder stopped: ") + e.what());
    } catch (...) {
        logError("a session's decoder stopped with an unknown exception");
    }
}

void Decoder::decode() {
    const ComOnThisThread com;
    Pipeline pipeline;
    audio_chunk_impl chunk;
    Pacer pacer(kSessionLead);
    MarkPlacer marks;
    Turn turn;
    Clock::time_point due = Clock::now();

    pipeline.chain.set_config(settings_.chain);

    for (;;) {
        if (!session_.awaitDue(due))
            break;

        releaseIfStopped(pipeline);
        if (!session_.awaitRunning(turn))
            break;

        due = Clock::now();
        takeNewSettings(pipeline);

        if (turn.serial != pipeline.serial)
            openTurn(pipeline, turn, marks);

        if (pipeline.waiting.empty()) {
            if (pipeline.decoding)
                decodeChunk(pipeline, chunk);
            continue;
        }

        const PcmBlock& next = pipeline.waiting.front();
        const auto verdict =
            pacer.ask(next.frames(), next.spec.sampleRate, ring_.roomSeconds(), Clock::now());
        if (!verdict.release) {
            due = verdict.askAgain;
            continue;
        }

        PcmBlock block = std::move(pipeline.waiting.front());
        pipeline.waiting.pop_front();
        block.mark = marks.take(block.seconds());
        ring_.write(std::move(block));
    }

    pipeline.input.close();
}

// An open track's file can refuse a tag write, so a stopped session lets go of it. foobar2000's
// own playback keeps the file open while paused, and so does a parked decoder.
void Decoder::releaseIfStopped(Pipeline& pipeline) {
    if (pipeline.input.is_open() && session_.stopped()) {
        pipeline.input.close();
        pipeline.decoding = false;
    }
}

// Between runs only: dsp_manager takes a new configuration at its next run.
void Decoder::takeNewSettings(Pipeline& pipeline) {
    if (audio_.generation() == settings_.generation)
        return;

    settings_ = audio_.latest();

    if (!pipeline.chainDropped)
        pipeline.chain.set_config(settings_.chain);

    if (pipeline.decoding)
        trackStep(pipeline, pipeline.serial, [&] { pipeline.scale = gainFor(pipeline.info); });
}

// From the handle, never SessionTrack::path: that is the display form, which foobar2000 on a Mac
// spells with `~`, and input_helper does not open it.
void Decoder::openTurn(Pipeline& pipeline, const Turn& turn, MarkPlacer& marks) {
    pipeline.serial = turn.serial;
    pipeline.decoding = false;
    pipeline.input.close();

    // A cut drops what was decoded for the turn before and empties the chain. A turn the track
    // before ran out into keeps both, so it follows on without a gap.
    if (chainFlagsFor(turn.cut ?ChainRun::afterCut : ChainRun::audio).flushFirst) {
        pipeline.waiting.clear();
        if (!pipeline.chainDropped && !chainStep(pipeline, [&] { pipeline.chain.flush(); }))
            return;
        pipeline.latency = 0;
    }

    const metadb_handle_ptr track = handleOf(turn.track);
    if (!track.is_valid()) {
        reportFailure(turn.serial, "the session holds no handle for the track");
        return;
    }

    StreamMark mark = markOf(turn);
    bool startsAtEnd = false;

    const bool opened = trackStep(pipeline, turn.serial, [&] {
        pipeline.info.reset();
        pipeline.input.open(file::ptr(), track, input_flag_playback, abort_);
        pipeline.input.get_info(track->get_subsong_index(), pipeline.info, abort_);

        const double length = pipeline.info.get_length();

        // A seek asked before anything had read the track's length can lie at or past its end,
        // and whether every foobar2000 input accepts a seek to exactly its own length is not
        // known. Such a turn is ended rather than sought.
        startsAtEnd = length > 0 && turn.from >= length;
        if (startsAtEnd) {
            session_.began(turn.serial, length, Clock::now());
            return;
        }

        pipeline.owesAudio = true;
        if (turn.from > 0) {
            if (pipeline.input.can_seek()) {
                pipeline.input.seek(turn.from, abort_);
                pipeline.owesAudio = false;
            } else {
                logInfo("a session's track cannot seek, so it plays from its start");
                mark.position = 0;
            }
        }

        pipeline.scale = gainFor(pipeline.info);
        session_.began(turn.serial, std::max(0.0, length), Clock::now());
    });

    if (!opened)
        return;

    pipeline.track = track;

    if (startsAtEnd) {
        finishTrack(pipeline);
        return;
    }

    pipeline.decoding = true;

    marks.pending(std::move(mark),
                  markLeadSeconds(turn.cut, pipeline.latency, secondsOf(pipeline.waiting)));
}

void Decoder::decodeChunk(Pipeline& pipeline, audio_chunk& chunk) {
    bool decoded = false;

    const bool read = trackStep(pipeline, pipeline.serial, [&] {
        decoded = pipeline.input.run(chunk, abort_);
        if (decoded && pipeline.scale != 1)
            chunk.scale(pipeline.scale);
    });

    if (!read)
        return;

    // A track that opens and ends without a sample has failed, so a run of them stops the session
    // rather than reopening one in a loop under repeatOne.
    if (!decoded && pipeline.owesAudio) {
        pipeline.input.close();
        pipeline.decoding = false;
        reportFailure(pipeline.serial, "the track ended without any audio");
        return;
    }

    if (!decoded) {
        finishTrack(pipeline);
        return;
    }

    pipeline.owesAudio = false;

    if (pipeline.chainDropped) {
        splitInto(chunk, pipeline.waiting);
        return;
    }

    dsp_chunk_list_impl list;
    list.add_chunk(&chunk);

    const unsigned flags = dspFlagsOf(chainFlagsFor(ChainRun::audio));
    const bool ran = chainStep(pipeline, [&] {
        pipeline.latency = pipeline.chain.run(&list, pipeline.track, flags, abort_);
    });

    if (!ran)
        return;

    if (pipeline.chainDropped)
        splitInto(chunk, pipeline.waiting);
    else
        appendOutput(list, pipeline.waiting);
}

void Decoder::finishTrack(Pipeline& pipeline) {
    pipeline.input.close();
    pipeline.decoding = false;

    const bool followed = session_.ended(pipeline.serial, Clock::now());
    if (pipeline.chainDropped)
        return;

    const unsigned flags =
        dspFlagsOf(chainFlagsFor(followed ? ChainRun::trackEnd : ChainRun::lastTrackEnd));

    dsp_chunk_list_impl tail;
    const bool ran = chainStep(pipeline, [&] {
        pipeline.latency = pipeline.chain.run(&tail, pipeline.track, flags, abort_);
    });

    if (!ran)
        return;

    if (!followed && session_.stopped())
        writeTail(tail);
    else
        appendOutput(tail, pipeline.waiting);
}

// The last track's tail, written at once rather than paced: the decoder parks next, and the next
// play's cut would drop anything still waiting. A full PcmRing drops its oldest block, audio not
// yet heard, so what does not fit is dropped from the tail instead.
void Decoder::writeTail(const dsp_chunk_list& tail) {
    std::deque<PcmBlock> blocks;
    appendOutput(tail, blocks);

    for (PcmBlock& block : blocks) {
        if (block.seconds() > ring_.roomSeconds())
            return;
        ring_.write(std::move(block));
    }
}

audio_sample Decoder::gainFor(const file_info& info) const {
    return resolvedFor(settings_.replayGain, session_.order()).query_scale(info);
}

bool Decoder::trackStep(Pipeline& pipeline, uint64_t serial, const std::function<void()>& step) {
    const auto failure = thrownBy(step);
    if (!failure)
        return true;

    pipeline.input.close();
    pipeline.decoding = false;
    reportFailure(serial, *failure);
    return false;
}

bool Decoder::chainStep(Pipeline& pipeline, const std::function<void()>& step) {
    const auto failure = thrownBy(step);
    if (!failure)
        return true;

    if (session_.threw(pipeline.serial, Thrower::chain, Clock::now()) != AfterThrow::dropChain) {
        pipeline.decoding = false;
        return false;
    }

    logError("a session dropped its DSP chain, which threw: " + *failure);
    pipeline.chainDropped = true;
    pipeline.chain.close();
    pipeline.latency = 0;
    return true;
}

void Decoder::reportFailure(uint64_t serial, const std::string& what) {
    if (session_.threw(serial, Thrower::decoder, Clock::now()) == AfterThrow::skipTrack)
        logError("a session skipped a track it could not decode: " + what);
}

void stopQuietly(Streamer& streamer) {
    if (const auto failure = thrownBy([&streamer] { streamer.stop(); }))
        logError("a session's stream did not stop cleanly: " + *failure);
}

struct Built {
    PlayerOutcome outcome = PlayerOutcome::done;
    std::shared_ptr<Streamer> streamer;
    Decoder* decoder = nullptr;
};

}  // namespace

SessionStream startSessionStream(Session& session, MainThreadQueue& mainThread,
                                 const Settings& settings, double bufferSeconds,
                                 const PlayerAudioSettings& audio) {
    const int opusBitrate = settings.opusBitrate;
    const int aacBitrate = settings.aacBitrate;

    // The AAC stream's constructor opens its codec, and Media Foundation's opening calls MFStartup
    // and CoCreateInstance on the constructing thread, so a session's Streamer is built where the
    // engine's is, on the main thread.
    const Built built = askForOutcome<Built>(
        mainThread, "starting a session's stream",
        [&session, &audio, opusBitrate, aacBitrate, bufferSeconds] {
            PlayerAudioSettings::Latest initial;
            initial.generation = audio.generation();
            dsp_config_manager::get()->get_core_settings(initial.chain);
            replaygain_manager::get()->get_core_settings(initial.replayGain);

            Built made;
            made.streamer = std::make_shared<Streamer>(
                opusBitrate, aacBitrate, bufferSeconds, [&session] { session.timelineMarked(); },
                [&session, &audio, &initial, &made](PcmRing& ring) {
                    auto decoder =
                        std::make_unique<Decoder>(session, ring, audio, std::move(initial));
                    made.decoder = decoder.get();
                    return std::unique_ptr<PcmSource>(std::move(decoder));
                });
            return made;
        });

    SessionStream stream;
    stream.outcome = built.outcome;
    if (built.outcome != PlayerOutcome::done)
        return stream;

    if (built.decoder == nullptr) {
        stream.outcome = PlayerOutcome::unavailable;
        return stream;
    }

    if (const auto failure = thrownBy([&built] { built.decoder->start(); })) {
        logError("a session's decoder did not start: " + *failure);
        stopQuietly(*built.streamer);
        stream.outcome = PlayerOutcome::unavailable;
        return stream;
    }

    const std::shared_ptr<Streamer> streamer = built.streamer;
    stream.open = streamer->opener();
    stream.readTimeline = [streamer] { return streamer->timeline(); };
    stream.stop = [streamer] { stopQuietly(*streamer); };

    return stream;
}

}  // namespace jean
