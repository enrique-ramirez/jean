#include "pairing.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdlib>
#include <optional>

#include "text.h"

namespace jean {
namespace {

using Octets = std::array<uint32_t, 4>;

// Four decimal octets and nothing else. `inet_pton` needs a different header per platform
// for a parse that is eight lines.
std::optional<Octets> parseIpv4(const std::string& address) {
    Octets octets{};
    size_t at = 0;

    for (size_t part = 0; part < 4; ++part) {
        if (at >= address.size() || address[at] < '0' || address[at] > '9')
            return std::nullopt;

        uint32_t value = 0;
        size_t digits = 0;
        while (at < address.size() && address[at] >= '0' && address[at] <= '9') {
            value = (value * 10) + static_cast<uint32_t>(address[at] - '0');
            ++at;
            ++digits;
            if (digits > 3 || value > 255)
                return std::nullopt;
        }

        octets[part] = value;

        if (part < 3) {
            if (at >= address.size() || address[at] != '.')
                return std::nullopt;
            ++at;
        }
    }

    if (at != address.size())
        return std::nullopt;

    return octets;
}

bool isPrivateIpv4(const Octets& octets) {
    if (octets[0] == 10)
        return true;
    if (octets[0] == 127)
        return true;
    if (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
        return true;
    if (octets[0] == 192 && octets[1] == 168)
        return true;
    if (octets[0] == 169 && octets[1] == 254)
        return true;

    return false;
}

bool isPrivateIpv4(const std::string& address) {
    const auto parsed = parseIpv4(address);
    return parsed && isPrivateIpv4(*parsed);
}

using Bytes = std::array<uint8_t, 16>;

std::optional<uint32_t> hexDigit(char c) {
    if (c >= '0' && c <= '9')
        return static_cast<uint32_t>(c - '0');
    if (c >= 'a' && c <= 'f')
        return static_cast<uint32_t>(c - 'a') + 10;
    if (c >= 'A' && c <= 'F')
        return static_cast<uint32_t>(c - 'A') + 10;
    return std::nullopt;
}

// The sixteen bytes an address stands for, so a range can be tested by value rather than by
// how it happens to be spelled: `fc::1` and `fc00::1` share a prefix as text and share no
// prefix at all as an address.
std::optional<Bytes> parseIpv6(const std::string& text) {
    std::array<uint16_t, 8> groups{};
    size_t count = 0;
    std::optional<size_t> gap;
    size_t at = 0;

    if (text.size() >= 2 && text[0] == ':' && text[1] == ':') {
        gap = 0;
        at = 2;
    } else if (!text.empty() && text[0] == ':') {
        return std::nullopt;
    }

    while (at < text.size()) {
        // A dotted quad spells the last two groups and may appear nowhere else: a dot
        // before the next colon means this group is a dotted quad.
        const auto colon = text.find(':', at);
        const auto dot = text.find('.', at);
        if (dot != std::string::npos && (colon == std::string::npos || dot < colon)) {
            const auto quad = parseIpv4(text.substr(at));
            if (!quad || count + 2 > 8)
                return std::nullopt;
            groups[count++] = static_cast<uint16_t>(((*quad)[0] << 8) | (*quad)[1]);
            groups[count++] = static_cast<uint16_t>(((*quad)[2] << 8) | (*quad)[3]);
            at = text.size();
            break;
        }

        uint32_t value = 0;
        size_t digits = 0;
        while (at < text.size()) {
            const auto digit = hexDigit(text[at]);
            if (!digit)
                break;
            value = (value * 16) + *digit;
            ++at;
            if (++digits > 4)
                return std::nullopt;
        }

        if (digits == 0 || count == 8)
            return std::nullopt;
        groups[count++] = static_cast<uint16_t>(value);

        if (at == text.size())
            break;
        if (text[at] != ':')
            return std::nullopt;

        ++at;
        if (at < text.size() && text[at] == ':') {
            if (gap)
                return std::nullopt;
            gap = count;
            ++at;
        } else if (at == text.size()) {
            return std::nullopt;
        }
    }

    Bytes bytes{};
    const auto place = [&bytes, &groups](size_t from, size_t to) {
        bytes[to * 2] = static_cast<uint8_t>(groups[from] >> 8);
        bytes[(to * 2) + 1] = static_cast<uint8_t>(groups[from] & 0xff);
    };

    if (gap) {
        // `::` stands for at least one group of zeros, so a full eight leaves it nothing.
        if (count >= 8)
            return std::nullopt;
        for (size_t i = 0; i < *gap; ++i)
            place(i, i);
        for (size_t i = *gap; i < count; ++i)
            place(i, 8 - (count - i));
    } else {
        if (count != 8)
            return std::nullopt;
        for (size_t i = 0; i < count; ++i)
            place(i, i);
    }

    return bytes;
}

bool isLoopback(const Bytes& bytes) {
    return std::all_of(bytes.begin(), bytes.end() - 1, [](uint8_t b) { return b == 0; }) &&
           bytes[15] == 1;
}

bool isUniqueLocal(const Bytes& bytes) {
    return (bytes[0] & 0xfe) == 0xfc;
}

bool isLinkLocal(const Bytes& bytes) {
    return bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80;
}

bool isV4Mapped(const Bytes& bytes) {
    return std::all_of(bytes.begin(), bytes.begin() + 10, [](uint8_t b) { return b == 0; }) &&
           bytes[10] == 0xff && bytes[11] == 0xff;
}

bool isPrivateIpv6(const std::string& address) {
    const auto parsed = parseIpv6(address);
    if (!parsed)
        return false;

    const Bytes& bytes = *parsed;

    // A v4-mapped address is a v4 address; admitting one spelling and refusing the other
    // would leave a hole.
    if (isV4Mapped(bytes))
        return isPrivateIpv4(Octets{bytes[12], bytes[13], bytes[14], bytes[15]});

    return isLoopback(bytes) || isUniqueLocal(bytes) || isLinkLocal(bytes);
}

}  // namespace

bool isPrivateAddress(const std::string& address) {
    if (address.empty())
        return false;

    // httplib reports a scoped link-local as `fe80::1%en0`; the zone is not part of the
    // address and fails every comparison below.
    const auto zone = address.find('%');
    const auto bare = zone == std::string::npos ? address : address.substr(0, zone);

    return isPrivateIpv4(bare) || isPrivateIpv6(bare);
}

std::string hostOfOrigin(const std::string& origin) {
    const auto scheme = origin.find("://");
    if (scheme == std::string::npos)
        return {};

    auto host = origin.substr(scheme + 3);
    if (host.empty())
        return {};

    if (host.front() == '[') {
        const auto close = host.find(']');
        if (close == std::string::npos)
            return {};
        return toLower(host.substr(1, close - 1));
    }

    const auto port = host.find(':');
    if (port != std::string::npos)
        host = host.substr(0, port);

    const auto slash = host.find('/');
    if (slash != std::string::npos)
        host = host.substr(0, slash);

    return toLower(std::move(host));
}

PairingWindow::PairingWindow(std::chrono::seconds duration) : duration_(duration) {}

void PairingWindow::open(Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);
    openUntil_ = now + duration_;
    everOpened_ = true;
}

void PairingWindow::close() {
    const std::lock_guard<std::mutex> held(mutex_);
    openUntil_ = Clock::time_point{};
}

bool PairingWindow::openAt(Clock::time_point now) const {
    return everOpened_ && now < openUntil_;
}

bool PairingWindow::isOpen(Clock::time_point now) const {
    const std::lock_guard<std::mutex> held(mutex_);
    return openAt(now);
}

std::chrono::seconds PairingWindow::remaining(Clock::time_point now) const {
    const std::lock_guard<std::mutex> held(mutex_);
    if (!openAt(now))
        return std::chrono::seconds{0};
    return std::chrono::duration_cast<std::chrono::seconds>(openUntil_ - now);
}

PairingWindow::Result PairingWindow::claim(Clock::time_point now,
                                           std::chrono::system_clock::time_point wallNow,
                                           const std::string& address, const std::string& name) {
    if (!isPrivateAddress(address))
        return Result::AddressNotPrivate;

    const std::lock_guard<std::mutex> held(mutex_);
    if (!openAt(now))
        return Result::NotOpen;

    openUntil_ = Clock::time_point{};

    history_.push_back(Record{isPrintable(name) ? name : std::string(), address, wallNow});
    if (history_.size() > kMaxPairingHistory)
        history_.erase(history_.begin());

    return Result::Granted;
}

std::vector<PairingWindow::Record> PairingWindow::history() const {
    const std::lock_guard<std::mutex> held(mutex_);
    return history_;
}

}  // namespace jean
