#pragma once

#include "core/player_state.h"
#include "core/stream.h"

#include <memory>
#include <string>
#include <vector>

namespace jean {

class Streamer {
public:
    // Main thread only; registering the capture callback requires it. playerState must outlive
    // this: the encoder thread calls timelineMarked() on it for every mark laid, until stop()
    // joins that thread.
    Streamer(int opusBitrate, int aacBitrate, double bufferSeconds, PlayerStateStore& playerState);
    ~Streamer();

    StreamOpener opener() const;

    std::vector<std::string> formats() const;

    std::string timeline() const;

    // Unblocks every session and joins the encoder thread. MUST run before
    // HttpServer::stop(), which joins connection threads that are sitting in a session.
    void stop();

    Streamer(const Streamer&) = delete;
    Streamer& operator=(const Streamer&) = delete;

    // Public only so the encoder thread and a session can name them; both are defined in
    // streamer.cpp and neither escapes it.
    struct State;
    struct Capture;

private:
    std::shared_ptr<State> state_;
    std::unique_ptr<Capture> capture_;
};

}  // namespace jean
