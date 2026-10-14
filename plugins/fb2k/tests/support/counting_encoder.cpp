#include "support/counting_encoder.h"

#include <utility>

namespace jean::testing {

std::vector<float> blockOf(int id) {
    constexpr size_t kChannels = 2;
    return std::vector<float>(kBlockFrames * kChannels, static_cast<float>(id));
}

CountingEncoder::CountingEncoder(char tag, CountingEncoderOptions options)
    : tag_(tag),
      heldBlocks_(options.heldBlocks),
      failed_(!options.startFailure.empty()),
      error_(std::move(options.startFailure)) {}

void CountingEncoder::failOnWrite(size_t nth, std::string reason, std::string lastBytes) {
    failOn_ = nth;
    failure_ = std::move(reason);
    lastBytes_ = std::move(lastBytes);
}

void CountingEncoder::write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) {
    const size_t call = ++writes_;
    frames_ += frames;

    // Written on every call, as a real encoder's state is, so a reader on another thread is one a
    // sanitizer can see.
    failed_ = failed_ || call == failOn_;
    if (failed_) {
        if (call == failOn_) {
            error_ = failure_;
            out.insert(out.end(), lastBytes_.begin(), lastBytes_.end());
        }
        return;
    }

    held_.push_back(bytesOf(frames == 0 ? 0 : static_cast<int>(samples[0])));
    if (held_.size() <= heldBlocks_)
        return;

    out.insert(out.end(), held_.front().begin(), held_.front().end());
    held_.pop_front();
}

void CountingEncoder::dropHeld() {
    held_.clear();
    writesBeforeEachDrop_.push_back(writes_.load());
}

std::string CountingEncoder::bytesOf(int id) const {
    return tag_ + std::to_string(id) + ";";
}

}  // namespace jean::testing
