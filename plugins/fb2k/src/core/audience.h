#pragma once

#include "core/device.h"

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

struct AudienceMember {
    std::string deviceId;
    std::string name;
    std::string format;
    int connections = 0;
    int listeningForSeconds = 0;

    bool anonymous = false;
};

// Counted two ways: connections, which is what maxConcurrentStreams bounds, and devices,
// which is what a client is shown (one device is routinely more than one connection; see
// CLAUDE.md, *Facts about the player*, for why).
class Audience {
public:
    using Clock = std::chrono::steady_clock;

    class Membership;

    Audience(int maxConnections, std::chrono::milliseconds linger);
    ~Audience();

    std::shared_ptr<Membership> join(const DeviceIdentity& device, const std::string& format,
                                     Clock::time_point now);

    void leave(const std::string& deviceId);

    // Never carries an address or a user agent.
    std::vector<AudienceMember> roster(Clock::time_point now) const;

    int connections() const;

    bool anyListening(Clock::time_point now) const;

    bool awaitChangeFrom(bool applied);

    void close();

    Audience(const Audience&) = delete;
    Audience& operator=(const Audience&) = delete;

private:
    struct Key {
        std::string text;

        bool anonymous = false;

        bool operator==(const Key& other) const {
            return anonymous == other.anonymous && text == other.text;
        }
    };

    struct Entry {
        Key key;
        DeviceIdentity device;
        std::string format;
        Clock::time_point joinedAt;
        std::uint64_t connection = 0;
    };

    struct Departure {
        Key key;
        Clock::time_point until;
    };

    static Key keyFor(const DeviceIdentity& device, std::uint64_t connection);
    static void dropDepartures(std::vector<Departure>& departures, const Key& key);
    static bool stillHolding(const std::vector<Entry>& entries, const Key& key);

    bool listeningLocked(Clock::time_point now) const;

    struct State {
        State(int max, std::chrono::milliseconds linger) : maxConnections(max), linger(linger) {}

        mutable std::mutex mutex;
        std::condition_variable changed;
        std::vector<Entry> entries;
        std::vector<Departure> departures;
        std::uint64_t nextConnection = 1;
        bool closed = false;
        const int maxConnections;
        const std::chrono::milliseconds linger;
    };

    std::shared_ptr<State> state_;
};

}  // namespace jean
