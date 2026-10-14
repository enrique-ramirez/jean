#include "support/aac.h"

#include "core/settings.h"
#include "third_party/doctest.h"

#ifdef JEAN_TESTS_HAVE_AAC
#include "fb2k/aac_encoder.h"
#include "fb2k/com_thread.h"
#endif

namespace jean::testing {

#ifdef JEAN_TESTS_HAVE_AAC

namespace {

// Media Foundation needs COM initialised on the thread that builds and drops the codec, and
// MFShutdown when the codec closes needs it still there. The members are declared in that order
// so COM goes last, on the thread that made the stream.
class ComScopedAacStream final : public StreamEncoder {
public:
    ComScopedAacStream(unsigned channels, unsigned sampleRate, int bitrate)
        : stream_(platformAacCodec(), channels, sampleRate, bitrate) {}

    bool ok() const override { return stream_.ok(); }
    const std::string& error() const override { return stream_.error(); }

    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) override {
        stream_.write(samples, frames, out);
    }

    void dropHeld() override { stream_.dropHeld(); }

private:
    const ComOnThisThread com_;
    AacStream stream_;
};

}  // namespace

std::unique_ptr<StreamEncoder> platformAacEncoder(unsigned channels, unsigned sampleRate,
                                                  int bitrate) {
    return std::make_unique<ComScopedAacStream>(channels, sampleRate, bitrate);
}

const AacCodecFacts& platformAacFacts() {
#ifdef _WIN32
    // Media Foundation's AAC encoder, measured on Windows 11: it returns its first frame for the
    // third 1024-sample block it is given and stays two frames behind its input from then on.
    static const AacCodecFacts facts{2};
#else
    // AudioToolbox's AAC encoder, measured on macOS 26.6: it returns a packet for every block from
    // the first, though its audio runs 2112 samples behind its input.
    static const AacCodecFacts facts{0};
#endif
    return facts;
}

#else

std::unique_ptr<StreamEncoder> platformAacEncoder(unsigned /*channels*/, unsigned /*sampleRate*/,
                                                  int /*bitrate*/) {
    return nullptr;
}

const AacCodecFacts& platformAacFacts() {
    static const AacCodecFacts facts{};
    return facts;
}

#endif

namespace {

AacUnderTest decideAndSay() {
    const auto encoder = platformAacEncoder(2, 48000, kAacBitrates[0]);

    if (!encoder) {
        MESSAGE("AAC not tested: no AAC encoder is built into this suite.");
        return AacUnderTest::NotBuilt;
    }

    if (!encoder->ok()) {
        MESSAGE("AAC not tested: this platform's AAC encoder is unavailable on this machine (",
                encoder->error(), ").");
        return AacUnderTest::Unavailable;
    }

    MESSAGE("AAC tested through this platform's codec.");
    return AacUnderTest::Tested;
}

}  // namespace

AacUnderTest aacUnderTest() {
    static const AacUnderTest decided = decideAndSay();
    return decided;
}

}  // namespace jean::testing
