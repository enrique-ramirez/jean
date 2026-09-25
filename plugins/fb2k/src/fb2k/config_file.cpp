#include "fb2k/PCH.h"

#include "fb2k/config_file.h"

#include "core/log.h"
#include "fb2k/files.h"
#include "fb2k/paths.h"

namespace jean {

namespace {

// A config file far larger than this was not written by this component.
constexpr size_t kMaxConfigBytes = 1024 * 1024;

Settings writeFirstRunConfig(const std::string& path) {
    Settings settings;

    try {
        saveSettings(settings);
        logInfo("wrote a default configuration to " + path);
    } catch (const std::exception& e) {
        logError("could not write " + path + ": " + e.what());
    }

    return settings;
}

}  // namespace

std::string readConfigText() {
    try {
        return readTextFile(configPath(), kMaxConfigBytes);
    } catch (const std::exception&) {
        return {};
    }
}

Settings loadSettings() {
    ensureComponentDir();
    const auto path = configPath();
    const auto text = readConfigText();

    return text.empty() ? writeFirstRunConfig(path) : parseSettings(text);
}

void saveSettings(const Settings& settings) {
    ensureComponentDir();
    writeTextFile(configPath(), serialiseSettings(settings));
}

}  // namespace jean
