#include "fb2k/PCH.h"

#include "fb2k/config_watch.h"

#include "core/log.h"
#include "core/reload.h"
#include "fb2k/config_file.h"
#include "fb2k/paths.h"
#include "fb2k/running_settings.h"

#include <chrono>
#include <exception>
#include <string>
#include <system_error>

namespace jean {

ConfigWatch::ConfigWatch(HttpServer& server, Settings running)
    : server_(server), running_(std::move(running)), nativeConfigPath_(nativePathOf(configPath())) {
    std::error_code ec;
    lastSeen_ = std::filesystem::last_write_time(nativeConfigPath_, ec);

    thread_ = std::thread([this] { run(); });
}

ConfigWatch::~ConfigWatch() {
    stop();
}

void ConfigWatch::stop() {
    {
        const std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    wake_.notify_one();

    if (thread_.joinable())
        thread_.join();
}

void ConfigWatch::run() {
    std::unique_lock<std::mutex> lock(mutex_);
    while (!wake_.wait_for(lock, std::chrono::seconds(1), [this] { return stopping_; })) {
        lock.unlock();
        try {
            pollOnce();
        } catch (const std::exception& e) {
            logError(std::string("config watch failed: ") + e.what());
        } catch (...) {
            logError("config watch failed with an unknown exception");
        }
        lock.lock();
    }
}

void ConfigWatch::pollOnce() {
    std::error_code ec;
    const auto written = std::filesystem::last_write_time(nativeConfigPath_, ec);
    if (ec || written == lastSeen_)
        return;

    const auto decision = decideReload(running_, readConfigText());

    for (const auto& line : decision.logLines)
        logError(line);

    server_.applyReload(decision);
    running_ = decision.next;
    publishRunningSettings(running_);

    if (decision.documentValid)
        lastSeen_ = written;
}

}  // namespace jean
