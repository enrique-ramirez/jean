#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"
#include "core/library.h"
#include "core/player.h"
#include "core/routes_library.h"
#include "support/test_server.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>

namespace jean::testing {

class LibraryRoutesServer {
public:
    LibraryRoutesServer(const Library* library, int64_t nowMs);
    ~LibraryRoutesServer();

    httplib::Client client() const;

    void setNow(int64_t nowMs);

    void holdTogether(int count);

    int refreshes() const { return refreshes_.load(); }
    uint64_t summaryComputations() const;

    LibraryRoutesServer(const LibraryRoutesServer&) = delete;
    LibraryRoutesServer& operator=(const LibraryRoutesServer&) = delete;

private:
    int64_t readClock();

    std::atomic<int64_t> nowMs_;
    std::atomic<int> refreshes_{0};

    std::mutex holdLock_;
    std::condition_variable held_;
    int holding_ = 0;
    int arrived_ = 0;

    ManualClock rateLimitClock_;
    LibraryCalls calls_;
    LiveSettings settings_;
    std::unique_ptr<LibraryRoutes> routes_;

    httplib::Server server_;
    int port_ = 0;
    std::thread thread_;
};

}  // namespace jean::testing
