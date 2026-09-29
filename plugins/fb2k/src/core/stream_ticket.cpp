#include "core/stream_ticket.h"

#include "core/text.h"

#include <algorithm>
#include <utility>

namespace jean {

TicketStore::TicketStore(TicketMint mint, std::chrono::seconds ttl, size_t maxOutstanding)
    : mint_(std::move(mint)), ttl_(ttl), maxOutstanding_(std::max<size_t>(maxOutstanding, 1)) {}

TicketStore::Issued TicketStore::issue(Clock::time_point now, DeviceIdentity device) {
    std::string ticket = mint_ ? mint_() : std::string();
    if (ticket.empty())
        return {};

    const std::lock_guard<std::mutex> held(mutex_);

    entries_.erase(std::remove_if(entries_.begin(), entries_.end(),
                                  [now](const Entry& entry) { return entry.expiresAt <= now; }),
                   entries_.end());

    if (entries_.size() >= maxOutstanding_)
        entries_.erase(entries_.begin());

    entries_.push_back({ticket, now + ttl_, sanitised(std::move(device))});
    return {std::move(ticket), ttl_};
}

TicketStore::Admission TicketStore::admits(const std::string& ticket, Clock::time_point now) {
    const std::lock_guard<std::mutex> held(mutex_);

    std::ptrdiff_t found = -1;
    for (size_t i = 0; i < entries_.size(); ++i) {
        if (secureEquals(entries_[i].ticket, ticket))
            found = static_cast<std::ptrdiff_t>(i);
    }

    if (found < 0)
        return {};

    const Entry& entry = entries_[static_cast<size_t>(found)];
    if (entry.expiresAt > now)
        return {true, entry.device};

    entries_.erase(entries_.begin() + found);
    return {};
}

}  // namespace jean
