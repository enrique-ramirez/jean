#pragma once

#include "core/settings.h"

namespace jean {

// Reads <profile>/foo_jean/config.json, writing a default one with a fresh token if it is
// missing. Never throws.
Settings loadSettings();

// Replaces the file with these settings. Throws, unlike everything else here.
void saveSettings(const Settings& settings);

}  // namespace jean
