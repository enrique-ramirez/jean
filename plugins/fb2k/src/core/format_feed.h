#pragma once

#include "core/broadcast_ring.h"
#include "core/stream.h"

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

class FormatFeed {
public:
    FormatFeed(std::string name, std::string contentType, size_t ringBytes,
               std::chrono::milliseconds idlePatience, StreamEncoder& encoder,
               std::vector<std::uint8_t> preamble = {});

    const std::string& name() const;
    const std::string& contentType() const;

    bool working() const;

    bool hasListeners() const;

    std::unique_ptr<StreamListener> listen(std::shared_ptr<const void> owner = nullptr);

    void feed(const float* samples, size_t frames);

    void close();

    FormatFeed(const FormatFeed&) = delete;
    FormatFeed& operator=(const FormatFeed&) = delete;

private:
    class Listener;

    const std::string name_;
    const std::string contentType_;
    const std::chrono::milliseconds idlePatience_;
    StreamEncoder& encoder_;
    const std::vector<std::uint8_t> preamble_;

    std::mutex mutex_;
    BroadcastRing ring_;
    std::atomic<int> listeners_{0};
    bool unheard_ = false;
    std::atomic<bool> working_;
    std::vector<std::uint8_t> encoded_;
};

}  // namespace jean
