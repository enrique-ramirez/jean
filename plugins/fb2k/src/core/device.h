#pragma once

#include <cstddef>
#include <string>

namespace jean {

// Both fields are text a client chose. They label a row in somebody else's picker, and the id
// is the one thing a full TicketStore branches on. A forged id costs the device it names its
// pending tickets, which anybody holding the token can already do to every device by minting
// under fresh ids.
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

// Never throws: a malformed body is routine for the HTTP handler that calls this.
DeviceIdentityRequest parseDeviceIdentity(const std::string& body);

}  // namespace jean
