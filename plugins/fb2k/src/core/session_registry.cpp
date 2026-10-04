#include "core/session_registry.h"

#include <algorithm>
#include <iterator>
#include <optional>
#include <utility>

namespace jean {

SessionRegistry::SessionRegistry(const Audience& engine, int maxSessions, TicketMint mint,
                                 SessionRandom random, SessionStreamStarter start)
    : engine_(engine),
      maxSessions_(static_cast<size_t>(std::max(0, maxSessions))),
      mint_(std::move(mint)),
      random_(std::move(random)),
      start_(std::move(start)) {}

SessionRegistry::~SessionRegistry() {
    close();
}

bool SessionRegistry::isEngine(const std::string& id) {
    return id.empty() || id == kEngineSessionId;
}

SessionRegistry::Reaped::~Reaped() {
    for (const auto& session : sessions)
        session->close();
}

void SessionRegistry::reapLocked(Clock::time_point now, Reaped& into) {
    const auto split =
        std::stable_partition(sessions_.begin(), sessions_.end(),
                              [now](const auto& session) { return !session->closeIfExpired(now); });

    into.sessions.insert(into.sessions.end(), std::make_move_iterator(split),
                         std::make_move_iterator(sessions_.end()));
    sessions_.erase(split, sessions_.end());
}

std::shared_ptr<Session> SessionRegistry::visibleLocked(const std::string& id,
                                                        const std::string& deviceId,
                                                        Clock::time_point now) const {
    const auto found = std::find_if(sessions_.begin(), sessions_.end(),
                                    [&id](const auto& session) { return session->id() == id; });

    if (found == sessions_.end())
        return nullptr;

    if (!(*found)->shared() && !(*found)->member(deviceId, now))
        return nullptr;

    return *found;
}

SessionRegistry::Created SessionRegistry::create(const DeviceIdentity& creator,
                                                 Clock::time_point now) {
    {
        Reaped reaped;
        const std::lock_guard<std::mutex> held(mutex_);
        reapLocked(now, reaped);

        if (closed_)
            return {SessionCreation::noStream, nullptr};

        if (creator.id.empty())
            return {SessionCreation::noId, nullptr};

        if (sessions_.size() + starting_ >= maxSessions_)
            return {SessionCreation::atTheCap, nullptr};

        ++starting_;
    }

    std::shared_ptr<Session> session;
    PlayerOutcome started = PlayerOutcome::done;

    try {
        const std::string id = mint_ ? mint_() : std::string();
        if (!id.empty() && id != kEngineSessionId) {
            session = std::make_shared<Session>(id, creator, engine_, random_, now);

            if (start_) {
                SessionStream stream = start_(*session);
                started = stream.outcome;
                session->attach(std::move(stream));
            }
        }
    } catch (...) {
        const std::lock_guard<std::mutex> held(mutex_);
        --starting_;
        throw;
    }

    std::optional<SessionCreation> refused;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        --starting_;

        const auto sameId = [&session](const auto& live) { return live->id() == session->id(); };
        const bool unusableId = !session || std::any_of(sessions_.begin(), sessions_.end(), sameId);

        if (unusableId) {
            refused = SessionCreation::noId;
        } else if (closed_ || started != PlayerOutcome::done) {
            refused = SessionCreation::noStream;
        } else {
            sessions_.push_back(session);
        }
    }

    if (!refused)
        return {SessionCreation::created, std::move(session)};

    if (session)
        session->close();

    return {*refused, nullptr};
}

SessionAnswer SessionRegistry::find(const std::string& id, const std::string& deviceId,
                                    Clock::time_point now, Naming naming) {
    Reaped reaped;
    SessionAnswer answer;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        reapLocked(now, reaped);

        if (isEngine(id)) {
            answer.which = SessionAnswer::Which::engine;
        } else if (auto session = visibleLocked(id, deviceId, now)) {
            if (naming == Naming::joining)
                session->seen(deviceId, now);

            answer.which = SessionAnswer::Which::detached;
            answer.session = std::move(session);
        }
    }

    return answer;
}

std::vector<std::shared_ptr<Session>> SessionRegistry::list(const std::string& deviceId,
                                                            Clock::time_point now) {
    Reaped reaped;
    std::vector<std::shared_ptr<Session>> visible;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        reapLocked(now, reaped);

        std::copy_if(sessions_.begin(), sessions_.end(), std::back_inserter(visible),
                     [&deviceId, now](const auto& session) {
                         return session->shared() || session->member(deviceId, now);
                     });
    }

    return visible;
}

SessionShare SessionRegistry::share(const std::string& id, const std::string& deviceId, bool shared,
                                    Clock::time_point now) {
    Reaped reaped;
    SessionShare answer = SessionShare::noSuchSession;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        reapLocked(now, reaped);

        if (isEngine(id)) {
            answer = SessionShare::engine;
        } else if (const auto session = visibleLocked(id, deviceId, now)) {
            session->seen(deviceId, now);
            session->share(shared);
            answer = SessionShare::done;
        }
    }

    return answer;
}

SessionAnswer::Which SessionRegistry::leave(const std::string& id, const std::string& deviceId,
                                            Clock::time_point now) {
    Reaped reaped;
    auto answer = SessionAnswer::Which::none;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        reapLocked(now, reaped);

        if (isEngine(id)) {
            answer = SessionAnswer::Which::engine;
        } else if (const auto session = visibleLocked(id, deviceId, now)) {
            session->leave(deviceId);
            answer = SessionAnswer::Which::detached;

            if (session->closeIfExpired(now)) {
                sessions_.erase(std::find(sessions_.begin(), sessions_.end(), session));
                reaped.sessions.push_back(session);
            }
        }
    }

    return answer;
}

void SessionRegistry::sweep(Clock::time_point now) {
    Reaped reaped;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        reapLocked(now, reaped);
    }
}

void SessionRegistry::close() {
    Reaped reaped;

    {
        const std::lock_guard<std::mutex> held(mutex_);
        closed_ = true;
        reaped.sessions.swap(sessions_);

        // Under the lock, so no listen() lands on a session between the swap and its stop.
        for (const auto& session : reaped.sessions)
            session->closeWithoutStopping();
    }
}

}  // namespace jean
