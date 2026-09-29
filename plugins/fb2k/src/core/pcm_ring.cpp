#include "core/pcm_ring.h"

#include <numeric>
#include <utility>

namespace jean {

bool operator==(const AudioSpec& a, const AudioSpec& b) {
    return a.sampleRate == b.sampleRate && a.channels == b.channels;
}

size_t PcmBlock::frames() const {
    return spec.channels == 0 ? 0 : samples.size() / spec.channels;
}

double PcmBlock::seconds() const {
    return spec.sampleRate == 0 ? 0.0 : static_cast<double>(frames()) / spec.sampleRate;
}

PcmRing::PcmRing(double capacitySeconds) : capacitySeconds_(capacitySeconds) {}

void PcmRing::write(PcmBlock block) {
    if (block.frames() == 0)
        return;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        if (closed_)
            return;

        blocks_.push_back(std::move(block));

        while (blocks_.size() > 1 && bufferedLocked() > capacitySeconds_)
            blocks_.pop_front();
    }

    ready_.notify_one();
}

bool PcmRing::read(PcmBlock& out) {
    std::unique_lock<std::mutex> held(mutex_);
    ++waiting_;
    ready_.wait(held, [this] { return !blocks_.empty() || closed_; });
    --waiting_;

    if (blocks_.empty())
        return false;

    out = std::move(blocks_.front());
    blocks_.pop_front();
    return true;
}

void PcmRing::close() {
    {
        const std::lock_guard<std::mutex> held(mutex_);
        closed_ = true;
    }

    ready_.notify_all();
}

size_t PcmRing::waitingReaders() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return waiting_;
}

double PcmRing::bufferedLocked() const {
    return std::accumulate(
        blocks_.begin(), blocks_.end(), 0.0,
        [](double total, const PcmBlock& block) { return total + block.seconds(); });
}

}  // namespace jean
