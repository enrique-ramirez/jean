#pragma once

#include "core/device.h"

#include <string>

namespace jean::testing {

DeviceIdentity phone();

DeviceIdentity laptop();

DeviceIdentity tablet();

// The body of a POST that names the device, as a page would send it.
std::string bodyNaming(const DeviceIdentity& device);

}  // namespace jean::testing
