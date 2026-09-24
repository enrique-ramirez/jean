#include "fb2k/PCH.h"

#include "fb2k/paths.h"

#include "core/version.h"
#include "fb2k/files.h"
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

pfc::string8 beefwebClientConfigDir() {
    auto path = inProfile("beefweb");
    path.add_filename("clientconfig");
    return path;
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
    } catch (const std::exception&) {
    }
}

std::string discoveryRecordPath() {
    auto path = beefwebClientConfigDir();
    // beefweb requires lowercase alphanumeric plus underscore here; "foo-jean" is
    // rejected with a 400 and "foo_jean" is not.
    path.add_filename(kComponentName);
    path += ".json";
    return toStd(path);
}

bool beefwebPresent() {
    return fileExists(toStd(beefwebClientConfigDir()));
}

}  // namespace jean
