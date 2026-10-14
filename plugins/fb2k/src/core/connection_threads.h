#pragma once

#include "third_party/httplib.h"

#include "core/http_server.h"

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <list>
#include <mutex>
#include <thread>
#include <vector>

namespace jean {

// In place of cpp-httplib's ThreadPool, which grows only when it counts no idle thread, and counts
// a thread woken for an earlier connection as idle until that thread runs. Connections accepted
// faster than woken threads get scheduled, the common case on Linux and on a loaded Mac, then
// queue behind busy threads with the pool short of its ceiling. This pool grows whenever the
// connections waiting outnumber the threads on their way to take them.
class ConnectionThreads final : public httplib::TaskQueue {
public:
    ConnectionThreads(const ConnectionPool& pool, std::chrono::seconds idleTimeout);
    ~ConnectionThreads() override;

    ConnectionThreads(const ConnectionThreads&) = delete;
    ConnectionThreads& operator=(const ConnectionThreads&) = delete;

    bool enqueue(std::function<void()> job) override;
    void shutdown() override;

private:
    void work(bool resident);
    void spawn(bool resident);

    const ConnectionPool pool_;
    const std::chrono::seconds idleTimeout_;

    std::mutex mutex_;
    std::condition_variable woken_;
    std::deque<std::function<void()>> jobs_;
    std::list<std::thread> threads_;
    std::vector<std::thread> retired_;
    size_t idle_ = 0;
    size_t starting_ = 0;
    bool stopping_ = false;
};

}  // namespace jean
