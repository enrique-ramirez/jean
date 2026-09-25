#pragma once

#include <string>
#include <vector>

namespace jean {

// RFC1918, loopback, link-local and their IPv6 equivalents; everything else is refused.
// Parsed rather than prefix-matched, because "172.16." also admits 172.160.0.1.
bool isPrivateAddress(const std::string& address);

struct Admission {
    bool admitted = false;
    std::string refusal;
};

Admission admit(const std::string& sourceAddress, const std::string& host,
                 const std::vector<std::string>& allowedHosts);

}  // namespace jean
