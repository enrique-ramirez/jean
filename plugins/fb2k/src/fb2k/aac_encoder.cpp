#include "fb2k/PCH.h"

#include "fb2k/aac_encoder.h"

#include "core/pcm16.h"
#include "core/stream.h"

#include <mfapi.h>
#include <mferror.h>
#include <mftransform.h>
#include <wmcodecdsp.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <utility>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")

namespace jean {

namespace {

constexpr unsigned kBitsPerSample = 16;

// ISO/IEC 14496-3 sampling frequency indices, and the only rates the Windows encoder
// accepts. Anything else must be resampled before it reaches here.
int samplingFrequencyIndex(unsigned sampleRate) {
    switch (sampleRate) {
        case 48000:
            return 3;
        case 44100:
            return 4;
        default:
            return -1;
    }
}

void appendAdtsHeader(std::vector<std::uint8_t>& out, size_t payload, int frequencyIndex,
                      unsigned channels) {
    const size_t total = payload + 7;

    out.push_back(0xff);
    out.push_back(0xf1);  // MPEG-4, layer 0, no CRC
    out.push_back(
        static_cast<std::uint8_t>((1 << 6) | (frequencyIndex << 2) | ((channels >> 2) & 1)));
    out.push_back(static_cast<std::uint8_t>(((channels & 3) << 6) | ((total >> 11) & 3)));
    out.push_back(static_cast<std::uint8_t>((total >> 3) & 0xff));
    out.push_back(static_cast<std::uint8_t>(((total & 7) << 5) | 0x1f));
    out.push_back(0xfc);
}

class BufferLock {
public:
    explicit BufferLock(IMFMediaBuffer* buffer) : buffer_(buffer) {}

    ~BufferLock() { buffer_->Unlock(); }

    BufferLock(const BufferLock&) = delete;
    BufferLock& operator=(const BufferLock&) = delete;

private:
    IMFMediaBuffer* const buffer_;
};

void describeAudio(const pfc::com_ptr_t<IMFMediaType>& type, unsigned channels,
                   unsigned sampleRate) {
    type->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, kBitsPerSample);
    type->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, sampleRate);
    type->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, channels);
}

}  // namespace

struct AacEncoder::State {
    void fail(std::string message);
    void fail(const char* what, HRESULT result);

    pfc::com_ptr_t<IMFTransform> encoder;

    std::string error;
    std::atomic<bool> broken{false};

    unsigned channels = 2;
    unsigned sampleRate = 48000;
    int frequencyIndex = 3;

    bool mfStarted = false;
    bool started = false;

    LONGLONG time = 0;

    Pcm16Converter toPcm16;
    std::vector<std::int16_t> pcm;
};

AacEncoder::AacEncoder(unsigned channels, unsigned sampleRate, int bitrate)
    : state_(std::make_unique<State>()) {
    auto& state = *state_;
    state.channels = channels;
    state.sampleRate = sampleRate;
    state.frequencyIndex = samplingFrequencyIndex(sampleRate);

    if (state.frequencyIndex < 0) {
        state.fail("the Windows AAC encoder takes 44100 or 48000 Hz only");
        return;
    }

    if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_LITE))) {
        state.fail("could not start Media Foundation");
        return;
    }
    state.mfStarted = true;

    // fb2k::audioEncoder has no implementations registered in foobar2000 or its common
    // components, so AAC comes from the one Windows ships.
    if (FAILED(CoCreateInstance(CLSID_AACMFTEncoder, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(state.encoder.receive_ptr())))) {
        state.fail("this Windows has no AAC encoder");
        return;
    }

    pfc::com_ptr_t<IMFMediaType> output;
    if (FAILED(MFCreateMediaType(output.receive_ptr()))) {
        state.fail("could not describe the AAC output");
        return;
    }

    output->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    output->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC);
    describeAudio(output, channels, sampleRate);
    output->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
                      static_cast<UINT32>(bytesPerSecond(bitrate)));

    // Payload type 0 leaves the ADTS header on each frame for this component to write. Media
    // Foundation wants the output type set before the input type.
    output->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0);

    if (FAILED(state.encoder->SetOutputType(0, output.get_ptr(), 0))) {
        state.fail("the AAC encoder refused these output settings");
        return;
    }

    pfc::com_ptr_t<IMFMediaType> input;
    if (FAILED(MFCreateMediaType(input.receive_ptr()))) {
        state.fail("could not describe the PCM input");
        return;
    }

    input->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    input->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
    describeAudio(input, channels, sampleRate);

    if (FAILED(state.encoder->SetInputType(0, input.get_ptr(), 0))) {
        state.fail("the AAC encoder refused 16-bit PCM");
        return;
    }

    state.encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
    state.encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
    state.started = true;
}

AacEncoder::~AacEncoder() {
    if (state_->started) {
        state_->encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
        state_->encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
    }

    state_->encoder.release();

    if (state_->mfStarted)
        MFShutdown();
}

bool AacEncoder::ok() const {
    return !state_->broken.load();
}

const std::string& AacEncoder::error() const {
    return state_->error;
}

void AacEncoder::State::fail(std::string message) {
    if (broken.load())
        return;

    error = std::move(message);
    broken.store(true);
}

void AacEncoder::State::fail(const char* what, HRESULT result) {
    if (broken.load())
        return;

    char code[16];
    static_cast<void>(
        std::snprintf(code, sizeof code, "0x%08lx", static_cast<unsigned long>(result)));
    fail(std::string(what) + " (" + code + ")");
}

void AacEncoder::write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) {
    auto& state = *state_;
    if (!ok() || frames == 0)
        return;

    const size_t count = frames * state.channels;
    state.toPcm16.convert(samples, count, state.pcm);

    const auto bytes = static_cast<DWORD>(count * sizeof(std::int16_t));

    pfc::com_ptr_t<IMFMediaBuffer> buffer;
    if (FAILED(MFCreateMemoryBuffer(bytes, buffer.receive_ptr())))
        return;

    BYTE* target = nullptr;
    if (FAILED(buffer->Lock(&target, nullptr, nullptr)))
        return;
    memcpy(target, state.pcm.data(), bytes);
    buffer->Unlock();
    buffer->SetCurrentLength(bytes);

    const LONGLONG duration =
        static_cast<LONGLONG>(frames) * 10000000 / static_cast<LONGLONG>(state.sampleRate);

    pfc::com_ptr_t<IMFSample> sample;
    if (FAILED(MFCreateSample(sample.receive_ptr())))
        return;
    sample->AddBuffer(buffer.get_ptr());
    // Media Foundation refuses a sample lacking either time or duration with 0xc00d36c8.
    sample->SetSampleTime(state.time);
    sample->SetSampleDuration(duration);
    state.time += duration;

    if (const HRESULT result = state.encoder->ProcessInput(0, sample.get_ptr(), 0);
        FAILED(result)) {
        state.fail("the encoder refused input", result);
        return;
    }

    MFT_OUTPUT_STREAM_INFO info{};
    state.encoder->GetOutputStreamInfo(0, &info);

    for (;;) {
        pfc::com_ptr_t<IMFMediaBuffer> outBuffer;
        if (FAILED(
                MFCreateMemoryBuffer(std::max<DWORD>(info.cbSize, 4096), outBuffer.receive_ptr())))
            return;

        pfc::com_ptr_t<IMFSample> outSample;
        if (FAILED(MFCreateSample(outSample.receive_ptr())))
            return;
        outSample->AddBuffer(outBuffer.get_ptr());

        MFT_OUTPUT_DATA_BUFFER produced{};
        produced.pSample = outSample.get_ptr();
        DWORD status = 0;

        const HRESULT result = state.encoder->ProcessOutput(0, 1, &produced, &status);

        // Media Foundation hands back the events already referenced, for the caller to
        // release.
        pfc::com_ptr_t<IMFCollection> events;
        events.attach(produced.pEvents);

        // A transform declaring MFT_OUTPUT_STREAM_INFO_PROVIDES_SAMPLES replaces the sample
        // it was handed, and the replacement is the caller's to release. This encoder does
        // not, which is why allocating one above is right here at all.
        pfc::com_ptr_t<IMFSample> replacement;
        if (produced.pSample != outSample.get_ptr())
            replacement.attach(produced.pSample);

        if (result == MF_E_TRANSFORM_NEED_MORE_INPUT)
            return;
        if (FAILED(result)) {
            state.fail("the encoder failed mid-stream", result);
            return;
        }

        // Read through what came back rather than what went in, so a replaced sample is not
        // silently read as an empty buffer.
        pfc::com_ptr_t<IMFMediaBuffer> filled;
        if (produced.pSample == nullptr ||
            FAILED(produced.pSample->ConvertToContiguousBuffer(filled.receive_ptr())))
            return;

        BYTE* data = nullptr;
        DWORD length = 0;
        if (FAILED(filled->Lock(&data, nullptr, &length)))
            return;
        const BufferLock unlock(filled.get_ptr());

        if (length > 0) {
            appendAdtsHeader(out, length, state.frequencyIndex, state.channels);
            out.insert(out.end(), data, data + length);
        }
    }
}

}  // namespace jean
