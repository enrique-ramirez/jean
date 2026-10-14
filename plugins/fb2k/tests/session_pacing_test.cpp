// A detached session's decoder held to 1x. A wrong answer here is a listener running dry, or a
// decoder lapping the rings and dropping audio nobody heard.

#include "third_party/doctest.h"

#include "core/pacer.h"
#include "core/pcm_ring.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <vector>

using namespace jean;
using namespace std::chrono_literals;

namespace {

using Time = Pacer::Clock::time_point;

constexpr Time kStart = Time(24h);

// Instants are whole nanoseconds and a block's length is not, so an instant answered for a block
// may sit up to a nanosecond either side of the exact one, and a long run adds those up.
constexpr double kSlack = 1e-3;

constexpr double kPlentyOfRoom = 60.0;

constexpr double kLead = std::chrono::duration<double>(kSessionLead).count();

struct Block {
    size_t frames = 0;
    unsigned sampleRate = 0;

    double seconds() const { return static_cast<double>(frames) / sampleRate; }
};

double secondsBetween(Time from, Time to) {
    return std::chrono::duration<double>(to - from).count();
}

struct Run {
    double mostAhead = -1e9;
    double leastMargin = 1e9;
    int mostAsks = 0;
    double audio = 0;
    Time now;
};

// Asks for each block as a decoder does: again at once after a release, and at askAgain after a
// refusal. Stops early where an ask at askAgain is refused a second time.
Run decode(Pacer& pacer, const std::vector<Block>& blocks, Time first) {
    Run run;
    run.now = first;

    for (const Block& block : blocks) {
        for (int asks = 1;; ++asks) {
            run.mostAsks = std::max(run.mostAsks, asks);
            if (asks > 2)
                return run;

            const auto verdict = pacer.ask(block.frames, block.sampleRate, kPlentyOfRoom, run.now);
            if (verdict.release) {
                const double ahead = run.audio - secondsBetween(first, run.now);
                run.mostAhead = std::max(run.mostAhead, ahead);
                run.leastMargin = std::min(run.leastMargin, ahead - std::min(kLead, run.audio));
                run.audio += block.seconds();
                break;
            }

            REQUIRE(verdict.askAgain > run.now);
            run.now = verdict.askAgain;
        }
    }

    return run;
}

std::vector<Block> lasting(double seconds, const std::vector<Block>& cycle) {
    std::vector<Block> blocks;
    double total = 0;
    for (size_t i = 0; total < seconds; ++i) {
        blocks.push_back(cycle[i % cycle.size()]);
        total += blocks.back().seconds();
    }
    return blocks;
}

struct Burst {
    double audio = 0;
    Pacer::Verdict refused;
};

Burst burstAt(Pacer& pacer, Block block, Time now) {
    Burst burst;
    for (int i = 0; i < 100000; ++i) {
        const auto verdict = pacer.ask(block.frames, block.sampleRate, kPlentyOfRoom, now);
        if (!verdict.release) {
            burst.refused = verdict;
            return burst;
        }
        burst.audio += block.seconds();
    }
    FAIL("the pacer released a hundred thousand blocks at one instant");
    return burst;
}

// 1024 frames at 48 kHz last 21.333... ms, which no whole count of nanoseconds equals.
constexpr Block kUneven{1024, 48000};

PcmBlock silence(Block block) {
    PcmBlock made;
    made.spec = {block.sampleRate, 2};
    made.samples.assign(block.frames * 2, 0.F);
    return made;
}

}  // namespace

TEST_CASE("a session decodes half a second ahead of what has played") {
    CHECK(kSessionLead == 500ms);
}

TEST_CASE("over ten minutes the audio released stays one lead ahead of the clock") {
    Pacer pacer(kSessionLead);
    const auto run = decode(pacer, lasting(600, {kUneven}), kStart);

    CHECK(run.mostAsks <= 2);
    CHECK(run.mostAhead <= kLead + kSlack);

    // Past the first half second every block goes the moment the audio before it is a lead ahead,
    // so the clock never gains on it: 1x.
    CHECK(run.leastMargin >= -kSlack);
    const double lastReleasedAt = run.audio - kUneven.seconds() - kLead;
    CHECK(std::abs(secondsBetween(kStart, run.now) - lastReleasedAt) <= kSlack);
}

TEST_CASE("blocks of mixed rates and sizes are each paced by their own length") {
    const std::vector<Block> cycle{
        {4096, 44100}, {512, 96000}, {1152, 48000}, {2048, 22050}, {960, 48000}};
    Pacer pacer(kSessionLead);
    const auto run = decode(pacer, lasting(300, cycle), kStart);

    CHECK(run.mostAsks <= 2);
    CHECK(run.mostAhead <= kLead + kSlack);
    CHECK(run.leastMargin >= -kSlack);
}

TEST_CASE("a block asked for early is held until it is due, and goes when asked at that instant") {
    Pacer pacer(kSessionLead);
    const auto burst = burstAt(pacer, kUneven, kStart);

    // The first half second goes at once; the next block is due when the audio released ahead of
    // it is a lead ahead of the clock.
    CHECK(burst.audio >= kLead);
    CHECK(burst.audio <= kLead + kUneven.seconds() + kSlack);
    const Time due = burst.refused.askAgain;
    CHECK(due > kStart);
    CHECK(secondsBetween(kStart, due) == doctest::Approx(burst.audio - kLead).epsilon(1e-6));

    // Asking early again changes nothing.
    const auto early = pacer.ask(kUneven.frames, kUneven.sampleRate, kPlentyOfRoom, due - 1ms);
    CHECK_FALSE(early.release);
    CHECK(early.askAgain == due);
    CHECK_FALSE(pacer.ask(kUneven.frames, kUneven.sampleRate, kPlentyOfRoom, due - 1ns).release);

    CHECK(pacer.ask(kUneven.frames, kUneven.sampleRate, kPlentyOfRoom, due).release);
}

TEST_CASE("nothing is released while the ring has less room than the block") {
    constexpr Block kBlock{4096, 44100};
    Pacer pacer(kSessionLead);

    const double shortBy = 0.03;
    const auto tight =
        pacer.ask(kBlock.frames, kBlock.sampleRate, kBlock.seconds() - shortBy, kStart);
    CHECK_FALSE(tight.release);
    CHECK(tight.askAgain > kStart);
    CHECK(secondsBetween(kStart, tight.askAgain) <= shortBy + kSlack);

    const auto full = pacer.ask(kBlock.frames, kBlock.sampleRate, 0.0, kStart);
    CHECK_FALSE(full.release);
    CHECK(full.askAgain > kStart);

    CHECK(pacer.ask(kBlock.frames, kBlock.sampleRate, kBlock.seconds(), kStart).release);
}

// A refusal for room counted as a release would put the schedule a block ahead for every time
// the ring was full.
TEST_CASE("a block refused for want of room is not counted as released") {
    constexpr Block kBlock{4096, 44100};
    Pacer refusedFirst(kSessionLead);
    Pacer neverRefused(kSessionLead);

    for (int i = 0; i < 5; ++i)
        REQUIRE_FALSE(refusedFirst.ask(kBlock.frames, kBlock.sampleRate, 0.0, kStart).release);

    const auto after = burstAt(refusedFirst, kBlock, kStart);
    const auto plain = burstAt(neverRefused, kBlock, kStart);
    CHECK(after.audio == doctest::Approx(plain.audio));
    CHECK(after.refused.askAgain == plain.refused.askAgain);
}

TEST_CASE("asked a minute late, the pacer starts again from then and owes nothing") {
    Pacer pacer(kSessionLead);
    const auto run = decode(pacer, lasting(10, {kUneven}), kStart);
    REQUIRE(run.mostAsks <= 2);

    // A pause, nobody listening, or a stall: a minute passes before the decoder asks again.
    const Time back = run.now + 60s;
    const auto burst = burstAt(pacer, kUneven, back);

    CHECK(burst.audio <= kLead + kUneven.seconds() + kSlack);
    CHECK(burst.refused.askAgain > back);
    CHECK(secondsBetween(back, burst.refused.askAgain) ==
          doctest::Approx(burst.audio - kLead).epsilon(1e-6));
}

TEST_CASE("a stall shorter than the lead is made up, so the run keeps its first schedule") {
    Pacer pacer(kSessionLead);
    const auto before = decode(pacer, lasting(5, {kUneven}), kStart);
    REQUIRE(before.mostAsks <= 2);

    const Time late = before.now + 300ms;
    const auto burst = burstAt(pacer, kUneven, late);

    // What was owed for the 300 ms goes at once, and the audio stays a lead ahead of the clock
    // that started at the first ask.
    CHECK(std::abs(burst.audio - 0.3) <= kUneven.seconds());
    const double ahead = before.audio + burst.audio - secondsBetween(kStart, late);
    CHECK(ahead <= kLead + kUneven.seconds() + kSlack);
    CHECK(ahead >= kLead - kSlack);
}

TEST_CASE("a ring's room is its capacity less what it holds, rising again as blocks are read") {
    PcmRing ring(3.0);
    CHECK(ring.roomSeconds() == doctest::Approx(3.0));

    ring.write(silence({44100, 44100}));
    CHECK(ring.roomSeconds() == doctest::Approx(2.0));

    ring.write(silence({24000, 48000}));
    CHECK(ring.roomSeconds() == doctest::Approx(1.5));

    PcmBlock got;
    REQUIRE(ring.read(got));
    CHECK(ring.roomSeconds() == doctest::Approx(2.5));
    REQUIRE(ring.read(got));
    CHECK(ring.roomSeconds() == doctest::Approx(3.0));
}

TEST_CASE("a ring's room is never negative, even holding more than its capacity") {
    PcmRing small(0.25);
    small.write(silence({44100, 44100}));
    CHECK(small.roomSeconds() == 0.0);

    // A full ring still takes the write and drops its oldest block to make room.
    PcmRing full(2.5);
    for (int i = 0; i < 3; ++i)
        full.write(silence({44100, 44100}));
    CHECK(full.roomSeconds() == doctest::Approx(0.5));
}
