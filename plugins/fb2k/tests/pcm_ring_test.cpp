#include "third_party/doctest.h"

#include "core/pcm_ring.h"
#include "support/eventually.h"

#include <atomic>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;

namespace {

constexpr AudioSpec kStereo{44100, 2};

PcmBlock blockOf(AudioSpec spec, size_t frames, float value) {
    PcmBlock block;
    block.spec = spec;
    block.samples.assign(frames * spec.channels, value);
    return block;
}

PcmBlock oneSecond(float value) {
    return blockOf(kStereo, kStereo.sampleRate, value);
}

std::vector<float> whatIsLeft(PcmRing& ring) {
    ring.close();

    std::vector<float> left;
    for (PcmBlock got; ring.read(got);)
        left.push_back(got.samples.front());
    return left;
}

}  // namespace

TEST_CASE("a block comes back out with its samples and its spec") {
    PcmRing ring(3.0);
    ring.write(blockOf(kStereo, 100, 0.5F));

    PcmBlock got;
    REQUIRE(ring.read(got));

    CHECK(got.spec == kStereo);
    CHECK(got.frames() == 100);
    CHECK(got.samples.size() == 200);
    CHECK(got.samples.front() == doctest::Approx(0.5F));
}

TEST_CASE("frames and seconds count instants, not samples") {
    const PcmBlock stereo = blockOf({48000, 2}, 24000, 0.F);
    CHECK(stereo.frames() == 24000);
    CHECK(stereo.seconds() == doctest::Approx(0.5));

    const PcmBlock surround = blockOf({48000, 6}, 24000, 0.F);
    CHECK(surround.samples.size() == 144000);
    CHECK(surround.seconds() == doctest::Approx(0.5));
}

TEST_CASE("blocks come out in the order they went in") {
    PcmRing ring(10.0);
    ring.write(blockOf(kStereo, 10, 1.F));
    ring.write(blockOf(kStereo, 10, 2.F));
    ring.write(blockOf(kStereo, 10, 3.F));

    PcmBlock got;
    REQUIRE(ring.read(got));
    CHECK(got.samples.front() == doctest::Approx(1.F));
    REQUIRE(ring.read(got));
    CHECK(got.samples.front() == doctest::Approx(2.F));
    REQUIRE(ring.read(got));
    CHECK(got.samples.front() == doctest::Approx(3.F));
}

TEST_CASE("a spec change is carried per block rather than smeared together") {
    PcmRing ring(10.0);
    ring.write(blockOf({44100, 2}, 100, 1.F));
    ring.write(blockOf({96000, 1}, 100, 2.F));

    PcmBlock got;
    REQUIRE(ring.read(got));
    CHECK(got.spec == AudioSpec{44100, 2});
    REQUIRE(ring.read(got));
    CHECK(got.spec == AudioSpec{96000, 1});
}

TEST_CASE("a mark travels with the block it belongs to, and with no other") {
    PcmRing ring(10.0);

    StreamMark mark;
    mark.path = R"(F:\Music\a.flac)";
    mark.subsong = 2;
    mark.position = 90.0;

    auto marked = blockOf(kStereo, 10, 1.F);
    marked.mark = mark;
    ring.write(std::move(marked));
    ring.write(blockOf(kStereo, 10, 2.F));

    PcmBlock got;
    REQUIRE(ring.read(got));
    REQUIRE(got.mark.has_value());

    // value_or rather than operator*: clang-tidy reads the REQUIRE above as nothing and calls
    // the dereference unchecked.
    const auto carried = got.mark.value_or(StreamMark{});
    CHECK(carried.path == R"(F:\Music\a.flac)");
    CHECK(carried.subsong == 2);
    CHECK(carried.position == doctest::Approx(90.0));

    REQUIRE(ring.read(got));
    CHECK_FALSE(got.mark.has_value());
}

TEST_CASE("a mark survives the ring dropping older audio") {
    PcmRing ring(2.5);
    ring.write(oneSecond(1.F));
    ring.write(oneSecond(2.F));

    auto marked = oneSecond(3.F);
    marked.mark = StreamMark{0, "x.mp3", 0, 0};
    ring.write(std::move(marked));

    PcmBlock got;
    REQUIRE(ring.read(got));
    CHECK_FALSE(got.mark.has_value());
    REQUIRE(ring.read(got));
    CHECK(got.mark.has_value());
}

TEST_CASE("an empty delivery costs nothing") {
    PcmRing ring(3.0);
    ring.write(PcmBlock{});
    ring.write(blockOf(kStereo, 0, 0.F));
    ring.close();

    PcmBlock got;
    CHECK_FALSE(ring.read(got));
}

TEST_CASE("a full ring drops the oldest audio, not the newest") {
    PcmRing ring(2.5);
    ring.write(oneSecond(1.F));
    ring.write(oneSecond(2.F));
    ring.write(oneSecond(3.F));

    CHECK(whatIsLeft(ring) == std::vector<float>{2.F, 3.F});
}

TEST_CASE("the ring stays inside its capacity however long the writer runs") {
    PcmRing ring(2.5);

    for (int i = 0; i < 100; ++i)
        ring.write(oneSecond(static_cast<float>(i)));

    CHECK(whatIsLeft(ring) == std::vector<float>{98.F, 99.F});
}

TEST_CASE("nothing is dropped while the reader keeps up") {
    PcmRing ring(2.5);

    PcmBlock got;
    for (int i = 0; i < 20; ++i) {
        ring.write(oneSecond(static_cast<float>(i)));
        REQUIRE(ring.read(got));
        CHECK(got.samples.front() == doctest::Approx(static_cast<float>(i)));
    }
}

TEST_CASE("a block longer than the whole capacity is kept rather than dropped") {
    PcmRing ring(0.25);
    ring.write(oneSecond(7.F));

    CHECK(whatIsLeft(ring) == std::vector<float>{7.F});
}

TEST_CASE("closing drains what was accepted before it refuses to read") {
    PcmRing ring(3.0);
    ring.write(blockOf(kStereo, 10, 1.F));
    ring.close();

    PcmBlock got;
    REQUIRE(ring.read(got));
    CHECK(got.samples.front() == doctest::Approx(1.F));
    CHECK_FALSE(ring.read(got));
}

TEST_CASE("a write after closing is ignored rather than queued forever") {
    PcmRing ring(3.0);
    ring.close();
    ring.write(blockOf(kStereo, 10, 1.F));

    PcmBlock got;
    CHECK_FALSE(ring.read(got));
}

TEST_CASE("closing wakes a reader that is waiting for audio") {
    PcmRing ring(3.0);

    std::atomic<bool> finished{false};
    bool result = true;

    std::thread reader([&] {
        PcmBlock got;
        result = ring.read(got);
        finished = true;
    });

    const bool waiting = eventually([&ring] { return ring.waitingReaders() == 1; });
    ring.close();
    joinOnceFinished(reader, finished, "a close");

    CHECK(waiting);
    CHECK_FALSE(result);
}

TEST_CASE("a reader waiting on an empty ring is woken by a write") {
    PcmRing ring(3.0);

    std::atomic<bool> finished{false};
    bool result = false;
    float first = 0.F;

    std::thread reader([&] {
        PcmBlock got;
        result = ring.read(got);
        if (result)
            first = got.samples.front();
        finished = true;
    });

    const bool waiting = eventually([&ring] { return ring.waitingReaders() == 1; });
    ring.write(blockOf(kStereo, 10, 9.F));
    joinOnceFinished(reader, finished, "a write");

    CHECK(waiting);
    CHECK(result);
    CHECK(first == doctest::Approx(9.F));
}
