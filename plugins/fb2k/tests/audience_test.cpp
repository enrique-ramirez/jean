// Grouping sockets into people, and the linger that stops a reconnect looking like a
// departure. Both are what the mute hold reads, so a mistake here is a player that unmutes
// into somebody's headphones.

#include "third_party/doctest.h"

#include "core/audience.h"

#include "support/eventually.h"
#include "support/fixtures.h"
#include "support/test_server.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;

namespace {

constexpr auto kNoLinger = 0s;

DeviceIdentity named(std::string id, std::string name = {}) {
    return DeviceIdentity{std::move(id), std::move(name)};
}

}  // namespace

TEST_CASE("a name is trimmed, and an unusable one is dropped rather than refused") {
    CHECK(sanitised(named("device-1", "  Android phone  ")).name == "Android phone");

    // A newline forges a line in the log and a NUL truncates a string inside the SDK.
    CHECK(sanitised(named("device-1", "phone\nkitchen")).name.empty());
    CHECK(sanitised(named("device-1", std::string(200, 'x'))).name.empty());

    // The label goes and the device stays: nobody loses their audio over a bad name.
    CHECK(sanitised(named("device-1", std::string(200, 'x'))).id == "device-1");

    // Accented names are ordinary UTF-8, whose bytes are all >= 0x80, and must survive.
    CHECK(sanitised(named("device-1", "Teléfono")).name == "Teléfono");
}

TEST_CASE("two connections from one device are one listener") {
    Audience audience(8, kNoLinger);
    const auto now = Audience::Clock::now();

    // A probe alongside the real request; see audience.h.
    const auto probe = audience.join(named("phone", "Android phone"), "opus", now);
    const auto real = audience.join(named("phone", "Android phone"), "opus", now);
    REQUIRE(probe);
    REQUIRE(real);

    const auto roster = audience.roster(now);
    REQUIRE(roster.size() == 1);
    CHECK(roster[0].name == "Android phone");
    CHECK(roster[0].connections == 2);

    // The cap counts sockets, because sockets are what cost a thread.
    CHECK(audience.connections() == 2);
}

TEST_CASE("connections that named nothing are counted apart") {
    Audience audience(8, kNoLinger);
    const auto now = Audience::Clock::now();

    const auto first = audience.join(DeviceIdentity{}, "opus", now);
    const auto second = audience.join(DeviceIdentity{}, "opus", now);

    // Merging them would report two strangers as one person, which is the worse error.
    CHECK(audience.roster(now).size() == 2);
}

TEST_CASE("the cap refuses a connection rather than making room") {
    Audience audience(2, kNoLinger);
    const auto now = Audience::Clock::now();

    const auto first = audience.join(named("a"), "opus", now);
    const auto second = audience.join(named("b"), "opus", now);

    CHECK(audience.join(named("c"), "opus", now) == nullptr);
    CHECK(audience.connections() == 2);
}

TEST_CASE("a place is freed when the connection is dropped, so the cap is not a one-shot") {
    Audience audience(1, kNoLinger);
    const auto now = Audience::Clock::now();

    {
        const auto held = audience.join(named("a"), "opus", now);
        REQUIRE(held);
        CHECK(audience.join(named("b"), "opus", now) == nullptr);
    }

    CHECK(audience.join(named("b"), "opus", now) != nullptr);
}

TEST_CASE("a device that dropped is still listening for the linger") {
    Audience audience(8, 30s);
    const auto now = Audience::Clock::now();

    {
        const auto held = audience.join(named("phone"), "opus", now);
    }

    // The roster is who is connected; anyListening is what the player is muted for. A
    // reconnect is a gap of a second or two and the player must not unmute into it.
    CHECK(audience.roster(now).empty());
    CHECK(audience.anyListening(now));
    CHECK_FALSE(audience.anyListening(now + 31s));
}

TEST_CASE("rejoining ends the linger it was covered by") {
    Audience audience(8, 30s);
    const auto now = Audience::Clock::now();

    {
        const auto held = audience.join(named("phone"), "opus", now);
    }
    const auto back = audience.join(named("phone"), "opus", now);

    // Without this the departure outlives the reconnect and expires under a device that
    // is back, unmuting the player mid-listen.
    CHECK(audience.anyListening(now + 31s));
}

TEST_CASE("a device saying it meant to stop ends its linger now") {
    Audience audience(8, 30s);
    const auto now = Audience::Clock::now();

    {
        const auto held = audience.join(named("phone"), "opus", now);
    }
    REQUIRE(audience.anyListening(now));

    audience.leave("phone");
    CHECK_FALSE(audience.anyListening(now));
}

TEST_CASE("one device cannot end another's linger, or its own while it is connected") {
    Audience audience(8, 30s);
    const auto now = Audience::Clock::now();

    const auto held = audience.join(named("phone"), "opus", now);
    audience.leave("phone");
    CHECK(audience.anyListening(now));

    {
        const auto other = audience.join(named("laptop"), "opus", now);
    }

    // A laptop that closed cannot be sent away by anything but its own id.
    audience.leave("laptop-2");
    audience.leave("");
    CHECK(audience.anyListening(now));
}

TEST_CASE("an anonymous connection's key is not a device id anybody can send") {
    Audience audience(8, 30s);
    const auto now = Audience::Clock::now();

    {
        const auto held = audience.join(DeviceIdentity{}, "opus", now);
    }
    REQUIRE(audience.anyListening(now));

    // The key of an unnamed connection is its number, and the numbers start at one. A
    // phone that named nothing has no id to send, so anything spelling one is a guess --
    // and taking it would unmute the player into the reconnect the linger is covering.
    audience.leave("#1");
    audience.leave("#2");
    CHECK(audience.anyListening(now));
}

TEST_CASE("a device naming itself after this component's numbering is still its own row") {
    Audience audience(8, 30s);
    const auto now = Audience::Clock::now();

    const auto anonymous = audience.join(DeviceIdentity{}, "opus", now);
    const auto impostor = audience.join(named("#1", "Impostor"), "opus", now);

    // Both rows are published as "#1", and they are two people: the anonymous one is keyed
    // by a number this component chose, which is not something a device can send.
    const auto roster = audience.roster(now);
    REQUIRE(roster.size() == 2);
    CHECK(roster[0].deviceId == "#1");
    CHECK(roster[1].deviceId == "#1");
    CHECK(roster[0].connections == 1);
    CHECK(roster[1].connections == 1);
}

TEST_CASE("waiting ends when somebody joins, and again when the linger runs out") {
    Audience audience(8, 50ms);

    std::atomic<bool> finished{false};
    bool joined = false;
    bool lingeredOut = false;
    auto waiter = std::thread([&] {
        joined = audience.awaitChangeFrom(false);
        lingeredOut = audience.awaitChangeFrom(true);
        finished = true;
    });

    const bool waiting = eventually([&audience] { return audience.waitingForAChange() == 1; });
    {
        const auto held = audience.join(named("phone"), "opus", Audience::Clock::now());
    }

    joinOnceFinished(waiter, finished, "a join and then the end of its linger");

    CHECK(waiting);
    CHECK(joined);
    CHECK(lingeredOut);
    CHECK_FALSE(audience.anyListening(Audience::Clock::now() + 1s));
}

TEST_CASE("closing releases a waiter rather than leaving a thread to join forever") {
    Audience audience(8, 30s);

    std::atomic<bool> finished{false};
    bool changed = true;
    auto waiter = std::thread([&] {
        changed = audience.awaitChangeFrom(false);
        finished = true;
    });

    const bool waiting = eventually([&audience] { return audience.waitingForAChange() == 1; });
    audience.close();
    joinOnceFinished(waiter, finished, "a close");

    CHECK(waiting);
    CHECK_FALSE(changed);
}

// The waiter sleeps until the soonest linger ends with the lock released, and a reconnect erases
// that linger while it sleeps. Waiting on a reference into the list rather than on a copy of the
// deadline reads freed memory as it wakes, which AddressSanitizer reports.
TEST_CASE("a reconnect ending the linger a waiter is sleeping out leaves that waiter waiting") {
    Audience audience(8, 30s);
    {
        const auto dropped = audience.join(named("phone"), "opus", Audience::Clock::now());
    }

    std::atomic<bool> finished{false};
    bool changed = true;
    auto waiter = std::thread([&] {
        changed = audience.awaitChangeFrom(true);
        finished = true;
    });

    const bool waiting = eventually([&audience] { return audience.waitingForAChange() == 1; });
    const auto back = audience.join(named("phone"), "opus", Audience::Clock::now());

    audience.close();
    joinOnceFinished(waiter, finished, "a close");

    CHECK(waiting);
    CHECK(back);
    CHECK_FALSE(changed);
}

namespace {

constexpr auto kLinger = 30s;

// A steady clock counts from boot on macOS, Linux and Windows, so a departure stamped by the real
// clock rather than the one the audience was given lands years before any instant read off this.
constexpr auto kLongAfterBoot = std::chrono::hours(24 * 365 * 10);

}  // namespace

TEST_CASE("a linger is measured on the clock the audience was given") {
    ManualClock clock;
    clock.advance(kLongAfterBoot);
    Audience audience(8, kLinger, [&clock] { return clock.now(); });

    {
        const auto held = audience.join(named("phone"), "opus", clock.now());
        clock.advance(10min);
    }

    CHECK(audience.anyListening(clock.now() + 29s));
    CHECK_FALSE(audience.anyListening(clock.now() + 31s));
}

TEST_CASE("a sibling audience counts against the cap of the one it came from") {
    Audience engine(2, kNoLinger);
    const auto session = engine.sibling();
    const auto now = Audience::Clock::now();

    auto phone = engine.join(named("phone"), "opus", now);
    const auto laptop = session->join(named("laptop"), "opus", now);
    REQUIRE(phone);
    REQUIRE(laptop);

    CHECK(session->join(named("tablet"), "opus", now) == nullptr);
    CHECK(engine.join(named("tablet"), "opus", now) == nullptr);

    phone.reset();
    CHECK(session->join(named("tablet"), "opus", now) != nullptr);
}

TEST_CASE("a sibling audience keeps its own roster and departures, on the same linger") {
    ManualClock clock;
    clock.advance(kLongAfterBoot);
    Audience engine(8, kLinger, [&clock] { return clock.now(); });
    const auto session = engine.sibling();
    const auto now = clock.now();

    const auto phone = session->join(named("phone"), "opus", now);
    {
        const auto laptop = session->join(named("laptop"), "opus", now);
    }

    CHECK(engine.roster(now).empty());
    CHECK_FALSE(engine.anyListening(now));
    REQUIRE(session->roster(now).size() == 1);
    CHECK(session->roster(now)[0].deviceId == "phone");

    engine.leave("laptop");
    CHECK(session->holds("laptop", now + 29s));
    CHECK_FALSE(session->holds("laptop", now + 31s));

    session->leave("laptop");
    CHECK_FALSE(session->holds("laptop", now));
}

TEST_CASE("a sibling audience goes on taking listeners after the one it came from is gone") {
    std::unique_ptr<Audience> session;
    {
        const Audience engine(1, kNoLinger);
        session = engine.sibling();
    }
    const auto now = Audience::Clock::now();

    const auto phone = session->join(named("phone"), "opus", now);
    CHECK(phone);
    CHECK(session->join(named("laptop"), "opus", now) == nullptr);
}

TEST_CASE("an audience holds a device while it is connected and through its linger") {
    ManualClock clock;
    clock.advance(kLongAfterBoot);
    Audience audience(8, kLinger, [&clock] { return clock.now(); });
    const auto now = clock.now();

    CHECK_FALSE(audience.holds("phone", now));
    {
        const auto held = audience.join(named("phone"), "opus", now);
        CHECK(audience.holds("phone", now));
        CHECK_FALSE(audience.holds("laptop", now));
    }

    CHECK(audience.holds("phone", now + 29s));
    CHECK_FALSE(audience.holds("phone", now + 31s));

    audience.leave("phone");
    CHECK_FALSE(audience.holds("phone", now));
}

TEST_CASE("an audience holds no device for an empty id, whoever is connected unnamed") {
    Audience audience(8, kLinger);
    const auto now = Audience::Clock::now();

    const auto first = audience.join(DeviceIdentity{}, "opus", now);
    {
        const auto second = audience.join(DeviceIdentity{}, "opus", now);
    }

    CHECK_FALSE(audience.holds("", now));
    CHECK_FALSE(audience.holds("#1", now));
    CHECK_FALSE(audience.holds("#2", now));
}

namespace {

constexpr int kDroppedConnections = 50;

size_t mostHeldAcross(Audience& audience, ManualClock& clock, int times) {
    size_t most = 0;
    for (int dropped = 0; dropped < times; ++dropped) {
        audience.join(DeviceIdentity{}, "opus", clock.now()).reset();
        most = std::max(most, audience.departuresHeld());
        clock.advance(kLinger + 1s);
    }
    return most;
}

}  // namespace

// An unnamed connection's key is new each time, so no rejoin ever drops its departure: without a
// sweep the list grows with every connection a client opens and drops, and holds() and
// anyListening() scan it all under the lock.
TEST_CASE("unnamed connections opened and dropped leave no more than one departure behind") {
    ManualClock clock;
    clock.advance(kLongAfterBoot);
    Audience engine(8, kLinger, [&clock] { return clock.now(); });
    const auto session = engine.sibling();

    SUBCASE("a session's audience") {
        CHECK(mostHeldAcross(*session, clock, kDroppedConnections) <= 1);

        const auto next = session->join(DeviceIdentity{}, "opus", clock.now());
        CHECK(session->departuresHeld() == 0);
    }
    SUBCASE("the audience it is a sibling of") {
        CHECK(mostHeldAcross(engine, clock, kDroppedConnections) <= 1);

        const auto next = engine.join(DeviceIdentity{}, "opus", clock.now());
        CHECK(engine.departuresHeld() == 0);
    }
}

// No join comes between these departures, so only a release can sweep the one before it.
TEST_CASE("devices leaving one at a time, a linger apart, leave no more than one departure") {
    ManualClock clock;
    clock.advance(kLongAfterBoot);
    const Audience engine(8, kLinger, [&clock] { return clock.now(); });
    const auto session = engine.sibling();

    std::vector<std::shared_ptr<Audience::Membership>> connected;
    connected.reserve(8);
    for (int at = 0; at < 8; ++at)
        connected.push_back(session->join(DeviceIdentity{}, "opus", clock.now()));

    size_t most = 0;
    while (!connected.empty()) {
        connected.pop_back();
        most = std::max(most, session->departuresHeld());
        clock.advance(kLinger + 1s);
    }

    CHECK(most <= 1);
}

TEST_CASE("a device dropping twice inside its linger leaves one departure") {
    ManualClock clock;
    clock.advance(kLongAfterBoot);
    Audience engine(8, kLinger, [&clock] { return clock.now(); });
    const auto session = engine.sibling();

    for (Audience* audience : {&engine, session.get()}) {
        audience->join(named("phone"), "opus", clock.now()).reset();
        clock.advance(1s);
        audience->join(named("phone"), "opus", clock.now()).reset();

        CHECK(audience->departuresHeld() == 1);
        CHECK(audience->holds("phone", clock.now()));
    }
}
