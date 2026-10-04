#pragma once

#include <string>

namespace jean {

struct SharingRequest {
    std::string refusal;
    bool shared = false;

    bool ok() const { return refusal.empty(); }
};

SharingRequest parseSharing(const std::string& body);

}  // namespace jean
