#include "fb2k/PCH.h"

#include "fb2k/running_settings.h"

#include "core/preferences.h"

#include <mutex>
#include <optional>

namespace jean {

namespace {

std::mutex g_mutex;
std::optional<Settings> g_running;

}  // namespace

void publishRunningSettings(const Settings& settings) {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_running = settings;
}

void forgetRunningSettings() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_running.reset();
}

bool restartNeeded(const Settings& saved) {
    const std::lock_guard<std::mutex> lock(g_mutex);
    return !g_running || restartNeeded(*g_running, saved);
}

std::optional<int> runningPort() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_running)
        return std::nullopt;
    return g_running->port;
}

}  // namespace jean
