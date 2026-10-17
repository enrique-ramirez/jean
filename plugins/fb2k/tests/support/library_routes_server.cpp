#include "support/library_routes_server.h"

#include "support/fixtures.h"

#include "third_party/doctest.h"

#include <chrono>
#include <utility>
#include <vector>

namespace jean::testing {

namespace {

constexpr std::chrono::seconds kHoldWatchdog{2};

}  // namespace

LibraryRoutesServer::LibraryRoutesServer(const Library* library, const int64_t nowMs)
    : nowMs_(nowMs), settings_(servingSettings()) {
    calls_.refresh = [this](const std::vector<std::string>& /*columns*/, RebuildReason /*why*/) {
        ++refreshes_;
    };

    routes_ = std::make_unique<LibraryRoutes>(calls_, library, settings_, 1,
                                              [this] { return rateLimitClock_.now(); });
    routes_->summaryClock([this] { return readClock(); });
    routes_->addTo(server_);

    port_ = server_.bind_to_any_port(TestServer::kClientHost);
    REQUIRE(port_ > 0);
    thread_ = std::thread([this] { server_.listen_after_bind(); });
    server_.wait_until_ready();
}

LibraryRoutesServer::~LibraryRoutesServer() {
    server_.stop();
    thread_.join();
}

httplib::Client LibraryRoutesServer::client() const {
    httplib::Client client(TestServer::kClientHost, port_);
    client.set_connection_timeout(2, 0);
    client.set_read_timeout(5, 0);
    return client;
}

void LibraryRoutesServer::setNow(const int64_t nowMs) {
    nowMs_ = nowMs;
}

void LibraryRoutesServer::holdTogether(const int count) {
    const std::lock_guard<std::mutex> lock(holdLock_);
    holding_ = count;
    arrived_ = 0;
}

uint64_t LibraryRoutesServer::summaryComputations() const {
    return routes_->summaryComputations();
}

int64_t LibraryRoutesServer::readClock() {
    std::unique_lock<std::mutex> lock(holdLock_);
    if (arrived_ < holding_) {
        ++arrived_;
        held_.notify_all();
        held_.wait_for(lock, kHoldWatchdog, [this] { return arrived_ >= holding_; });
    }
    return nowMs_.load();
}

}  // namespace jean::testing
