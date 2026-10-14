#include "core/audience.h"

#include <algorithm>

namespace jean {

Audience::Audience(int maxConnections, std::chrono::milliseconds linger, Now now)
    : Audience(std::make_shared<Cap>(maxConnections), linger, std::move(now)) {}

Audience::Audience(std::shared_ptr<Cap> cap, std::chrono::milliseconds linger, Now now)
    : state_(std::make_shared<State>(std::move(cap), linger, std::move(now))) {}

Audience::~Audience() {
    close();
}

std::unique_ptr<Audience> Audience::sibling() const {
    return std::unique_ptr<Audience>(new Audience(state_->cap, state_->linger, state_->now));
}

Audience::Clock::time_point Audience::now() const {
    return state_->now();
}

bool Audience::Cap::take() {
    int taken = taken_.load();
    do {
        if (taken >= max_)
            return false;
    } while (!taken_.compare_exchange_weak(taken, taken + 1));
    return true;
}

void Audience::Cap::give() {
    --taken_;
}

int Audience::Cap::taken() const {
    return taken_.load();
}

Audience::Key Audience::keyFor(const DeviceIdentity& device, std::uint64_t connection) {
    if (device.id.empty())
        return Key{"#" + std::to_string(connection), true};

    return Key{device.id, false};
}

void Audience::dropDepartures(std::vector<Departure>& departures, const Key& key) {
    departures.erase(std::remove_if(departures.begin(), departures.end(),
                                    [&key](const Departure& gone) { return gone.key == key; }),
                     departures.end());
}

void Audience::dropExpired(std::vector<Departure>& departures, Clock::time_point now) {
    departures.erase(std::remove_if(departures.begin(), departures.end(),
                                    [now](const Departure& gone) { return gone.until <= now; }),
                     departures.end());
}

bool Audience::stillHolding(const std::vector<Entry>& entries, const Key& key) {
    return std::any_of(entries.begin(), entries.end(),
                       [&key](const Entry& live) { return live.key == key; });
}

void Audience::markLeft(std::vector<Entry>& entries, const Key& key, bool left) {
    for (Entry& entry : entries) {
        if (entry.key == key)
            entry.left = left;
    }
}

class Audience::Membership {
public:
    Membership(std::shared_ptr<State> state, Key key, std::uint64_t connection)
        : state_(std::move(state)), key_(std::move(key)), connection_(connection) {}

    ~Membership() {
        state_->cap->give();

        try {
            const auto now = state_->now();
            const std::lock_guard<std::mutex> held(state_->mutex);

            auto& entries = state_->entries;
            const auto mine =
                std::find_if(entries.begin(), entries.end(),
                             [this](const Entry& live) { return live.connection == connection_; });
            const bool left = mine != entries.end() && mine->left;
            if (mine != entries.end())
                entries.erase(mine);

            dropExpired(state_->departures, now);
            if (!left && !stillHolding(entries, key_))
                state_->departures.push_back({key_, now + state_->linger});
        } catch (...) {
            state_->changed.notify_all();
            return;
        }

        state_->changed.notify_all();
    }

    Membership(const Membership&) = delete;
    Membership& operator=(const Membership&) = delete;

private:
    const std::shared_ptr<State> state_;
    const Key key_;
    const std::uint64_t connection_;
};

std::shared_ptr<Audience::Membership> Audience::join(const DeviceIdentity& device,
                                                     const std::string& format,
                                                     Clock::time_point now) {
    const auto state = state_;
    const auto expiredBy = state->now();
    Entry entry;

    {
        const std::lock_guard<std::mutex> held(state->mutex);
        dropExpired(state->departures, expiredBy);

        if (state->closed || !state->cap->take())
            return nullptr;

        entry.connection = state->nextConnection++;
        entry.device = sanitised(device);
        entry.format = format;
        entry.joinedAt = now;
        entry.key = keyFor(entry.device, entry.connection);

        dropDepartures(state->departures, entry.key);
        markLeft(state->entries, entry.key, false);

        state->entries.push_back(entry);
    }

    state->changed.notify_all();

    return std::make_shared<Membership>(state, entry.key, entry.connection);
}

void Audience::leave(const std::string& deviceId) {
    if (deviceId.empty())
        return;

    const Key key{deviceId, false};

    {
        const std::lock_guard<std::mutex> held(state_->mutex);

        markLeft(state_->entries, key, true);
        dropDepartures(state_->departures, key);
    }

    state_->changed.notify_all();
}

std::vector<AudienceMember> Audience::roster(Clock::time_point now) const {
    const std::lock_guard<std::mutex> held(state_->mutex);

    std::vector<AudienceMember> members;
    for (const Entry& entry : state_->entries) {
        const auto found =
            std::find_if(members.begin(), members.end(), [&entry](const AudienceMember& member) {
                return member.anonymous == entry.key.anonymous && member.deviceId == entry.key.text;
            });

        if (found == members.end()) {
            AudienceMember member;
            member.deviceId = entry.key.text;
            member.name = entry.device.name;
            member.format = entry.format;
            member.connections = 1;
            member.listeningForSeconds = static_cast<int>(
                std::chrono::duration_cast<std::chrono::seconds>(now - entry.joinedAt).count());
            member.anonymous = entry.key.anonymous;
            members.push_back(std::move(member));
            continue;
        }

        ++found->connections;

        if (!entry.device.name.empty())
            found->name = entry.device.name;
        found->format = entry.format;

        const auto since = static_cast<int>(
            std::chrono::duration_cast<std::chrono::seconds>(now - entry.joinedAt).count());
        found->listeningForSeconds = std::max(found->listeningForSeconds, since);
    }

    std::stable_sort(members.begin(), members.end(),
                     [](const AudienceMember& a, const AudienceMember& b) {
                         return a.listeningForSeconds > b.listeningForSeconds;
                     });

    return members;
}

int Audience::connections() const {
    return state_->cap->taken();
}

bool Audience::listeningLocked(Clock::time_point now) const {
    if (!state_->entries.empty())
        return true;

    return std::any_of(state_->departures.begin(), state_->departures.end(),
                       [now](const Departure& gone) { return gone.until > now; });
}

bool Audience::anyListening(Clock::time_point now) const {
    const std::lock_guard<std::mutex> held(state_->mutex);
    return listeningLocked(now);
}

bool Audience::holds(const std::string& deviceId, Clock::time_point now) const {
    if (deviceId.empty())
        return false;

    const Key key{deviceId, false};
    const std::lock_guard<std::mutex> held(state_->mutex);

    return stillHolding(state_->entries, key) ||
           std::any_of(
               state_->departures.begin(), state_->departures.end(),
               [&key, now](const Departure& gone) { return gone.key == key && gone.until > now; });
}

bool Audience::awaitChangeFrom(bool applied) {
    std::unique_lock<std::mutex> lock(state_->mutex);

    for (;;) {
        if (state_->closed)
            return false;

        const auto now = Clock::now();
        dropExpired(state_->departures, now);

        if (listeningLocked(now) != applied)
            return true;

        const auto soonest = std::min_element(
            state_->departures.begin(), state_->departures.end(),
            [](const Departure& a, const Departure& b) { return a.until < b.until; });

        // A copy, because the wait releases the lock and a join or a departure may erase or move
        // the entry, while std::condition_variable::wait_until reads its deadline again on waking.
        ++state_->waiting;
        if (soonest != state_->departures.end()) {
            const Clock::time_point wakeAt = soonest->until;
            state_->changed.wait_until(lock, wakeAt);
        } else {
            state_->changed.wait(lock);
        }
        --state_->waiting;
    }
}

size_t Audience::departuresHeld() const {
    const std::lock_guard<std::mutex> held(state_->mutex);
    return state_->departures.size();
}

size_t Audience::waitingForAChange() const {
    const std::lock_guard<std::mutex> held(state_->mutex);
    return state_->waiting;
}

void Audience::close() {
    {
        const std::lock_guard<std::mutex> held(state_->mutex);
        if (state_->closed)
            return;
        state_->closed = true;
    }

    state_->changed.notify_all();
}

}  // namespace jean
