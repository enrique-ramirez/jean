#include "third_party/doctest.h"

#include "core/stream_ticket.h"
#include "support/fixtures.h"

#include <string>

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

TEST_CASE("an expired ticket is dropped as it is refused") {
    auto tickets = store(seconds(60));
    const auto issued = tickets.issue(kStart);

    CHECK_FALSE(tickets.admits(issued.ticket, at(61)));
    CHECK(tickets.outstanding(kStart) == 0);
}

TEST_CASE("expired tickets do not count towards the cap") {
    auto tickets = store(seconds(60), 2);
    tickets.issue(kStart);
    tickets.issue(kStart);

    const auto later = tickets.issue(at(61));

    CHECK(tickets.outstanding(at(61)) == 1);
    CHECK(tickets.admits(later.ticket, at(61)));
}

TEST_CASE("issuing past the cap drops the oldest, not the newest") {
    auto tickets = store(seconds(120), 2);
    const auto first = tickets.issue(kStart);
    const auto second = tickets.issue(kStart);
    const auto third = tickets.issue(kStart);

    CHECK(tickets.outstanding(kStart) == 2);
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
    CHECK(tickets.outstanding(at(30)) == 0);
}

TEST_CASE("a thousand requests leave only the cap outstanding") {
    auto tickets = store(seconds(120), 8);

    for (int i = 0; i < 1000; ++i)
        tickets.issue(kStart);

    CHECK(tickets.outstanding(kStart) == 8);
}

TEST_CASE("a mint that fails issues nothing and stores nothing") {
    TicketStore tickets([] { return std::string(); }, seconds(120), 8);

    const auto issued = tickets.issue(kStart);

    CHECK(issued.ticket.empty());
    CHECK(issued.expiresIn == seconds(0));
    CHECK(tickets.outstanding(kStart) == 0);
    CHECK_FALSE(tickets.admits("", kStart));
}
