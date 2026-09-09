#include "fb2k/PCH.h"

#include "fb2k/config_file.h"

#include "core/log.h"
#include "fb2k/files.h"
#include "fb2k/paths.h"
#include "fb2k/token.h"

namespace jean {

namespace {

// A config file far larger than this was not written by this component.
constexpr size_t kMaxConfigBytes = 1024 * 1024;

Settings writeFirstRunConfig(const std::string& path) {
    Settings settings;
    settings.authToken = generateToken();

    if (settings.authToken.empty()) {
        logError("could not generate an authentication token; refusing to serve");
        return settings;
    }

    try {
        saveSettings(settings);
        logInfo("wrote a default configuration to " + path);
        logInfo("the API token is in that file; a client needs it once");
    } catch (const std::exception& e) {
        logError("could not write " + path + ": " + e.what());
        logError("this run's token will not survive a restart");
    }

    return settings;
}

}  // namespace

Settings loadSettings() {
    ensureComponentDir();
    const auto path = configPath();

    std::string text;
    try {
        text = readTextFile(path, kMaxConfigBytes);
    } catch (const std::exception&) {
    }

    return text.empty() ? writeFirstRunConfig(path) : parseSettings(text);
}

void saveSettings(const Settings& settings) {
    ensureComponentDir();
    writeTextFile(configPath(), serialiseSettings(settings));
}

}  // namespace jean
