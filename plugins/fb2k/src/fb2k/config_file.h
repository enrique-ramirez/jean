#pragma once

#include "core/settings.h"

#include <string>

namespace jean {

// The raw bytes of <profile>/foo_jean/config.json, or empty if it is missing, unreadable or
// implausibly large. Never throws.
std::string readConfigText();

// Reads <profile>/foo_jean/config.json, writing a default one if it is missing. Never throws.
Settings loadSettings();

// Replaces the file with these settings. Throws, unlike everything else here.
void saveSettings(const Settings& settings);

}  // namespace jean
