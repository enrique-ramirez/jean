#pragma once

#include "core/device.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
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
// ARCHITECTURE.md, *Facts about the player*, for why).
class Audience {
public:
    using Clock = std::chrono::steady_clock;
    using Now = std::function<Clock::time_point()>;

    class Membership;

    Audience(int maxConnections, std::chrono::milliseconds linger, Now now = &Clock::now);
    ~Audience();

    std::unique_ptr<Audience> sibling() const;

    Clock::time_point now() const;

    std::shared_ptr<Membership> join(const DeviceIdentity& device, const std::string& format,
                                     Clock::time_point now);

    void leave(const std::string& deviceId);

    // Never carries an address or a user agent.
    std::vector<AudienceMember> roster(Clock::time_point now) const;

    int connections() const;

    bool anyListening(Clock::time_point now) const;

    bool holds(const std::string& deviceId, Clock::time_point now) const;

    bool awaitChangeFrom(bool applied);

    size_t departuresHeld() const;

    size_t waitingForAChange() const;

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
        bool left = false;
    };

    struct Departure {
        Key key;
        Clock::time_point until;
    };

    class Cap {
    public:
        explicit Cap(int max) : max_(max) {}

        bool take();
        void give();
        int taken() const;

    private:
        const int max_;
        std::atomic<int> taken_{0};
    };

    Audience(std::shared_ptr<Cap> cap, std::chrono::milliseconds linger, Now now);

    static Key keyFor(const DeviceIdentity& device, std::uint64_t connection);
    static void dropDepartures(std::vector<Departure>& departures, const Key& key);
    static void dropExpired(std::vector<Departure>& departures, Clock::time_point now);
    static bool stillHolding(const std::vector<Entry>& entries, const Key& key);
    static void markLeft(std::vector<Entry>& entries, const Key& key, bool left);

    bool listeningLocked(Clock::time_point now) const;

    struct State {
        State(std::shared_ptr<Cap> cap, std::chrono::milliseconds linger, Now now)
            : cap(std::move(cap)), linger(linger), now(std::move(now)) {}

        mutable std::mutex mutex;
        std::condition_variable changed;
        std::vector<Entry> entries;
        std::vector<Departure> departures;
        std::uint64_t nextConnection = 1;
        size_t waiting = 0;
        bool closed = false;
        const std::shared_ptr<Cap> cap;
        const std::chrono::milliseconds linger;
        const Now now;
    };

    std::shared_ptr<State> state_;
};

}  // namespace jean
