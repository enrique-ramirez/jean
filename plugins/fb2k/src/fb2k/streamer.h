#pragma once

#include "core/stream.h"

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace jean {

class Streamer {
public:
    Streamer(int opusBitrate, int aacBitrate, double bufferSeconds, std::function<void()> marked,
             const PcmSourceFactory& source);
    ~Streamer();

    StreamOpener opener() const;

    std::vector<std::string> formats() const;

    std::string timeline() const;

    // Unblocks every listener and joins the encoder thread. MUST run before
    // HttpServer::stop(), which joins connection threads that are sitting in a listener.
    void stop();

    Streamer(const Streamer&) = delete;
    Streamer& operator=(const Streamer&) = delete;

    struct State;

private:
    std::shared_ptr<State> state_;
    std::unique_ptr<PcmSource> source_;
};

// The player's own output, captured as it plays. Main thread only: foobar2000 requires it to
// register the capture callback.
PcmSourceFactory engineCapture();

}  // namespace jean
