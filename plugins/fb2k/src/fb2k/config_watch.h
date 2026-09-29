#pragma once

#include "core/http_server.h"
#include "core/settings.h"

#include <condition_variable>
#include <filesystem>
#include <mutex>
#include <thread>

namespace jean {

// Polls config.json's write time once a second on a thread of its own, and on a change
// decides and applies a reload against `server`, so a switch takes effect with no restart.
class ConfigWatch {
public:
    ConfigWatch(HttpServer& server, Settings running);
    ~ConfigWatch();

    ConfigWatch(const ConfigWatch&) = delete;
    ConfigWatch& operator=(const ConfigWatch&) = delete;

    void stop();

private:
    void run();
    void pollOnce();

    HttpServer& server_;
    Settings running_;
    std::filesystem::path nativeConfigPath_;
    std::filesystem::file_time_type lastSeen_;

    std::mutex mutex_;
    std::condition_variable wake_;
    bool stopping_ = false;
    std::thread thread_;
};

}  // namespace jean
