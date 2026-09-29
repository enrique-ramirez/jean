#include "fb2k/PCH.h"

#include "core/log.h"

#include "core/version.h"
#include "fb2k/files.h"
#include "fb2k/paths.h"

#include <mutex>

namespace jean {

namespace {

std::mutex g_fileMutex;

constexpr uint64_t kMaxLogBytes = uint64_t{1024} * 1024;

void write(const char* level, const std::string& message) {
    console::print((std::string(kComponentName) + ": " + message).c_str());

    const std::lock_guard<std::mutex> lock(g_fileMutex);

    // Opened and closed per line rather than held open. Holding the handle would be
    // faster and would also mean the file might not be readable by anything else while
    // foobar2000 runs, which defeats the only reason it exists.
    try {
        ensureComponentDir();
        appendTextFile(logPath(), std::string("[") + level + "] " + message + "\n", kMaxLogBytes);
    } catch (const std::exception&) {
        // Reporting a logging failure through the logger is how you get a loop, and the
        // console line has already gone out.
    }
}

}  // namespace

void logInfo(const std::string& message) {
    write("info", message);
}

void logError(const std::string& message) {
    write("error", message);
}

}  // namespace jean
