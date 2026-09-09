#include "core/broadcast_ring.h"

#include <algorithm>

namespace jean {

BroadcastRing::BroadcastRing(size_t capacityBytes) : buffer_(std::max<size_t>(capacityBytes, 1)) {}

void BroadcastRing::write(const std::uint8_t* data, size_t size) {
    if (data == nullptr || size == 0)
        return;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        if (closed_)
            return;

        if (size > buffer_.size()) {
            const size_t skipped = size - buffer_.size();
            data += skipped;
            size -= skipped;
            written_ += skipped;
        }

        const size_t start = static_cast<size_t>(written_ % buffer_.size());
        const size_t toEnd = std::min(size, buffer_.size() - start);

        std::copy(data, data + toEnd, buffer_.begin() + static_cast<std::ptrdiff_t>(start));
        std::copy(data + toEnd, data + size, buffer_.begin());
        written_ += size;
    }

    ready_.notify_all();
}

BroadcastRing::Cursor BroadcastRing::subscribe() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return written_;
}

BroadcastRing::Read BroadcastRing::read(Cursor& cursor, std::vector<std::uint8_t>& out,
                                        std::chrono::milliseconds patience) {
    std::unique_lock<std::mutex> held(mutex_);
    if (!ready_.wait_for(held, patience, [this, &cursor] { return cursor < written_ || closed_; }))
        return Read::Idle;

    // The cursor is the caller's to hold; unchecked, a value ahead of the writer
    // underflows into an enormous byte count.
    if (cursor > written_ || written_ - cursor > buffer_.size())
        return Read::Lapped;

    if (cursor == written_)
        return Read::Closed;

    const size_t available = static_cast<size_t>(written_ - cursor);
    const size_t start = static_cast<size_t>(cursor % buffer_.size());
    const size_t count = std::min(available, buffer_.size() - start);
    const auto from = buffer_.begin() + static_cast<std::ptrdiff_t>(start);

    out.assign(from, from + static_cast<std::ptrdiff_t>(count));
    cursor += count;
    return Read::Ok;
}

void BroadcastRing::close() {
    {
        const std::lock_guard<std::mutex> held(mutex_);
        closed_ = true;
    }

    ready_.notify_all();
}

BroadcastRing::Cursor BroadcastRing::written() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return written_;
}

}  // namespace jean
