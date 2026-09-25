#pragma once

#include <string>
#include <vector>

namespace jean {

// RFC1918, loopback, link-local and their IPv6 equivalents; everything else is refused.
bool isPrivateAddress(const std::string& address);

struct Admission {
    bool admitted = false;
    std::string refusal;
};

Admission admit(const std::string& sourceAddress, const std::string& host,
                 const std::vector<std::string>& allowedHosts);

}  // namespace jean
