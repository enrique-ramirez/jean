#pragma once

#include "core/device.h"

#include <chrono>
#include <cstddef>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

using TicketMint = std::function<std::string()>;

// Grants stream connections for a short window; see ARCHITECTURE.md, *Facts about the player*,
// for why the credential has to travel in the URL rather than a header. It MUST be
// short-lived and never logged, and maxConcurrentStreams rather than this bounds how many
// streams one device opens.
class TicketStore {
public:
    using Clock = std::chrono::steady_clock;

    struct Issued {
        std::string ticket;
        std::chrono::seconds expiresIn{0};
    };

    // The device the ticket was issued to, so a connection carrying one is a named device
    // rather than an anonymous socket.
    struct Admission {
        bool ok = false;
        DeviceIdentity device;

        explicit operator bool() const { return ok; }
    };

    // `mint` MUST return unguessable text and MAY return empty on failure.
    TicketStore(std::function<std::string()> mint, std::chrono::seconds ttl, size_t maxOutstanding);

    Issued issue(Clock::time_point now, DeviceIdentity device = {});

    // Unknown and expired are both refused, and callers MUST NOT report which. An expired
    // ticket is dropped as it is refused, so a refusal cannot keep one alive.
    Admission admits(const std::string& ticket, Clock::time_point now);

    size_t outstanding(Clock::time_point now) const;

    TicketStore(const TicketStore&) = delete;
    TicketStore& operator=(const TicketStore&) = delete;

private:
    struct Entry {
        std::string ticket;
        Clock::time_point expiresAt;
        DeviceIdentity device;
    };

    mutable std::mutex mutex_;
    std::vector<Entry> entries_;
    const TicketMint mint_;
    const std::chrono::seconds ttl_;
    const size_t maxOutstanding_;
};

}  // namespace jean
