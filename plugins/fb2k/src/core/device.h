#pragma once

#include <cstddef>
#include <string>

namespace jean {

// Both fields are text a client chose. They label a row in somebody else's picker and
// nothing branches on them, so a wrong one costs a wrong word rather than a wrong decision,
// and a forged one is available to anybody already holding the token.
struct DeviceIdentity {
    std::string id;

    std::string name;
};

// Bounded here rather than wherever they are rendered, because these go in front of other
// people on the network.
constexpr size_t kMaxDeviceIdLength = 64;
constexpr size_t kMaxDeviceNameLength = 64;

// Trims, and empties anything unprintable or overlong. This refuses the label and never the
// request: a bad name must not cost somebody their audio.
DeviceIdentity sanitised(DeviceIdentity device);

struct DeviceIdentityRequest {
    std::string refusal;

    // As sent: sanitised() has not been applied yet.
    DeviceIdentity device;

    bool ok() const { return refusal.empty(); }
};

// Never throws: a malformed body is routine for the HTTP handler that calls these.
DeviceIdentityRequest parseDeviceIdentity(const std::string& body);

DeviceIdentityRequest parseDeviceName(const std::string& body);

}  // namespace jean
