#pragma once

#include "core/aac_stream.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace jean::testing {

struct AacCodecCalls {
    struct Opened {
        unsigned channels = 0;
        unsigned sampleRate = 0;
        int bitrate = 0;

        bool operator==(const Opened&) const = default;
    };

    std::vector<Opened> opened;
    std::vector<std::vector<float>> blocks;
    std::vector<size_t> blocksBeforeEachReset;
    int closed = 0;
};

struct AacBlockAnswer {
    std::vector<std::vector<std::uint8_t>> packets;
    std::optional<std::string> failure;
};

struct AacCodecScript {
    std::optional<std::string> refusesToOpen;
    std::vector<AacBlockAnswer> blocks;
};

constexpr size_t kAacUnscriptedPayloadBytes = 5;

std::vector<std::uint8_t> aacPayload(size_t bytes);

std::unique_ptr<AacCodec> fakeAacCodec(std::shared_ptr<AacCodecCalls> calls,
                                       AacCodecScript script = {},
                                       std::optional<std::string> refusesToReset = std::nullopt);

}  // namespace jean::testing
