#pragma once

#include "core/pcm_ring.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace jean {

// Bytes of encoded audio a second at this bitrate. Every buffer in the pipeline is sized in
// seconds and spent in bytes, and the conversion between the two is this and nothing else.
constexpr int bytesPerSecond(int bitrate) {
    return bitrate / 8;
}

// One format's encoder, fed interleaved float by the one encoder thread. A failed encoder stays
// failed, and its error says why.
class StreamEncoder {
public:
    virtual ~StreamEncoder() = default;

    virtual bool ok() const = 0;
    virtual const std::string& error() const = 0;

    // Appends only what a listener joining at the end of `out` can start decoding from.
    virtual void write(const float* samples, size_t frames, std::vector<std::uint8_t>& out) = 0;

    virtual void dropHeld() = 0;

    StreamEncoder(const StreamEncoder&) = delete;
    StreamEncoder& operator=(const StreamEncoder&) = delete;

protected:
    StreamEncoder() = default;
};

class StreamListener {
public:
    virtual ~StreamListener() = default;

    // Blocks until bytes are available. False ends the response, which is how a listener
    // that fell too far behind is dropped.
    //
    // True with `out` empty means nothing arrived yet, and the caller MUST take it as a
    // chance to check that the client is still there: a paused player produces no audio, and
    // a socket is only ever found dead by writing to it.
    //
    // A blocked call delays HttpServer::stop(), so whatever supplies these MUST unblock
    // every listener before the server is stopped.
    virtual bool next(std::vector<std::uint8_t>& out) = 0;

    StreamListener(const StreamListener&) = delete;
    StreamListener& operator=(const StreamListener&) = delete;

protected:
    StreamListener() = default;
};

class PcmSource {
public:
    virtual ~PcmSource() = default;

    PcmSource(const PcmSource&) = delete;
    PcmSource& operator=(const PcmSource&) = delete;

protected:
    PcmSource() = default;
};

using PcmSourceFactory = std::function<std::unique_ptr<PcmSource>(PcmRing&)>;

struct OpenedStream {
    std::string contentType;
    std::unique_ptr<StreamListener> listener;
};

using StreamOpener = std::function<OpenedStream(const std::string& format)>;

}  // namespace jean
