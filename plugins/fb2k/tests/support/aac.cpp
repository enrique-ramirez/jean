#include "support/aac.h"

#include "core/settings.h"
#include "third_party/doctest.h"

#ifdef JEAN_TESTS_HAVE_AAC
#include "fb2k/aac_encoder.h"
#include "fb2k/com_thread.h"

#include <utility>
#endif

namespace jean::testing {

#ifdef JEAN_TESTS_HAVE_AAC

namespace {

// Media Foundation needs COM initialised on the thread that builds and drops the encoder, and
// MFShutdown in the encoder's destructor needs it still there. The members are declared in that
// order so COM goes last, on the thread that made the encoder.
class ComScopedAacEncoder final : public StreamEncoder {
public:
    ComScopedAacEncoder(unsigned channels, unsigned sampleRate, int bitrate)
        : encoder_(channels, sampleRate, bitrate) {}

    bool ok() const override { return encoder_.ok(); }
    const std::string& error() const override { return encoder_.error(); }

    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) override {
        encoder_.write(samples, frames, out);
    }

private:
    const ComOnThisThread com_;
    AacEncoder encoder_;
};

constexpr char kRatesTaken[] = "44100 or 48000 Hz";
constexpr char kCodecRefused[] = "refused these output settings";

}  // namespace

std::unique_ptr<StreamEncoder> platformAacEncoder(unsigned channels, unsigned sampleRate,
                                                  int bitrate) {
    return std::make_unique<ComScopedAacEncoder>(channels, sampleRate, bitrate);
}

const AacCodecFacts& platformAacFacts() {
    // Media Foundation's AAC encoder, measured on Windows 11: it returns its first frame for the
    // third 1024-sample block it is given and stays two frames behind its input from then on. It
    // refuses three, four, five and seven channels, mono above 192000 bit/s, and a bitrate between
    // the ones it offers.
    static const AacCodecFacts facts{
        2,
        {
            {{2, 8000, 128000}, kRatesTaken},
            {{2, 22050, 128000}, kRatesTaken},
            {{2, 32000, 128000}, kRatesTaken},
            {{2, 88200, 128000}, kRatesTaken},
            {{2, 96000, 128000}, kRatesTaken},
            {{1, 96000, 128000}, kRatesTaken},
            {{3, 48000, 128000}, kCodecRefused},
            {{4, 48000, 128000}, kCodecRefused},
            {{5, 48000, 128000}, kCodecRefused},
            {{7, 48000, 128000}, kCodecRefused},
            {{2, 48000, 8000}, kCodecRefused},
            {{2, 48000, 95999}, kCodecRefused},
            {{2, 48000, 100000}, kCodecRefused},
            {{2, 48000, 224000}, kCodecRefused},
            {{1, 48000, 256000}, kCodecRefused},
        },
    };
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
