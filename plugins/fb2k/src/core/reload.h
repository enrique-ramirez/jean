#pragma once

#include "core/settings.h"

#include <string>
#include <vector>

namespace jean {

struct ReloadDecision {
    Settings next;
    std::vector<std::string> changedKeys;
    std::vector<std::string> restartKeys;
    std::vector<std::string> logLines;
    bool documentValid = true;
};

// Never throws.
ReloadDecision decideReload(const Settings& running, const std::string& fileText);

}  // namespace jean
