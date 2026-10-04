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
