#pragma once

#include "third_party/httplib.h"

#include <optional>
#include <string>

namespace jean::testing {

class HeldAddress {
public:
    explicit HeldAddress(const std::string& address);
    ~HeldAddress();

    bool holding() const { return port_ != 0; }
    int port() const { return port_; }

    HeldAddress(const HeldAddress&) = delete;
    HeldAddress& operator=(const HeldAddress&) = delete;

private:
    socket_t socket_;
    int port_ = 0;
};

bool canTake(const std::string& address, int port);

std::optional<std::string> addressOnTheNetwork();

}  // namespace jean::testing
