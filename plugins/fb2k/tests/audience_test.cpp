// Grouping sockets into people, and the linger that stops a reconnect looking like a
// departure. Both are what the mute hold reads, so a mistake here is a player that unmutes
// into somebody's headphones.

#include "third_party/doctest.h"

#include "core/audience.h"

#include "support/fixtures.h"

#include <chrono>
#include <future>
#include <string>
#include <thread>

using namespace jean;
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

    auto waiter = std::thread([&audience] {
        REQUIRE(audience.awaitChangeFrom(false));
        REQUIRE(audience.awaitChangeFrom(true));
    });

    {
        const auto held = audience.join(named("phone"), "opus", Audience::Clock::now());
    }

    waiter.join();
    CHECK_FALSE(audience.anyListening(Audience::Clock::now() + 1s));
}

TEST_CASE("closing releases a waiter rather than leaving a thread to join forever") {
    Audience audience(8, 30s);

    std::promise<void> started;
    auto waiter = std::thread([&audience, &started] {
        started.set_value();
        CHECK_FALSE(audience.awaitChangeFrom(false));
    });

    // The thread is running, which is all a fixed wait here could ever guess at. Whether it
    // is already inside the wait or has yet to reach it, closing has to release it either
    // way, and the proof of that is that this joins at all.
    started.get_future().wait();
    audience.close();
    waiter.join();
}
