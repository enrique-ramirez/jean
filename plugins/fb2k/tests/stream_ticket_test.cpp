#include "third_party/doctest.h"

#include "core/session.h"
#include "core/stream_ticket.h"
#include "support/fixtures.h"

#include <algorithm>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono;

namespace {

constexpr TicketStore::Clock::time_point kStart{seconds(1000)};

TicketStore::Clock::time_point at(int64_t elapsed) {
    return kStart + seconds(elapsed);
}

TicketStore store(seconds ttl = seconds(120), size_t maxOutstanding = 8) {
    return TicketStore(countingMint(), ttl, maxOutstanding);
}

DeviceIdentity phone() {
    return {"phone", "Kitchen phone"};
}

DeviceIdentity laptop() {
    return {"laptop", "Study laptop"};
}

DeviceIdentity tablet() {
    return {"tablet", "Sofa tablet"};
}

size_t admittedOf(TicketStore& tickets, const std::vector<std::string>& issued) {
    return static_cast<size_t>(
        std::count_if(issued.begin(), issued.end(), [&tickets](const auto& ticket) {
            return static_cast<bool>(tickets.admits(ticket, kStart));
        }));
}

}  // namespace

TEST_CASE("an issued ticket is accepted") {
    auto tickets = store();

    const auto issued = tickets.issue(kStart);
    CHECK(issued.ticket == "ticket-1");
    CHECK(issued.expiresIn == seconds(120));
    CHECK(tickets.admits(issued.ticket, kStart));
}

TEST_CASE("a ticket serves more than one request inside its window") {
    auto tickets = store(seconds(60));
    const auto issued = tickets.issue(kStart);

    CHECK(tickets.admits(issued.ticket, kStart));
    CHECK(tickets.admits(issued.ticket, at(1)));
    CHECK(tickets.admits(issued.ticket, at(59)));
    CHECK_FALSE(tickets.admits(issued.ticket, at(61)));
}

TEST_CASE("a ticket expires") {
    auto tickets = store(seconds(60));
    const auto issued = tickets.issue(kStart);

    CHECK_FALSE(tickets.admits(issued.ticket, at(61)));
}

TEST_CASE("a ticket is still good on the last second of its life") {
    auto tickets = store(seconds(60));
    const auto issued = tickets.issue(kStart);

    CHECK(tickets.admits(issued.ticket, at(59)));
}

TEST_CASE("an unknown ticket is refused") {
    auto tickets = store();
    tickets.issue(kStart);

    CHECK_FALSE(tickets.admits("ticket-99", kStart));
    CHECK_FALSE(tickets.admits("", kStart));
}

TEST_CASE("accepting one ticket leaves the others alone") {
    auto tickets = store();
    const auto first = tickets.issue(kStart);
    const auto second = tickets.issue(kStart);

    CHECK(tickets.admits(first.ticket, kStart));
    CHECK(tickets.admits(second.ticket, kStart));
}

// Asked again at a time the ticket was still good, it is refused: the refusal removed it rather
// than only reporting it expired.
TEST_CASE("an expired ticket is dropped as it is refused") {
    auto tickets = store(seconds(60));
    const auto issued = tickets.issue(kStart);

    CHECK_FALSE(tickets.admits(issued.ticket, at(61)));
    CHECK_FALSE(tickets.admits(issued.ticket, kStart));
}

TEST_CASE("expired tickets do not count towards the cap") {
    auto tickets = store(seconds(60), 2);
    tickets.issue(kStart);
    tickets.issue(kStart);

    const auto later = tickets.issue(at(61));
    const auto latest = tickets.issue(at(61));

    CHECK(tickets.admits(later.ticket, at(61)));
    CHECK(tickets.admits(latest.ticket, at(61)));
}

TEST_CASE("issuing past the cap drops the oldest, not the newest") {
    auto tickets = store(seconds(120), 2);
    const auto first = tickets.issue(kStart);
    const auto second = tickets.issue(kStart);
    const auto third = tickets.issue(kStart);

    CHECK_FALSE(tickets.admits(first.ticket, kStart));
    CHECK(tickets.admits(second.ticket, kStart));
    CHECK(tickets.admits(third.ticket, kStart));
}

TEST_CASE("no number of uses extends a ticket past its expiry, so a leaked URL dies with it") {
    auto tickets = store(seconds(30));
    const auto issued = tickets.issue(kStart);

    for (int i = 0; i < 29; ++i)
        CHECK(tickets.admits(issued.ticket, at(i)));

    CHECK_FALSE(tickets.admits(issued.ticket, at(30)));
}

TEST_CASE("a thousand requests leave only the cap outstanding") {
    auto tickets = store(seconds(120), 8);

    constexpr int kRequests = 1000;
    std::vector<std::string> issued;
    issued.reserve(kRequests);
    for (int i = 0; i < kRequests; ++i)
        issued.push_back(tickets.issue(kStart).ticket);

    const auto admitted =
        std::count_if(issued.begin(), issued.end(), [&tickets](const auto& ticket) {
            return static_cast<bool>(tickets.admits(ticket, kStart));
        });

    CHECK(admitted == 8);
    CHECK(tickets.admits(issued.back(), kStart));
}

// Two tickets for two sessions, admitted in the other order, so an admission answering the session
// of the ticket issued last, or first, names the wrong one.
TEST_CASE("an admission names the session its ticket was issued for") {
    auto tickets = store();
    const auto forKitchen =
        tickets.issue(kStart, DeviceIdentity{"phone", "Android phone"}, "Wb3kq");
    const auto forDesk = tickets.issue(kStart, DeviceIdentity{"laptop", "Laptop"}, "Ad9xz");

    const auto desk = tickets.admits(forDesk.ticket, kStart);
    const auto kitchen = tickets.admits(forKitchen.ticket, kStart);

    REQUIRE(desk);
    REQUIRE(kitchen);
    CHECK(desk.session == "Ad9xz");
    CHECK(desk.device.id == "laptop");
    CHECK(kitchen.session == "Wb3kq");
    CHECK(kitchen.device.id == "phone");
}

TEST_CASE("a ticket issued for no session admits to the engine session") {
    auto tickets = store();
    const auto issued = tickets.issue(kStart, DeviceIdentity{"phone", "Android phone"});

    const auto admission = tickets.admits(issued.ticket, kStart);

    REQUIRE(admission);
    CHECK((admission.session.empty() || admission.session == kEngineSessionId));
}

// A cap of one, so a failed mint that stored anything at all would push out the ticket issued
// before it.
TEST_CASE("a mint that fails issues nothing and stores nothing") {
    bool failing = false;
    TicketStore tickets([&failing] { return failing ? std::string() : std::string("ticket"); },
                        seconds(120), 1);

    const auto good = tickets.issue(kStart);
    failing = true;
    const auto issued = tickets.issue(kStart);

    CHECK(issued.ticket.empty());
    CHECK(issued.expiresIn == seconds(0));
    CHECK(tickets.admits(good.ticket, kStart));
    CHECK_FALSE(tickets.admits("", kStart));
}

TEST_CASE("a device minting in a loop pushes out its own oldest tickets and no other device's") {
    auto tickets = store(seconds(120), 3);
    const auto bystander = tickets.issue(kStart, laptop());

    constexpr int kMints = 10;
    std::vector<std::string> looped;
    looped.reserve(kMints);
    for (int mint = 0; mint < kMints; ++mint) {
        looped.push_back(tickets.issue(kStart, phone()).ticket);
        CHECK(tickets.admits(looped.back(), kStart));
        CHECK(tickets.admits(bystander.ticket, kStart));
    }

    for (int mint = 0; mint < kMints - 2; ++mint)
        CHECK_FALSE(tickets.admits(looped[static_cast<size_t>(mint)], kStart));
    CHECK(tickets.admits(looped[kMints - 2], kStart));
    CHECK(tickets.admits(looped[kMints - 1], kStart));
}

TEST_CASE("a device holding one ticket in a full store gives up that one for its next") {
    auto tickets = store(seconds(120), 3);
    const auto laptopOlder = tickets.issue(kStart, laptop());
    const auto phoneOnly = tickets.issue(kStart, phone());
    const auto laptopNewer = tickets.issue(kStart, laptop());

    const auto phoneNext = tickets.issue(kStart, phone());

    CHECK(tickets.admits(laptopOlder.ticket, kStart));
    CHECK(tickets.admits(laptopNewer.ticket, kStart));
    CHECK_FALSE(tickets.admits(phoneOnly.ticket, kStart));
    CHECK(tickets.admits(phoneNext.ticket, kStart));
}

TEST_CASE("an anonymous mint into a full store pushes out the oldest anonymous ticket") {
    auto tickets = store(seconds(120), 3);
    const auto named = tickets.issue(kStart, phone());
    const auto anonymousOlder = tickets.issue(kStart);
    const auto anonymousNewer = tickets.issue(kStart);

    const auto anonymousNext = tickets.issue(kStart);

    CHECK(tickets.admits(named.ticket, kStart));
    CHECK_FALSE(tickets.admits(anonymousOlder.ticket, kStart));
    CHECK(tickets.admits(anonymousNewer.ticket, kStart));
    CHECK(tickets.admits(anonymousNext.ticket, kStart));
}

TEST_CASE("a named device minting into a full store leaves an anonymous ticket alone") {
    auto tickets = store(seconds(120), 3);
    const auto anonymous = tickets.issue(kStart);
    const auto phoneOlder = tickets.issue(kStart, phone());
    const auto phoneNewer = tickets.issue(kStart, phone());

    const auto phoneNext = tickets.issue(kStart, phone());

    CHECK(tickets.admits(anonymous.ticket, kStart));
    CHECK_FALSE(tickets.admits(phoneOlder.ticket, kStart));
    CHECK(tickets.admits(phoneNewer.ticket, kStart));
    CHECK(tickets.admits(phoneNext.ticket, kStart));
}

TEST_CASE("a device that changed its name is still the device its id says") {
    auto tickets = store(seconds(120), 3);
    const auto bystander = tickets.issue(kStart, laptop());
    const auto older = tickets.issue(kStart, DeviceIdentity{"phone", "Kitchen phone"});
    const auto newer = tickets.issue(kStart, DeviceIdentity{"phone", "Kitchen phone"});

    const auto renamed = tickets.issue(kStart, DeviceIdentity{"phone", "Bedroom phone"});

    CHECK(tickets.admits(bystander.ticket, kStart));
    CHECK_FALSE(tickets.admits(older.ticket, kStart));
    CHECK(tickets.admits(newer.ticket, kStart));
    CHECK(tickets.admits(renamed.ticket, kStart));
}

TEST_CASE("two devices that share a name are two devices") {
    auto tickets = store(seconds(120), 3);
    const auto oldest = tickets.issue(kStart, laptop());
    const auto namesake = tickets.issue(kStart, DeviceIdentity{"phone", "Jean"});
    const auto namesakeAgain = tickets.issue(kStart, DeviceIdentity{"phone", "Jean"});

    const auto arrived = tickets.issue(kStart, DeviceIdentity{"tablet", "Jean"});

    CHECK_FALSE(tickets.admits(oldest.ticket, kStart));
    CHECK(tickets.admits(namesake.ticket, kStart));
    CHECK(tickets.admits(namesakeAgain.ticket, kStart));
    CHECK(tickets.admits(arrived.ticket, kStart));
}

TEST_CASE("an id sent with blanks around it is the device the bare id names") {
    auto tickets = store(seconds(120), 3);
    const auto bystander = tickets.issue(kStart, laptop());
    const auto older = tickets.issue(kStart, DeviceIdentity{"phone", {}});
    const auto newer = tickets.issue(kStart, DeviceIdentity{" phone\t", {}});

    const auto next = tickets.issue(kStart, DeviceIdentity{"\t phone ", {}});

    CHECK(tickets.admits(bystander.ticket, kStart));
    CHECK_FALSE(tickets.admits(older.ticket, kStart));
    CHECK(tickets.admits(newer.ticket, kStart));
    CHECK(tickets.admits(next.ticket, kStart));
}

TEST_CASE("an id the store will not carry mints as an anonymous one") {
    auto tickets = store(seconds(120), 3);
    const auto named = tickets.issue(kStart, phone());
    const auto anonymous = tickets.issue(kStart);

    DeviceIdentity unnamed;
    SUBCASE("one with a line break in it") {
        unnamed.id = "pho\nne";
    }
    SUBCASE("one too long to show") {
        unnamed.id = std::string(kMaxDeviceIdLength + 1, 'p');
    }

    const auto filling = tickets.issue(kStart, unnamed);
    const auto next = tickets.issue(kStart, unnamed);

    CHECK(tickets.admits(named.ticket, kStart));
    CHECK_FALSE(tickets.admits(anonymous.ticket, kStart));
    CHECK(tickets.admits(filling.ticket, kStart));
    CHECK(tickets.admits(next.ticket, kStart));
}

TEST_CASE("ids that differ by a letter's case are two devices") {
    auto tickets = store(seconds(120), 3);
    const auto oldest = tickets.issue(kStart, laptop());
    const auto lower = tickets.issue(kStart, DeviceIdentity{"phone", {}});
    const auto lowerAgain = tickets.issue(kStart, DeviceIdentity{"phone", {}});

    const auto upper = tickets.issue(kStart, DeviceIdentity{"Phone", {}});

    CHECK_FALSE(tickets.admits(oldest.ticket, kStart));
    CHECK(tickets.admits(lower.ticket, kStart));
    CHECK(tickets.admits(lowerAgain.ticket, kStart));
    CHECK(tickets.admits(upper.ticket, kStart));
}

TEST_CASE("a device new to a full store takes the place of the oldest ticket of all") {
    auto tickets = store(seconds(120), 3);
    const auto oldest = tickets.issue(kStart, laptop());
    const auto phones = tickets.issue(kStart, phone());
    const auto laptopNewer = tickets.issue(kStart, laptop());

    SUBCASE("a named one") {
        const auto arrived = tickets.issue(kStart, tablet());
        CHECK(tickets.admits(arrived.ticket, kStart));
    }
    SUBCASE("an anonymous one") {
        const auto arrived = tickets.issue(kStart);
        CHECK(tickets.admits(arrived.ticket, kStart));
    }

    CHECK_FALSE(tickets.admits(oldest.ticket, kStart));
    CHECK(tickets.admits(phones.ticket, kStart));
    CHECK(tickets.admits(laptopNewer.ticket, kStart));
}

TEST_CASE("an expired ticket makes the room, so no ticket still good is pushed out") {
    auto tickets = store(seconds(60), 3);

    SUBCASE("another device's expired, with the minting device holding the rest") {
        tickets.issue(kStart, laptop());
        const auto older = tickets.issue(at(30), phone());
        const auto newer = tickets.issue(at(30), phone());

        const auto next = tickets.issue(at(61), phone());

        CHECK(tickets.admits(older.ticket, at(61)));
        CHECK(tickets.admits(newer.ticket, at(61)));
        CHECK(tickets.admits(next.ticket, at(61)));
    }

    SUBCASE("the minting device's own expired, with another device holding the rest") {
        tickets.issue(kStart, phone());
        const auto older = tickets.issue(at(30), laptop());
        const auto newer = tickets.issue(at(30), laptop());

        const auto next = tickets.issue(at(61), phone());

        CHECK(tickets.admits(older.ticket, at(61)));
        CHECK(tickets.admits(newer.ticket, at(61)));
        CHECK(tickets.admits(next.ticket, at(61)));
    }
}

TEST_CASE("a device's tickets for different sessions are pushed out as one device's") {
    auto tickets = store(seconds(120), 3);
    const auto bystander = tickets.issue(kStart, laptop(), "Ad9xz");
    const auto older = tickets.issue(kStart, phone(), "Wb3kq");
    const auto newer = tickets.issue(kStart, phone());

    const auto next = tickets.issue(kStart, phone(), "Ad9xz");

    CHECK(tickets.admits(bystander.ticket, kStart));
    CHECK_FALSE(tickets.admits(older.ticket, kStart));
    CHECK(tickets.admits(newer.ticket, kStart));
    CHECK(tickets.admits(next.ticket, kStart));
}

TEST_CASE("a new device minting for a session others hold tickets for is still a new device") {
    auto tickets = store(seconds(120), 3);
    const auto oldest = tickets.issue(kStart, laptop(), "Ad9xz");
    const auto older = tickets.issue(kStart, phone(), "Wb3kq");
    const auto newer = tickets.issue(kStart, phone(), "Wb3kq");

    const auto arrived = tickets.issue(kStart, tablet(), "Wb3kq");

    CHECK_FALSE(tickets.admits(oldest.ticket, kStart));
    CHECK(tickets.admits(older.ticket, kStart));
    CHECK(tickets.admits(newer.ticket, kStart));
    CHECK(tickets.admits(arrived.ticket, kStart));
}

TEST_CASE("devices arriving one after another leave only the cap outstanding, the newest of them") {
    auto tickets = store(seconds(120), 3);

    constexpr int kDevices = 10;
    std::vector<std::string> issued;
    issued.reserve(kDevices);
    for (int device = 0; device < kDevices; ++device) {
        issued.push_back(
            tickets.issue(kStart, DeviceIdentity{"device-" + std::to_string(device), {}}).ticket);
    }

    CHECK(admittedOf(tickets, issued) == 3);
    CHECK(admittedOf(tickets, {issued.end() - 3, issued.end()}) == 3);
}
