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

// `fetchSite` is the request's Sec-Fetch-Site, empty where it carried none. `originListed` is
// whether its Origin is one allowedOrigins names.
Admission admitFetchSite(const std::string& fetchSite, bool originListed);

}  // namespace jean
