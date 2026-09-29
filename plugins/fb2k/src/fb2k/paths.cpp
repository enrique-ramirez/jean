#include "fb2k/PCH.h"

#include "fb2k/paths.h"

#include "core/version.h"
#include "fb2k/strings.h"

namespace jean {

namespace {

pfc::string8 inProfile(const char* name) {
    return core_api::pathInProfile(name);
}

std::string inComponentDir(const std::string& name) {
    auto path = inProfile(kComponentName);
    path.add_filename(name.c_str());
    return toStd(path);
}

}  // namespace

std::string componentDir() {
    return toStd(inProfile(kComponentName));
}

std::string configPath() {
    return inComponentDir("config.json");
}

std::string logPath() {
    return inComponentDir(std::string(kComponentName) + ".log");
}

std::string wwwDir() {
    return inComponentDir("www");
}

void ensureComponentDir() {
    const auto dir = componentDir();

    try {
        if (!filesystem::g_exists(dir.c_str(), fb2k::noAbort))
            filesystem::g_create_directory(dir.c_str(), fb2k::noAbort);
        // NOLINTNEXTLINE(bugprone-empty-catch)
    } catch (const std::exception&) {
    }
}

std::filesystem::path nativePathOf(const std::string& profilePath) {
    pfc::string8 display;
    filesystem::g_get_display_path(profilePath.c_str(), display);
    return std::filesystem::path(toWide(toStd(display)));
}

}  // namespace jean
