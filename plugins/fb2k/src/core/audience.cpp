#include "core/audience.h"

#include <algorithm>

namespace jean {

Audience::Audience(int maxConnections, std::chrono::milliseconds linger)
    : state_(std::make_shared<State>(maxConnections, linger)) {}

Audience::~Audience() {
    close();
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

bool Audience::stillHolding(const std::vector<Entry>& entries, const Key& key) {
    return std::any_of(entries.begin(), entries.end(),
                       [&key](const Entry& live) { return live.key == key; });
}

class Audience::Membership {
public:
    Membership(std::shared_ptr<State> state, Key key, std::uint64_t connection)
        : state_(std::move(state)), key_(std::move(key)), connection_(connection) {}

    ~Membership() {
        try {
            const std::lock_guard<std::mutex> held(state_->mutex);

            state_->entries.erase(std::remove_if(state_->entries.begin(), state_->entries.end(),
                                                 [this](const Entry& live) {
                                                     return live.connection == connection_;
                                                 }),
                                  state_->entries.end());

            if (!stillHolding(state_->entries, key_))
                state_->departures.push_back({key_, Clock::now() + state_->linger});
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
    Entry entry;

    {
        const std::lock_guard<std::mutex> held(state->mutex);
        if (state->closed || static_cast<int>(state->entries.size()) >= state->maxConnections)
            return nullptr;

        entry.connection = state->nextConnection++;
        entry.device = sanitised(device);
        entry.format = format;
        entry.joinedAt = now;
        entry.key = keyFor(entry.device, entry.connection);

        dropDepartures(state->departures, entry.key);

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

        if (stillHolding(state_->entries, key))
            return;

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
    const std::lock_guard<std::mutex> held(state_->mutex);
    return static_cast<int>(state_->entries.size());
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

bool Audience::awaitChangeFrom(bool applied) {
    std::unique_lock<std::mutex> lock(state_->mutex);

    for (;;) {
        if (state_->closed)
            return false;

        const auto now = Clock::now();
        state_->departures.erase(
            std::remove_if(state_->departures.begin(), state_->departures.end(),
                           [now](const Departure& gone) { return gone.until <= now; }),
            state_->departures.end());

        if (listeningLocked(now) != applied)
            return true;

        const auto soonest = std::min_element(
            state_->departures.begin(), state_->departures.end(),
            [](const Departure& a, const Departure& b) { return a.until < b.until; });

        // A copy, because the wait releases the lock and a join or a departure may erase or move
        // the entry, while std::condition_variable::wait_until reads its deadline again on waking.
        if (soonest != state_->departures.end()) {
            const Clock::time_point wakeAt = soonest->until;
            state_->changed.wait_until(lock, wakeAt);
        } else {
            state_->changed.wait(lock);
        }
    }
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
