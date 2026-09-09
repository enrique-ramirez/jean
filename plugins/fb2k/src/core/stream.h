#pragma once

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

class StreamSession {
public:
    virtual ~StreamSession() = default;

    // Blocks until bytes are available. False ends the response, which is how a listener
    // that fell too far behind is dropped.
    //
    // True with `out` empty means nothing arrived yet, and the caller MUST take it as a
    // chance to check that the client is still there: a paused player produces no audio, and
    // a socket is only ever found dead by writing to it.
    //
    // A blocked call delays HttpServer::stop(), so whatever supplies these MUST unblock
    // every session before the server is stopped.
    virtual bool next(std::vector<std::uint8_t>& out) = 0;

    StreamSession(const StreamSession&) = delete;
    StreamSession& operator=(const StreamSession&) = delete;

protected:
    StreamSession() = default;
};

struct OpenedStream {
    std::string contentType;
    std::unique_ptr<StreamSession> session;
};

// A null session refuses the connection.
using StreamOpener = std::function<OpenedStream(const std::string& format)>;

}  // namespace jean
