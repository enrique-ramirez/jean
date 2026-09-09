#pragma once

#include "core/settings.h"

// What the listener actually came up with. Nothing rebinds a running server, so "saved"
// and "in effect" are different questions: one enables Apply, the other shows "restart
// required".
namespace jean {

void publishRunningSettings(const Settings& settings);
void forgetRunningSettings();

bool restartNeeded(const Settings& saved);

}  // namespace jean
