#include "support/devices.h"

#include "third_party/json.hpp"

namespace jean::testing {

DeviceIdentity phone() {
    return {"phone-4c1e", "Kitchen phone"};
}

DeviceIdentity laptop() {
    return {"laptop-9a07", "Study laptop"};
}

DeviceIdentity tablet() {
    return {"tablet-2b55", "Sofa tablet"};
}

std::string bodyNaming(const DeviceIdentity& device) {
    return nlohmann::json{{"deviceId", device.id}, {"name", device.name}}.dump();
}

}  // namespace jean::testing
