#include "admission.h"

#include <algorithm>
#include <array>
#include <cstdint>
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
            groups[count++] = static_cast<uint16_t>(((*quad)[0] << 8U) | (*quad)[1]);
            groups[count++] = static_cast<uint16_t>(((*quad)[2] << 8U) | (*quad)[3]);
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
        bytes[to * 2] = static_cast<uint8_t>(groups[from] >> 8U);
        bytes[(to * 2) + 1] = static_cast<uint8_t>(groups[from] & 0xffU);
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
    return (bytes[0] & 0xfeU) == 0xfcU;
}

bool isLinkLocal(const Bytes& bytes) {
    return bytes[0] == 0xfe && (bytes[1] & 0xc0U) == 0x80U;
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

    if (isV4Mapped(bytes))
        return isPrivateIpv4(Octets{bytes[12], bytes[13], bytes[14], bytes[15]});

    return isLoopback(bytes) || isUniqueLocal(bytes) || isLinkLocal(bytes);
}

bool hasSuffix(const std::string& text, const std::string& suffix) {
    return text.size() >= suffix.size() &&
           text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool isListedHost(const std::vector<std::string>& allowedHosts, const std::string& lowered) {
    return std::any_of(allowedHosts.begin(), allowedHosts.end(),
                        [&lowered](const std::string& allowed) {
                            return equalsIgnoringCase(lowered, allowed);
                        });
}

// A bracketed literal is the only unambiguous way to carry an IPv6 address in a Host
// header, since an unbracketed one cannot be told apart from its own port separator.
bool admitsBracketedLiteral(const std::string& host) {
    const auto close = host.find(']');
    if (close == std::string::npos)
        return false;

    const std::string afterBracket = host.substr(close + 1);
    if (!afterBracket.empty() && afterBracket[0] != ':')
        return false;

    return parseIpv6(host.substr(1, close - 1)).has_value();
}

bool admitsNamedHost(const std::string& host, const std::vector<std::string>& allowedHosts) {
    if (std::count(host.begin(), host.end(), ':') > 1)
        return false;

    const auto colon = host.find(':');
    std::string name = colon == std::string::npos ? host : host.substr(0, colon);
    if (!name.empty() && name.back() == '.')
        name.pop_back();

    if (name.empty())
        return false;

    const std::string lowered = toLower(name);

    if (parseIpv4(lowered))
        return true;

    return lowered == "localhost" || lowered.find('.') == std::string::npos ||
           hasSuffix(lowered, ".lan") || hasSuffix(lowered, ".local") ||
           hasSuffix(lowered, ".home.arpa") || isListedHost(allowedHosts, lowered);
}

bool hostAdmitted(const std::string& host, const std::vector<std::string>& allowedHosts) {
    if (host.empty())
        return false;

    if (host[0] == '[')
        return admitsBracketedLiteral(host);

    return admitsNamedHost(host, allowedHosts);
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

Admission admit(const std::string& sourceAddress, const std::string& host,
                 const std::vector<std::string>& allowedHosts) {
    if (!isPrivateAddress(sourceAddress))
        return Admission{false, "the request did not come from a private address"};

    if (!hostAdmitted(host, allowedHosts))
        return Admission{false, "Host " + host + " is not in allowedHosts"};

    return Admission{true, ""};
}

}  // namespace jean
