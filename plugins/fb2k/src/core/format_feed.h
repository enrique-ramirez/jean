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

    // A listener is here who was here for the last block this format encoded.
    bool heardThrough() const;

    std::unique_ptr<StreamListener> listen(std::shared_ptr<const void> owner = nullptr);

    void feed(const float* samples, size_t frames);

    // Replaces what the encoder holds with as long a silence, so a listener hearing through hears
    // none of it and its stream keeps its length.
    void silenceHeld();

    void close();

    FormatFeed(const FormatFeed&) = delete;
    FormatFeed& operator=(const FormatFeed&) = delete;

private:
    class Listener;

    bool publishLocked();
    void reportFailure() const;

    const std::string name_;
    const std::string contentType_;
    const std::chrono::milliseconds idlePatience_;
    StreamEncoder& encoder_;
    const std::vector<std::uint8_t> preamble_;

    mutable std::mutex mutex_;
    BroadcastRing ring_;
    std::atomic<int> listeners_{0};
    bool unheard_ = false;
    std::atomic<bool> working_;
    std::vector<std::uint8_t> encoded_;
    std::vector<float> silence_;
};

// What becomes of the audio the converter and the encoders hold from before a block, decided as
// the block arrives. Where nobody is listening the block itself is not encoded.
enum class HeldAudio { nobodyListening, keep, drop, silence };

HeldAudio heldAudioBefore(const std::vector<FormatFeed*>& feeds, bool cut);

}  // namespace jean
