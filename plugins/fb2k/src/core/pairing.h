#pragma once

#include <chrono>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

// See ARCHITECTURE.md, *Pairing, and one accepted risk*, for the bounds this enforces and
// why each one is there.

// RFC1918, loopback, link-local and their IPv6 equivalents; everything else is refused.
// Parsed rather than prefix-matched, because "172.16." also admits 172.160.0.1.
bool isPrivateAddress(const std::string& address);

std::string hostOfOrigin(const std::string& origin);

class PairingWindow {
public:
    using Clock = std::chrono::steady_clock;

    enum class Result {
        Granted,
        // The message for this one MUST name the button to press.
        NotOpen,
        AddressNotPrivate,
    };

    struct Record {
        std::string name;
        std::string address;
        std::chrono::system_clock::time_point at;
    };

    explicit PairingWindow(std::chrono::seconds duration);

    void open(Clock::time_point now);
    void close();

    bool isOpen(Clock::time_point now) const;
    std::chrono::seconds remaining(Clock::time_point now) const;

    // `name` MAY be empty: pairing must never require typing.
    Result claim(Clock::time_point now, std::chrono::system_clock::time_point wallNow,
                 const std::string& address, const std::string& name);

    std::vector<Record> history() const;

    PairingWindow(const PairingWindow&) = delete;
    PairingWindow& operator=(const PairingWindow&) = delete;

private:
    // Called with the mutex held. `everOpened_` is what tells a default-constructed
    // openUntil_ from one that has run out.
    bool openAt(Clock::time_point now) const;

    mutable std::mutex mutex_;
    const std::chrono::seconds duration_;
    Clock::time_point openUntil_;
    bool everOpened_ = false;
    std::vector<Record> history_;
};

constexpr int kPairingWindowSeconds = 120;
constexpr size_t kMaxPairingHistory = 20;

}  // namespace jean
