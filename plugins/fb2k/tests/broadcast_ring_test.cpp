#include "third_party/doctest.h"

#include "core/broadcast_ring.h"
#include "support/eventually.h"

#include <atomic>
#include <chrono>
#include <string>
#include <thread>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;

namespace {

using Read = BroadcastRing::Read;

// Past the watchdog, so a listener a wake never reaches is still waiting when it runs out.
constexpr auto kPatience = 30s;
static_assert(kPatience > kWatchdog);

void put(BroadcastRing& ring, const std::string& bytes) {
    ring.write(reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size());
}

// Blocks if `want` exceeds what the ring holds.
std::string take(BroadcastRing& ring, BroadcastRing::Cursor& cursor, size_t want) {
    std::string got;
    std::vector<std::uint8_t> out;

    while (got.size() < want) {
        if (ring.read(cursor, out, kPatience) != Read::ok)
            break;
        got.append(out.begin(), out.end());
    }

    return got;
}

}  // namespace

TEST_CASE("bytes written come back to a subscriber") {
    BroadcastRing ring(64);
    auto cursor = ring.subscribe();

    put(ring, "hello");

    CHECK(take(ring, cursor, 5) == "hello");
}

TEST_CASE("two listeners read the same bytes without affecting each other") {
    BroadcastRing ring(64);
    auto one = ring.subscribe();
    auto two = ring.subscribe();

    put(ring, "shared");

    CHECK(take(ring, one, 6) == "shared");
    CHECK(take(ring, two, 6) == "shared");
}

TEST_CASE("a listener joins at the live edge rather than replaying the buffer") {
    BroadcastRing ring(64);
    put(ring, "before you arrived");

    auto cursor = ring.subscribe();
    put(ring, "live");

    CHECK(take(ring, cursor, 4) == "live");
}

TEST_CASE("bytes stay in order across a wraparound") {
    BroadcastRing ring(8);
    auto cursor = ring.subscribe();

    std::string expected;
    std::string got;
    for (int i = 0; i < 10; ++i) {
        const std::string piece = "ab" + std::to_string(i);
        put(ring, piece);
        got += take(ring, cursor, piece.size());
        expected += piece;
    }

    CHECK(got == expected);
    CHECK(ring.subscribe() == expected.size());
}

TEST_CASE("a listener that stops reading is lapped rather than waited for") {
    BroadcastRing ring(8);
    auto slow = ring.subscribe();

    put(ring, "12345");
    put(ring, "6789");

    std::vector<std::uint8_t> out;
    CHECK(ring.read(slow, out, kPatience) == Read::lapped);
}

TEST_CASE("being lapped is not cured by more data arriving") {
    BroadcastRing ring(8);
    auto slow = ring.subscribe();

    put(ring, "aaaaaaaaaaaaaaaa");

    std::vector<std::uint8_t> out;
    CHECK(ring.read(slow, out, kPatience) == Read::lapped);

    put(ring, "bb");
    CHECK(ring.read(slow, out, kPatience) == Read::lapped);
}

TEST_CASE("a reader keeping up is never lapped, however much goes through") {
    BroadcastRing ring(8);
    auto cursor = ring.subscribe();

    std::vector<std::uint8_t> out;
    for (int i = 0; i < 200; ++i) {
        put(ring, "1234");
        REQUIRE(ring.read(cursor, out, kPatience) == Read::ok);
    }

    CHECK(ring.subscribe() == 800);
}

TEST_CASE("a write larger than the whole ring keeps the offsets consistent") {
    BroadcastRing ring(4);
    auto stale = ring.subscribe();

    put(ring, "0123456789");

    std::vector<std::uint8_t> out;
    CHECK(ring.read(stale, out, kPatience) == Read::lapped);

    auto fresh = ring.subscribe();
    CHECK(fresh == 10);

    put(ring, "xy");
    CHECK(take(ring, fresh, 2) == "xy");
}

TEST_CASE("closing lets a reader finish what is already there and then stops it") {
    BroadcastRing ring(64);
    auto cursor = ring.subscribe();

    put(ring, "last words");
    ring.close();

    CHECK(take(ring, cursor, 10) == "last words");

    std::vector<std::uint8_t> out;
    CHECK(ring.read(cursor, out, kPatience) == Read::closed);
}

TEST_CASE("a write after closing is ignored") {
    BroadcastRing ring(64);
    auto cursor = ring.subscribe();

    ring.close();
    put(ring, "too late");

    std::vector<std::uint8_t> out;
    CHECK(ring.read(cursor, out, kPatience) == Read::closed);
    CHECK(ring.subscribe() == 0);
}

TEST_CASE("closing wakes a listener that is waiting for bytes") {
    BroadcastRing ring(64);
    auto cursor = ring.subscribe();

    std::atomic<bool> finished{false};
    Read result = Read::ok;
    std::thread listener([&] {
        std::vector<std::uint8_t> out;
        result = ring.read(cursor, out, kPatience);
        finished = true;
    });

    const bool waiting = eventually([&ring] { return ring.waitingReaders() == 1; });
    ring.close();
    joinOnceFinished(listener, finished, "a close");

    CHECK(waiting);
    CHECK(result == Read::closed);
}

TEST_CASE("a listener waiting on an idle ring is woken by a write") {
    BroadcastRing ring(64);
    auto cursor = ring.subscribe();

    std::atomic<bool> finished{false};
    std::string got;
    std::thread listener([&] {
        std::vector<std::uint8_t> out;
        if (ring.read(cursor, out, kPatience) == Read::ok)
            got.assign(out.begin(), out.end());
        finished = true;
    });

    const bool waiting = eventually([&ring] { return ring.waitingReaders() == 1; });
    put(ring, "wake up");
    joinOnceFinished(listener, finished, "a write");

    CHECK(waiting);
    CHECK(got == "wake up");
}

TEST_CASE("a reader with nothing to read is handed back rather than left blocked") {
    BroadcastRing ring(64);
    auto cursor = ring.subscribe();
    std::vector<std::uint8_t> out;

    CHECK(ring.read(cursor, out, 30ms) == Read::idle);

    // `idle` is not an end and not an error: the cursor is untouched and the next read picks
    // up whatever arrives.
    CHECK(out.empty());
    put(ring, "later");
    CHECK(ring.read(cursor, out, kPatience) == Read::ok);
    CHECK(std::string(out.begin(), out.end()) == "later");
}
