#include "fb2k/PCH.h"

#include "fb2k/aac_encoder.h"

#include "core/pcm16.h"
#include "core/stream.h"

#include <mfapi.h>
#include <mferror.h>
#include <mftransform.h>
#include <wmcodecdsp.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <optional>
#include <string>
#include <utility>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")

namespace jean {

namespace {

constexpr unsigned kBitsPerSample = 16;
constexpr LONGLONG kHundredNanosecondsPerSecond = 10000000;

std::string failure(const char* what, HRESULT result) {
    char code[16];
    static_cast<void>(
        std::snprintf(code, sizeof code, "0x%08lx", static_cast<unsigned long>(result)));
    return std::string(what) + " (" + code + ")";
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

class MediaFoundationCodec final : public AacCodec {
public:
    MediaFoundationCodec() = default;
    ~MediaFoundationCodec() override { release(); }

    std::optional<std::string> open(unsigned channels, unsigned sampleRate, int bitrate) override;
    std::optional<std::string> encode(std::span<const float> block,
                                      std::vector<std::vector<std::uint8_t>>& packets) override;
    std::optional<std::string> reset() override;

    void close() override { release(); }

private:
    std::optional<std::string> refuse(std::string reason) {
        release();
        return reason;
    }

    void release();

    pfc::com_ptr_t<IMFTransform> encoder_;

    bool mfStarted_ = false;
    bool started_ = false;

    LONGLONG blockDuration_ = 0;
    LONGLONG time_ = 0;

    Pcm16Converter toPcm16_;
    std::vector<std::int16_t> pcm_;
};

std::optional<std::string> MediaFoundationCodec::open(unsigned channels, unsigned sampleRate,
                                                      int bitrate) {
    blockDuration_ = static_cast<LONGLONG>(kAacBlockFrames) * kHundredNanosecondsPerSecond /
                     static_cast<LONGLONG>(sampleRate);

    if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_LITE)))
        return refuse("could not start Media Foundation");
    mfStarted_ = true;

    // fb2k::audioEncoder has no implementations registered in foobar2000 or its common
    // components, so AAC comes from the one Windows ships.
    if (FAILED(CoCreateInstance(CLSID_AACMFTEncoder, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(encoder_.receive_ptr()))))
        return refuse("this Windows has no AAC encoder");

    pfc::com_ptr_t<IMFMediaType> output;
    if (FAILED(MFCreateMediaType(output.receive_ptr())))
        return refuse("could not describe the AAC output");

    output->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    output->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC);
    describeAudio(output, channels, sampleRate);
    output->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
                      static_cast<UINT32>(bytesPerSecond(bitrate)));

    // Payload type 0 leaves the ADTS header on each frame for this component to write. Media
    // Foundation wants the output type set before the input type.
    output->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0);

    if (FAILED(encoder_->SetOutputType(0, output.get_ptr(), 0)))
        return refuse("the AAC encoder refused these output settings");

    pfc::com_ptr_t<IMFMediaType> input;
    if (FAILED(MFCreateMediaType(input.receive_ptr())))
        return refuse("could not describe the PCM input");

    input->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    input->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
    describeAudio(input, channels, sampleRate);

    if (FAILED(encoder_->SetInputType(0, input.get_ptr(), 0)))
        return refuse("the AAC encoder refused 16-bit PCM");

    encoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
    encoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
    started_ = true;
    return std::nullopt;
}

void MediaFoundationCodec::release() {
    if (started_) {
        encoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
        encoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
    }
    started_ = false;

    encoder_.release();

    if (mfStarted_)
        MFShutdown();
    mfStarted_ = false;
}

std::optional<std::string> MediaFoundationCodec::reset() {
    // MFT_MESSAGE_COMMAND_FLUSH tells a transform to discard the samples it holds and leaves it
    // accepting input with its media types kept.
    if (const HRESULT result = encoder_->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
        FAILED(result))
        return failure("the AAC encoder could not be flushed", result);

    time_ = 0;
    toPcm16_ = Pcm16Converter();
    return std::nullopt;
}

std::optional<std::string> MediaFoundationCodec::encode(
    std::span<const float> block, std::vector<std::vector<std::uint8_t>>& packets) {
    toPcm16_.convert(block.data(), block.size(), pcm_);

    const auto bytes = static_cast<DWORD>(block.size() * sizeof(std::int16_t));

    pfc::com_ptr_t<IMFMediaBuffer> buffer;
    if (const HRESULT result = MFCreateMemoryBuffer(bytes, buffer.receive_ptr()); FAILED(result))
        return failure("could not allocate the PCM buffer", result);

    BYTE* target = nullptr;
    if (const HRESULT result = buffer->Lock(&target, nullptr, nullptr); FAILED(result))
        return failure("could not lock the PCM buffer", result);
    memcpy(target, pcm_.data(), bytes);
    buffer->Unlock();
    buffer->SetCurrentLength(bytes);

    pfc::com_ptr_t<IMFSample> sample;
    if (const HRESULT result = MFCreateSample(sample.receive_ptr()); FAILED(result))
        return failure("could not allocate the PCM sample", result);
    sample->AddBuffer(buffer.get_ptr());
    // Media Foundation refuses a sample lacking either time or duration with 0xc00d36c8.
    sample->SetSampleTime(time_);
    sample->SetSampleDuration(blockDuration_);
    time_ += blockDuration_;

    if (const HRESULT result = encoder_->ProcessInput(0, sample.get_ptr(), 0); FAILED(result))
        return failure("the encoder refused input", result);

    MFT_OUTPUT_STREAM_INFO info{};
    encoder_->GetOutputStreamInfo(0, &info);

    for (;;) {
        pfc::com_ptr_t<IMFMediaBuffer> outBuffer;
        if (const HRESULT result =
                MFCreateMemoryBuffer(std::max<DWORD>(info.cbSize, 4096), outBuffer.receive_ptr());
            FAILED(result))
            return failure("could not allocate the output buffer", result);

        pfc::com_ptr_t<IMFSample> outSample;
        if (const HRESULT result = MFCreateSample(outSample.receive_ptr()); FAILED(result))
            return failure("could not allocate the output sample", result);
        outSample->AddBuffer(outBuffer.get_ptr());

        MFT_OUTPUT_DATA_BUFFER produced{};
        produced.pSample = outSample.get_ptr();
        DWORD status = 0;

        const HRESULT result = encoder_->ProcessOutput(0, 1, &produced, &status);

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
            return std::nullopt;
        if (FAILED(result))
            return failure("the encoder failed mid-stream", result);

        // Read through what came back rather than what went in, so a replaced sample is not
        // silently read as an empty buffer.
        if (produced.pSample == nullptr)
            return std::string("the encoder answered without a sample");

        pfc::com_ptr_t<IMFMediaBuffer> filled;
        if (const HRESULT converted =
                produced.pSample->ConvertToContiguousBuffer(filled.receive_ptr());
            FAILED(converted))
            return failure("could not read the encoded frame", converted);

        BYTE* data = nullptr;
        DWORD length = 0;
        if (const HRESULT locked = filled->Lock(&data, nullptr, &length); FAILED(locked))
            return failure("could not lock the encoded frame", locked);
        const BufferLock unlock(filled.get_ptr());

        if (length > 0)
            packets.emplace_back(data, data + length);
    }
}

}  // namespace

std::unique_ptr<AacCodec> platformAacCodec() {
    return std::make_unique<MediaFoundationCodec>();
}

}  // namespace jean
