#include "support/test_server.h"

namespace jean::testing {

int freePort() {
    // Binding port 0 makes the OS choose. A listening socket that never accepted a connection
    // leaves no TIME_WAIT behind, so the port is reusable the moment the probe closes.
    httplib::Server probe;
    const int port = probe.bind_to_any_port(TestServer::kClientHost);
    probe.stop();
    return port;
}

Player TestServer::recordingWriter(WriterLog* log) {
    return writing([log](const TagWrite& write) {
        log->calls.push_back(write);
        return log->answer;
    });
}

Player TestServer::writing(TagWriter writeTags) {
    Player player;
    player.writeTags = std::move(writeTags);
    return player;
}

Player TestServer::listing(PlaylistLister listPlaylists) {
    Player player;
    player.listPlaylists = std::move(listPlaylists);
    return player;
}

Player TestServer::streaming(StreamOpener openStream, std::vector<std::string> formats) {
    Player player;
    player.openStream = std::move(openStream);
    player.streamFormats = std::move(formats);
    return player;
}

TestServer::TestServer(Settings settings, const Player& player, Library* library,
                       const TicketMint& mint)
    : settings_(std::move(settings)),
      audience_(std::make_unique<Audience>(settings_.maxConcurrentStreams,
                                           std::chrono::seconds(kMuteLingerSeconds))) {
    // freePort() has to close its probe before we bind, so something else occasionally takes the
    // port in between. Retry that rather than fail somewhere unrelated; a refusal the component
    // made on purpose, such as a missing token, is the answer the test asked for and is kept.
    // Because of the retry, the suite is only green once it has been run more than once.
    constexpr int kAttempts = 5;

    for (int attempt = 0; attempt < kAttempts; attempt++) {
        settings_.port = freePort();
        server_ = std::make_unique<HttpServer>(settings_, *audience_, player, mint, library);
        status_ = server_->start();

        if (status_.listening || !status_.portInUse)
            return;
    }
}

httplib::Client TestServer::client() const {
    httplib::Client client(kClientHost, settings_.port);
    client.set_connection_timeout(2, 0);
    client.set_read_timeout(5, 0);
    return client;
}

httplib::Headers TestServer::bearer(const std::string& token) {
    return httplib::Headers{{"Authorization", "Bearer " + token}};
}

httplib::Result get(const TestServer& server, const std::string& path) {
    return server.client().Get(path, TestServer::bearer());
}

httplib::Result post(const TestServer& server, const std::string& path, const std::string& body) {
    return server.client().Post(path, TestServer::bearer(), body, "application/json");
}

httplib::Client undecoding(const TestServer& server) {
    auto client = server.client();
    client.set_decompress(false);
    return client;
}

httplib::Headers accepting(const char* encoding) {
    auto headers = TestServer::bearer();
    headers.emplace("Accept-Encoding", encoding);
    return headers;
}

bool isGzip(const std::string& body) {
    return body.size() > 2 && static_cast<unsigned char>(body[0]) == 0x1f &&
           static_cast<unsigned char>(body[1]) == 0x8b;
}

}  // namespace jean::testing
