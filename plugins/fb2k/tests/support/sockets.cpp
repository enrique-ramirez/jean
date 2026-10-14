#include "support/sockets.h"

#include <cstdint>

namespace jean::testing {

namespace {

void closeSocket(socket_t socket) {
    if (socket == INVALID_SOCKET)
        return;
#ifdef _WIN32
    ::closesocket(socket);
#else
    ::close(socket);
#endif
}

bool addressOf(const std::string& address, int port, sockaddr_in& out) {
    out = sockaddr_in{};
    out.sin_family = AF_INET;
    out.sin_port = htons(static_cast<uint16_t>(port));
    return ::inet_pton(AF_INET, address.c_str(), &out.sin_addr) == 1;
}

bool bindTo(socket_t socket, const sockaddr_in& address) {
    return ::bind(socket, reinterpret_cast<const sockaddr*>(&address), sizeof address) == 0;
}

std::optional<sockaddr_in> nameOf(socket_t socket) {
    sockaddr_in name{};
    socklen_t length = sizeof name;
    if (::getsockname(socket, reinterpret_cast<sockaddr*>(&name), &length) != 0)
        return std::nullopt;
    return name;
}

}  // namespace

HeldAddress::HeldAddress(const std::string& address) : socket_(::socket(AF_INET, SOCK_STREAM, 0)) {
    constexpr int kBacklog = 8;

    sockaddr_in anyPort{};
    if (socket_ == INVALID_SOCKET || !addressOf(address, 0, anyPort) || !bindTo(socket_, anyPort) ||
        ::listen(socket_, kBacklog) != 0)
        return;

    if (const auto name = nameOf(socket_))
        port_ = ntohs(name->sin_port);
}

HeldAddress::~HeldAddress() {
    closeSocket(socket_);
}

bool canTake(const std::string& address, int port) {
    sockaddr_in wanted{};
    if (!addressOf(address, port, wanted))
        return false;

    const socket_t second = ::socket(AF_INET, SOCK_STREAM, 0);
    if (second == INVALID_SOCKET)
        return false;

    // macOS refuses a second socket any address a wildcard listener covers unless the second one
    // sets SO_REUSEADDR, and then hands it over whatever the listener set.
    const int on = 1;
    const bool taken = ::setsockopt(second, SOL_SOCKET, SO_REUSEADDR,
                                    reinterpret_cast<const char*>(&on), sizeof on) == 0 &&
                       bindTo(second, wanted);
    closeSocket(second);
    return taken;
}

std::optional<std::string> addressOnTheNetwork() {
    // 192.0.2.1 is RFC 5737's TEST-NET-1. Connecting a UDP socket sends nothing: it only makes the
    // operating system choose the address it would send from.
    sockaddr_in elsewhere{};
    constexpr int kDiscard = 9;
    addressOf("192.0.2.1", kDiscard, elsewhere);

    const socket_t route = ::socket(AF_INET, SOCK_DGRAM, 0);
    if (route == INVALID_SOCKET)
        return std::nullopt;

    const bool routed =
        ::connect(route, reinterpret_cast<const sockaddr*>(&elsewhere), sizeof elsewhere) == 0;
    const auto name = routed ? nameOf(route) : std::nullopt;
    closeSocket(route);

    if (!name)
        return std::nullopt;

    char text[INET_ADDRSTRLEN] = {};
    if (::inet_ntop(AF_INET, &name->sin_addr, text, sizeof text) == nullptr)
        return std::nullopt;

    std::string address = text;
    if (address.rfind("127.", 0) == 0 || address == "0.0.0.0")
        return std::nullopt;
    return address;
}

}  // namespace jean::testing
