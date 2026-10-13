#pragma once

#include "third_party/httplib.h"

#include "core/audience.h"
#include "core/http_server.h"
#include "core/reload.h"
#include "support/fixtures.h"
#include "third_party/json.hpp"

#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <vector>

namespace jean::testing {

class ManualClock {
public:
    std::chrono::steady_clock::time_point now() const {
        return std::chrono::steady_clock::time_point(
            std::chrono::steady_clock::duration(ticks_.load()));
    }

    void advance(std::chrono::steady_clock::duration by) { ticks_ += by.count(); }

private:
    std::atomic<std::chrono::steady_clock::rep> ticks_{0};
};

class TestServer {
public:
    // Where a client dials, which is not where the server binds: bindAddress defaults to 0.0.0.0.
    static constexpr char kClientHost[] = "127.0.0.1";

    // `library`, `playerState` and `nowPlayingArtwork` must outlive the server.
    explicit TestServer(Settings settings = servingSettings(),
                        const Player& player = servingPlayer(), Library* library = nullptr,
                        const TicketMint& mint = countingMint(),
                        PlayerStateStore* playerState = nullptr,
                        NowPlayingArtwork* nowPlayingArtwork = nullptr);

    // Only here does the audience, and so every session's grace, read the clock advanceClock moves.
    // Every other server's audience reads the real clock, which cases using
    // Audience::Clock::now() rely on.
    static TestServer onOneClock(Settings settings, const Player& player,
                                 const TicketMint& mint = countingMint());

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

    // Decides against the settings this server is running, applies the result, and keeps
    // `next` as what it is running from here on.
    ReloadDecision reload(const std::string& fileText) {
        const auto decision = decideReload(settings_, fileText);
        server_->applyReload(decision);
        settings_ = decision.next;
        return decision;
    }

    // A departed device's linger is invisible to a client on purpose, so a route test about
    // one reads the audience the server is driving.
    Audience& audience() const { return *audience_; }

    void advanceClock(std::chrono::steady_clock::duration by) const { clock_->advance(by); }

    httplib::Client client() const;

private:
    struct OnOneClock {};

    TestServer(OnOneClock /*oneClock*/, Settings settings, const Player& player,
               const TicketMint& mint);

    void listen(const Player& player, Library* library, const TicketMint& mint,
                PlayerStateStore* playerState, NowPlayingArtwork* nowPlayingArtwork);

    Settings settings_;

    // Shared rather than held, so the server's reading of it survives this object being moved.
    std::shared_ptr<ManualClock> clock_ = std::make_shared<ManualClock>();

    // Before the server, which unwinds connections into it as it stops.
    std::unique_ptr<Audience> audience_;
    std::unique_ptr<HttpServer> server_;
    ListenerStatus status_;
};

int freePort();

httplib::Result get(const TestServer& server, const std::string& path);
httplib::Result post(const TestServer& server, const std::string& path, const std::string& body);

// Any 2xx: a route that did what it was asked answers a document or a bare 204, and which one is
// that route's own case to pin.
bool accepted(const httplib::Result& response);

// The sentence a refusal names, and nothing where the body names none. Read rather than parsed
// straight, because an accepted request answers 204 with no body at all, and a case driving a
// list of routes should fail on the status it asked about rather than on a parse.
std::string errorOf(const httplib::Response& response);

nlohmann::json capabilitiesOf(const TestServer& server);

// cpp-httplib's client unwraps a gzip body before a caller ever sees it, so a test about the
// wire has to turn that off.
httplib::Client undecoding(const TestServer& server);

// The Accept-Encoding header that decides whether an answer is compressed at all.
httplib::Headers accepting(const char* encoding);

bool isGzip(const std::string& body);

}  // namespace jean::testing
