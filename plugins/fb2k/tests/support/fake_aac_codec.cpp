#include "support/fake_aac_codec.h"

#include <algorithm>
#include <span>
#include <utility>

namespace jean::testing {

namespace {

class FakeAacCodec : public AacCodec {
public:
    FakeAacCodec(std::shared_ptr<AacCodecCalls> calls, AacCodecScript script,
                 std::optional<std::string> refusesToReset)
        : calls_(std::move(calls)),
          script_(std::move(script)),
          refusesToReset_(std::move(refusesToReset)) {}

    std::optional<std::string> open(unsigned channels, unsigned sampleRate, int bitrate) override {
        calls_->opened.push_back({channels, sampleRate, bitrate});
        return script_.refusesToOpen;
    }

    std::optional<std::string> encode(std::span<const float> block,
                                      std::vector<std::vector<std::uint8_t>>& packets) override {
        const size_t asked = calls_->blocks.size();
        calls_->blocks.emplace_back(block.begin(), block.end());

        if (asked >= script_.blocks.size()) {
            packets.push_back(aacPayload(kAacUnscriptedPayloadBytes));
            return std::nullopt;
        }

        const auto& answer = script_.blocks[asked];
        packets.insert(packets.end(), answer.packets.begin(), answer.packets.end());
        return answer.failure;
    }

    std::optional<std::string> reset() override {
        calls_->blocksBeforeEachReset.push_back(calls_->blocks.size());
        return refusesToReset_;
    }

    void close() override { ++calls_->closed; }

private:
    std::shared_ptr<AacCodecCalls> calls_;
    AacCodecScript script_;
    std::optional<std::string> refusesToReset_;
};

}  // namespace

std::vector<std::uint8_t> aacPayload(size_t bytes) {
    std::vector<std::uint8_t> payload(bytes);
    std::generate(payload.begin(), payload.end(), [at = size_t{0}]() mutable {
        return static_cast<std::uint8_t>(((at++ * 7U) + 3U) & 0xFFU);
    });
    return payload;
}

std::unique_ptr<AacCodec> fakeAacCodec(std::shared_ptr<AacCodecCalls> calls, AacCodecScript script,
                                       std::optional<std::string> refusesToReset) {
    return std::make_unique<FakeAacCodec>(std::move(calls), std::move(script),
                                          std::move(refusesToReset));
}

}  // namespace jean::testing
