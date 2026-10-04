#pragma once

#include "core/audience.h"
#include "core/device.h"
#include "core/session.h"
#include "core/session_order.h"
#include "core/stream_ticket.h"

#include <chrono>
#include <cstddef>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace jean {

struct SessionAnswer {
    enum class Which { none, engine, detached };
    Which which = Which::none;
    std::shared_ptr<Session> session;
};

// `joining` is a state poll, a ticket or a share: it makes a device a member of a shared session
// and refreshes one that already is.
enum class Naming { passing, joining };

enum class SessionCreation { created, atTheCap, noId, noStream };
enum class SessionShare { done, noSuchSession, engine };

class SessionRegistry {
public:
    using Clock = Session::Clock;

    // `engine` is the engine session's audience and outlives this.
    SessionRegistry(const Audience& engine, int maxSessions, TicketMint mint, SessionRandom random,
                    SessionStreamStarter start = {});
    ~SessionRegistry();

    struct Created {
        SessionCreation how = SessionCreation::created;
        std::shared_ptr<Session> session;
    };

    Created create(const DeviceIdentity& creator, Clock::time_point now);

    SessionAnswer find(const std::string& id, const std::string& deviceId, Clock::time_point now,
                       Naming naming = Naming::passing);

    std::vector<std::shared_ptr<Session>> list(const std::string& deviceId, Clock::time_point now);

    SessionShare share(const std::string& id, const std::string& deviceId, bool shared,
                       Clock::time_point now);

    // `engine` changes nothing: the caller ends the engine's linger.
    SessionAnswer::Which leave(const std::string& id, const std::string& deviceId,
                               Clock::time_point now);

    void sweep(Clock::time_point now);

    void close();

    SessionRegistry(const SessionRegistry&) = delete;
    SessionRegistry& operator=(const SessionRegistry&) = delete;

private:
    struct Reaped {
        Reaped() = default;
        ~Reaped();
        Reaped(const Reaped&) = delete;
        Reaped& operator=(const Reaped&) = delete;

        std::vector<std::shared_ptr<Session>> sessions;
    };

    static bool isEngine(const std::string& id);

    void reapLocked(Clock::time_point now, Reaped& into);
    std::shared_ptr<Session> visibleLocked(const std::string& id, const std::string& deviceId,
                                           Clock::time_point now) const;

    const Audience& engine_;
    const size_t maxSessions_;
    const TicketMint mint_;
    const SessionRandom random_;
    const SessionStreamStarter start_;

    mutable std::mutex mutex_;
    std::vector<std::shared_ptr<Session>> sessions_;

    size_t starting_ = 0;
    bool closed_ = false;
};

}  // namespace jean
