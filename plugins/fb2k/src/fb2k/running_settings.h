#pragma once

#include "core/settings.h"

// What the listener actually came up with. Nothing rebinds a running server, so "saved"
// and "in effect" are different questions: one enables Apply, the other shows "restart
// required".
namespace jean {

void publishRunningSettings(const Settings& settings);
void forgetRunningSettings();

// core/preferences.h's restartNeeded against whatever is currently running, true before
// anything has published since a component that never finished starting cannot promise no
// restart.
bool restartNeeded(const Settings& saved);

}  // namespace jean
