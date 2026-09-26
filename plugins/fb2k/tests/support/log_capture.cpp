#include "support/log_capture.h"

#include "core/log.h"

#include <algorithm>
#include <mutex>

namespace jean {

namespace {

std::mutex g_mutex;
std::vector<std::string> g_lines;

// The HTTP server logs from its own thread, so a test would otherwise race its own log.
void record(std::string line) {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_lines.push_back(std::move(line));
}

}  // namespace

void logInfo(const std::string& message) {
    record("[info] " + message);
}

void logError(const std::string& message) {
    record("[error] " + message);
}

namespace testing {

std::vector<std::string> loggedLines() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    return g_lines;
}

bool logged(const std::string& fragment) {
    const auto lines = loggedLines();
    return std::any_of(lines.begin(), lines.end(), [&fragment](const std::string& line) {
        return line.find(fragment) != std::string::npos;
    });
}

void clearLog() {
    const std::lock_guard<std::mutex> lock(g_mutex);
    g_lines.clear();
}

size_t errorLinesContaining(const std::string& fragment) {
    const auto lines = loggedLines();
    return static_cast<size_t>(
        std::count_if(lines.begin(), lines.end(), [&fragment](const std::string& line) {
            return line.rfind("[error] ", 0) == 0 && line.find(fragment) != std::string::npos;
        }));
}

size_t refusalBursts(const std::vector<int>& statuses) {
    constexpr int kRefused = 429;

    size_t bursts = 0;
    int previous = 0;
    for (const int status : statuses) {
        if (status == kRefused && previous != kRefused)
            bursts++;
        previous = status;
    }

    return bursts;
}

}  // namespace testing

}  // namespace jean
