#include "core/connection_threads.h"

#include "core/log.h"

#include <algorithm>
#include <string>
#include <system_error>
#include <utility>

namespace jean {

ConnectionThreads::ConnectionThreads(const ConnectionPool& pool, std::chrono::seconds idleTimeout)
    : pool_(pool), idleTimeout_(idleTimeout) {
    try {
        const std::lock_guard<std::mutex> lock(mutex_);
        for (size_t at = 0; at < pool_.threads; ++at)
            spawn(true);
    } catch (...) {
        shutdown();
        throw;
    }
}

ConnectionThreads::~ConnectionThreads() {
    shutdown();
}

bool ConnectionThreads::enqueue(std::function<void()> job) {
    {
        const std::lock_guard<std::mutex> lock(mutex_);
        if (stopping_ || jobs_.size() >= pool_.queued)
            return false;

        jobs_.push_back(std::move(job));

        if (jobs_.size() > idle_ + starting_ && threads_.size() < pool_.maxThreads) {
            for (auto& thread : retired_)
                thread.join();
            retired_.clear();
            try {
                spawn(false);
            } catch (const std::system_error& error) {
                // An exception out of enqueue ends cpp-httplib's accept loop.
                logError(std::string("could not start a connection thread (") + error.what() +
                         "); the request waits for a running one");
            }
        }
    }

    woken_.notify_one();
    return true;
}

void ConnectionThreads::shutdown() {
    std::list<std::thread> running;
    std::vector<std::thread> retired;
    {
        const std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
        running = std::move(threads_);
        retired = std::move(retired_);
    }
    woken_.notify_all();

    for (auto& thread : running)
        thread.join();
    for (auto& thread : retired)
        thread.join();
}

void ConnectionThreads::spawn(bool resident) {
    threads_.emplace_back([this, resident] { work(resident); });
    ++starting_;
}

void ConnectionThreads::work(bool resident) {
    std::unique_lock<std::mutex> lock(mutex_);
    --starting_;

    for (;;) {
        const auto ready = [this] { return stopping_ || !jobs_.empty(); };

        ++idle_;
        if (resident)
            woken_.wait(lock, ready);
        else
            woken_.wait_for(lock, idleTimeout_, ready);
        --idle_;

        if (jobs_.empty()) {
            if (!stopping_) {
                const auto self =
                    std::find_if(threads_.begin(), threads_.end(), [](const std::thread& thread) {
                        return thread.get_id() == std::this_thread::get_id();
                    });
                retired_.push_back(std::move(*self));
                threads_.erase(self);
            }
            return;
        }

        const auto job = std::move(jobs_.front());
        jobs_.pop_front();

        lock.unlock();
        job();
        lock.lock();
    }
}

}  // namespace jean
