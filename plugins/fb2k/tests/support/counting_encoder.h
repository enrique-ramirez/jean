#pragma once

#include "core/stream.h"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <vector>

namespace jean::testing {

constexpr size_t kBlockFrames = 480;
constexpr unsigned kBlockChannels = 2;
std::vector<float> blockOf(int id);

struct CountingEncoderOptions {
    size_t heldBlocks = 0;
    std::string startFailure;
};

class CountingEncoder final : public StreamEncoder {
public:
    explicit CountingEncoder(char tag, CountingEncoderOptions options = {});

    void failOnWrite(size_t nth, std::string reason, std::string lastBytes = {});

    bool ok() const override { return !failed_; }
    const std::string& error() const override { return error_; }
    void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) override;
    void dropHeld() override;
    size_t heldFrames() const override { return held_.size() * kBlockFrames; }
    unsigned channels() const override { return kBlockChannels; }

    size_t writes() const { return writes_.load(); }
    size_t frames() const { return frames_.load(); }

    std::string bytesOf(int id) const;

    const std::vector<size_t>& writesBeforeEachDrop() const { return writesBeforeEachDrop_; }

private:
    const char tag_;
    const size_t heldBlocks_;

    bool failed_ = false;
    std::string error_;
    size_t failOn_ = 0;
    std::string failure_;
    std::string lastBytes_;

    std::deque<std::string> held_;
    std::vector<size_t> writesBeforeEachDrop_;
    std::atomic<size_t> writes_{0};
    std::atomic<size_t> frames_{0};
};

}  // namespace jean::testing
