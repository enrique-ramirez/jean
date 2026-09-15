#pragma once

#include "third_party/httplib.h"

#include "core/audience.h"
#include "core/http_server.h"
#include "support/fixtures.h"

#include <memory>
#include <string>
#include <vector>

namespace jean::testing {

class TestServer {
public:
    // Where a client dials, which is not where the server binds: bindAddress defaults to 0.0.0.0.
    static constexpr char kClientHost[] = "127.0.0.1";

    // `library`, `playerState` and `nowPlayingArtwork` must outlive the server.
    explicit TestServer(Settings settings = servingSettings(), const Player& player = servingPlayer(),
                        Library* library = nullptr, const TicketMint& mint = countingMint(),
                        PlayerStateStore* playerState = nullptr,
                        NowPlayingArtwork* nowPlayingArtwork = nullptr);

    struct WriterLog {
        std::vector<TagWrite> calls;
        TagWriteOutcome answer = TagWriteOutcome::written;
    };

    // A player that remembers what it was given. The pointer must outlive the server.
    static Player recordingWriter(WriterLog* log);

    static Player writing(TagWriter writeTags);
    static Player showing(ArtworkReader readArtwork);
    static Player listing(PlaylistLister listPlaylists);
    static Player streaming(StreamOpener openStream,
                            std::vector<std::string> formats = {"opus", "aac"});

    const ListenerStatus& status() const { return status_; }
    int port() const { return settings_.port; }

    // Pairing is opened at the player, so a test has to stand in for the person at it.
    HttpServer& component() const { return *server_; }

    // A departed device's linger is invisible to a client on purpose, so a route test about
    // one reads the audience the server is driving.
    Audience& audience() const { return *audience_; }

    httplib::Client client() const;

    static httplib::Headers bearer(const std::string& token = kToken);

private:
    Settings settings_;

    // Before the server, which unwinds connections into it as it stops.
    std::unique_ptr<Audience> audience_;
    std::unique_ptr<HttpServer> server_;
    ListenerStatus status_;
};

int freePort();

httplib::Result get(const TestServer& server, const std::string& path);
httplib::Result post(const TestServer& server, const std::string& path, const std::string& body);

// cpp-httplib's client unwraps a gzip body before a caller ever sees it, so a test about the
// wire has to turn that off.
httplib::Client undecoding(const TestServer& server);

// Bearer plus the Accept-Encoding that decides whether an answer is compressed at all.
httplib::Headers accepting(const char* encoding);

bool isGzip(const std::string& body);

}  // namespace jean::testing
