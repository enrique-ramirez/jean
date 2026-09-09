#pragma once

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <vector>

namespace jean {

// Fans one encoded stream out to every listener. A listener that falls further behind
// than the buffer is lapped; the caller MUST end that response rather than let the
// reader hold up the encoder.
class BroadcastRing {
public:
    explicit BroadcastRing(size_t capacityBytes);

    enum class Read { Ok, Idle, Lapped, Closed };

    using Cursor = std::uint64_t;

    void write(const std::uint8_t* data, size_t size);

    // Starts at the live edge. Anything a decoder needs first, such as Ogg header
    // pages, is the caller's to send.
    Cursor subscribe() const;

    // Blocks until bytes are available, the ring closes, or `patience` runs out. MAY return
    // fewer bytes than are available, so callers loop.
    //
    // Idle is neither an error nor a stop: it hands control back so the caller can check
    // the connection is still there (see StreamSession::next in stream.h). A paused player
    // writes nothing here, so blocking forever would never notice a listener gone.
    Read read(Cursor& cursor, std::vector<std::uint8_t>& out, std::chrono::milliseconds patience);

    void close();

    Cursor written() const;

    BroadcastRing(const BroadcastRing&) = delete;
    BroadcastRing& operator=(const BroadcastRing&) = delete;

private:
    mutable std::mutex mutex_;
    std::condition_variable ready_;
    std::vector<std::uint8_t> buffer_;
    Cursor written_ = 0;
    bool closed_ = false;
};

}  // namespace jean
