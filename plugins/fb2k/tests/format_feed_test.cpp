#include "third_party/doctest.h"

#include "core/format_feed.h"
#include "support/counting_encoder.h"
#include "support/eventually.h"
#include "support/log_capture.h"

#include <atomic>
#include <charconv>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;

namespace {

constexpr size_t kRingBytes = size_t{64} * 1024;

constexpr auto kBriefly = 30ms;

constexpr auto kPatience = 30s;
static_assert(kPatience > kWatchdog);

std::string headers() {
    return "headers|";
}

std::vector<std::uint8_t> bytes(const std::string& text) {
    return std::vector<std::uint8_t>(text.begin(), text.end());
}

std::unique_ptr<FormatFeed> feedOf(CountingEncoder& encoder, const std::string& preamble = {},
                                   std::chrono::milliseconds idlePatience = kBriefly,
                                   size_t ringBytes = kRingBytes) {
    return std::make_unique<FormatFeed>("opus", "audio/ogg", ringBytes, idlePatience, encoder,
                                        bytes(preamble));
}

void play(FormatFeed& feed, int id) {
    const auto block = blockOf(id);
    feed.feed(block.data(), kBlockFrames);
}

struct Read {
    bool more = false;
    std::string bytes;
};

Read readOnce(StreamListener& listener) {
    std::vector<std::uint8_t> out;
    Read read;
    read.more = listener.next(out);
    read.bytes.assign(out.begin(), out.end());
    return read;
}

struct Heard {
    std::string bytes;
    bool ended = false;
};

Heard toTheEnd(StreamListener& listener) {
    Heard heard;
    for (int empties = 0; empties < 2;) {
        const Read read = readOnce(listener);
        if (!read.more) {
            heard.ended = true;
            return heard;
        }

        heard.bytes += read.bytes;
        if (read.bytes.empty())
            ++empties;
    }
    return heard;
}

int firstBlockIn(const std::string& heard) {
    int id = -1;
    if (heard.size() >= 2)
        std::from_chars(heard.data() + 1, heard.data() + heard.size(), id);
    return id;
}

void playEach(FormatFeed& feed, const std::vector<int>& ids) {
    for (const int id : ids)
        play(feed, id);
}

CountingEncoderOptions holdingTwoBlocks() {
    return {.heldBlocks = 2, .startFailure = {}};
}

using WritesBefore = std::vector<size_t>;

WritesBefore dropsOnceWritten(const CountingEncoder& encoder) {
    WritesBefore drops = encoder.writesBeforeEachDrop();
    std::erase(drops, size_t{0});
    return drops;
}

}  // namespace

TEST_CASE("a listener is sent the preamble first, then only what was written after it joined") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers());

    const auto early = feed->listen();
    play(*feed, 1);
    play(*feed, 2);

    const auto late = feed->listen();
    play(*feed, 3);
    play(*feed, 4);
    feed->close();

    const Heard earlyHeard = toTheEnd(*early);
    const Heard lateHeard = toTheEnd(*late);

    CHECK(earlyHeard.bytes == headers() + "o1;o2;o3;o4;");
    CHECK(lateHeard.bytes == headers() + "o3;o4;");
    CHECK(earlyHeard.ended);
    CHECK(lateHeard.ended);
}

TEST_CASE("the preamble comes alone, ahead of audio that is already waiting") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers());

    const auto listener = feed->listen();
    play(*feed, 1);

    const Read first = readOnce(*listener);
    const Read second = readOnce(*listener);

    CHECK(first.more);
    CHECK(first.bytes == headers());
    CHECK(second.more);
    CHECK(second.bytes == "o1;");
}

// The stream route takes an empty first answer as a chance to see that the client is still there.
TEST_CASE("a format with no preamble answers its listener's first read with nothing, then audio") {
    CountingEncoder encoder('a');
    const auto feed = feedOf(encoder);

    const auto listener = feed->listen();
    play(*feed, 1);

    const Read first = readOnce(*listener);
    const Read second = readOnce(*listener);

    CHECK(first.more);
    CHECK(first.bytes.empty());
    CHECK(second.more);
    CHECK(second.bytes == "a1;");
}

TEST_CASE("a format nobody is listening to is never encoded, and is from its first listener on") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers());

    play(*feed, 1);
    play(*feed, 2);

    CHECK_FALSE(feed->hasListeners());
    CHECK(encoder.writes() == 0);

    const auto listener = feed->listen();
    CHECK(feed->hasListeners());

    play(*feed, 3);
    feed->close();

    CHECK(encoder.writes() == 1);
    CHECK(encoder.frames() == kBlockFrames);
    CHECK(toTheEnd(*listener).bytes == headers() + "o3;");
}

TEST_CASE("two listeners of one format read the same bytes") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers());

    const auto one = feed->listen();
    const auto two = feed->listen();

    play(*feed, 1);
    play(*feed, 2);
    feed->close();

    CHECK(toTheEnd(*one).bytes == headers() + "o1;o2;");
    CHECK(toTheEnd(*two).bytes == headers() + "o1;o2;");
    CHECK(encoder.writes() == 2);
}

TEST_CASE("a listener that leaves stops counting, and the last one to leave stops the encoding") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder);

    auto one = feed->listen();
    auto two = feed->listen();
    play(*feed, 1);

    one.reset();
    play(*feed, 2);

    CHECK(feed->hasListeners());
    CHECK(encoder.writes() == 2);

    two.reset();
    play(*feed, 3);

    CHECK_FALSE(feed->hasListeners());
    CHECK(encoder.writes() == 2);
}

TEST_CASE("what an encoder holds back is sent when the encoder lets it go, and not before") {
    CountingEncoder encoder('a', {.heldBlocks = 2, .startFailure = {}});
    const auto feed = feedOf(encoder);

    const auto listener = feed->listen();
    play(*feed, 1);
    play(*feed, 2);
    play(*feed, 3);
    play(*feed, 4);
    feed->close();

    CHECK(encoder.writes() == 4);
    CHECK(toTheEnd(*listener).bytes == "a1;a2;");
}

TEST_CASE("an encoder that fails ends its own listeners and leaves the other format's reading") {
    const std::string reason = "the codec gave up, case 5417";

    CountingEncoder opus('o');
    CountingEncoder aac('a');
    aac.failOnWrite(2, reason);

    FormatFeed ogg("opus", "audio/ogg", kRingBytes, kBriefly, opus, bytes(headers()));
    FormatFeed adts("aac", "audio/aac", kRingBytes, kBriefly, aac);

    const auto oggListener = ogg.listen();
    const auto adtsListener = adts.listen();

    for (const int id : {1, 2, 3, 4}) {
        play(ogg, id);
        play(adts, id);
    }

    CHECK_FALSE(adts.working());
    CHECK(ogg.working());

    CHECK(aac.writes() == 2);
    CHECK(opus.writes() == 4);

    const Heard adtsHeard = toTheEnd(*adtsListener);
    CHECK(adtsHeard.bytes == "a1;");
    CHECK(adtsHeard.ended);

    CHECK(readOnce(*oggListener).bytes == headers());
    CHECK(readOnce(*oggListener).bytes == "o1;o2;o3;o4;");

    play(ogg, 5);
    const Read after = readOnce(*oggListener);
    CHECK(after.more);
    CHECK(after.bytes == "o5;");

    CHECK(errorLinesContaining("aac streaming stopped: " + reason) == 1);
    CHECK(errorLinesContaining("opus streaming stopped") == 0);
}

TEST_CASE("what an encoder wrote in the block it failed on is sent before its listeners end") {
    CountingEncoder encoder('o');
    encoder.failOnWrite(2, "the codec gave up, case 7733", "last;");
    const auto feed = feedOf(encoder, headers());

    const auto listener = feed->listen();
    play(*feed, 1);
    play(*feed, 2);

    const Heard heard = toTheEnd(*listener);
    CHECK(heard.bytes == headers() + "o1;last;");
    CHECK(heard.ended);
}

TEST_CASE("a format whose encoder has failed sends a new listener its preamble and then the end") {
    CountingEncoder encoder('o');
    encoder.failOnWrite(1, "the codec gave up, case 6120");
    const auto feed = feedOf(encoder, headers());

    {
        const auto present = feed->listen();
        play(*feed, 1);
    }

    const auto late = feed->listen();
    const Heard heard = toTheEnd(*late);

    CHECK(heard.bytes == headers());
    CHECK(heard.ended);
}

TEST_CASE("a format says whether its encoder started") {
    CountingEncoder started('o');
    CountingEncoder never('a', {.startFailure = "no AAC encoder on this machine"});

    CHECK(feedOf(started)->working());
    CHECK_FALSE(feedOf(never)->working());
}

TEST_CASE("a format says what it is called and what its bytes are") {
    CountingEncoder encoder('a');
    const FormatFeed feed("aac", "audio/aac", kRingBytes, kBriefly, encoder);

    CHECK(feed.name() == "aac");
    CHECK(feed.contentType() == "audio/aac");
}

TEST_CASE("closing a format ends each listener once it has read what was already written") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers());

    const auto one = feed->listen();
    const auto two = feed->listen();
    play(*feed, 1);
    feed->close();
    play(*feed, 2);

    for (StreamListener* listener : {one.get(), two.get()}) {
        const Heard heard = toTheEnd(*listener);
        CHECK(heard.bytes == headers() + "o1;");
        CHECK(heard.ended);
    }
}

TEST_CASE("closing a format ends a listener waiting for audio on another thread") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers(), kPatience);
    const auto listener = feed->listen();

    std::atomic<bool> waiting{false};
    std::atomic<bool> finished{false};
    Heard heard;
    std::thread reader([&] {
        heard.bytes = readOnce(*listener).bytes;
        waiting = true;
        heard.ended = !readOnce(*listener).more;
        finished = true;
    });

    const bool reached = eventually([&waiting] { return waiting.load(); });
    feed->close();
    joinOnceFinished(reader, finished, "a format to close");

    CHECK(reached);
    CHECK(heard.bytes == headers());
    CHECK(heard.ended);
}

TEST_CASE("a listener of a format nothing is written to is handed back with nothing, not ended") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers(), kBriefly);
    const auto listener = feed->listen();

    CHECK(readOnce(*listener).bytes == headers());

    const Read idle = readOnce(*listener);
    CHECK(idle.more);
    CHECK(idle.bytes.empty());

    play(*feed, 1);
    const Read later = readOnce(*listener);
    CHECK(later.more);
    CHECK(later.bytes == "o1;");
}

TEST_CASE("a listener that falls further behind than the format keeps is ended, not waited for") {
    constexpr size_t kTwoBlocks = 6;

    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers(), kBriefly, kTwoBlocks);

    const auto slow = feed->listen();
    play(*feed, 1);
    play(*feed, 2);
    play(*feed, 3);

    const auto keepingUp = feed->listen();
    play(*feed, 4);

    CHECK(readOnce(*slow).bytes == headers());
    CHECK_FALSE(readOnce(*slow).more);

    CHECK(readOnce(*keepingUp).bytes == headers());
    CHECK(readOnce(*keepingUp).bytes == "o4;");
}

TEST_CASE("a listener keeps its owner alive, and lets go of it when it goes") {
    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder);

    auto owner = std::make_shared<int>(0);
    const std::weak_ptr<int> watching = owner;

    auto listener = feed->listen(owner);
    owner.reset();
    CHECK_FALSE(watching.expired());

    listener.reset();
    CHECK(watching.expired());
}

TEST_CASE("a format whose encoder fails on the feeding thread says so to a thread that asks") {
    // ThreadSanitizer on macOS sees an answer that is not safe to ask for in some runs of this
    // and not in others, and in none where the asking loop reads a clock, so the run is repeated
    // and the loop holds nothing but the question and the feeding thread's own flag.
    constexpr int kRounds = 30;
    constexpr int kBlocks = 50;
    constexpr size_t kFailsOn = kBlocks;

    for (int round = 0; round < kRounds; ++round) {
        CountingEncoder encoder('o');
        encoder.failOnWrite(kFailsOn, "the codec gave up, case 8846");
        const auto feed = feedOf(encoder, headers(), kPatience);
        const auto listener = feed->listen();

        std::atomic<bool> finished{false};
        std::thread feeder([&] {
            for (int id = 0; id < kBlocks; ++id)
                play(*feed, id);
            finished = true;
        });

        while (feed->working() && !finished)
            std::this_thread::yield();

        joinOnceFinished(feeder, finished, "the feeding thread to finish");

        CHECK_FALSE(feed->working());
        CHECK(encoder.writes() == kFailsOn);
    }
}

TEST_CASE("listeners coming and going beside the feeding thread each start at the live edge") {
    constexpr int kVisits = 200;

    constexpr int kMostBlocks = 100000;
    constexpr size_t kWholeRun = size_t{kMostBlocks} * 8;

    CountingEncoder encoder('o');
    const auto feed = feedOf(encoder, headers(), kPatience, kWholeRun);
    const auto resident = feed->listen();

    std::atomic<size_t> residentHeard{0};
    std::atomic<bool> residentFinished{false};
    std::string residentBytes;
    std::thread residentReader([&] {
        for (Read read = readOnce(*resident); read.more; read = readOnce(*resident)) {
            residentBytes += read.bytes;
            residentHeard = residentBytes.size();
        }
        residentFinished = true;
    });

    std::atomic<int> begun{0};
    std::atomic<int> fed{0};
    std::atomic<bool> stop{false};
    std::atomic<bool> stalled{false};
    std::atomic<bool> feederFinished{false};
    std::string everything;
    std::thread feeder([&] {
        for (int id = 0; id < kMostBlocks && !stop; ++id) {
            begun = id + 1;
            play(*feed, id);
            fed = id + 1;

            everything += encoder.bytesOf(id);
            const size_t owed = headers().size() + everything.size();
            const auto deadline = std::chrono::steady_clock::now() + kWatchdog;
            while (residentHeard < owed && !stalled) {
                if (std::chrono::steady_clock::now() >= deadline)
                    stalled = true;
                std::this_thread::yield();
            }
            if (stalled)
                break;
        }
        feed->close();
        feederFinished = true;
    });

    std::atomic<int> answers{0};
    std::atomic<bool> saidOtherwise{false};
    std::atomic<bool> askerFinished{false};
    std::thread asker([&] {
        while (!stop) {
            if (!feed->working() || !feed->hasListeners())
                saidOtherwise = true;
            ++answers;
        }
        askerFinished = true;
    });

    struct Visit {
        int fedBefore = 0;
        int begunAfter = 0;
        std::string preamble;
        std::string audio;
    };

    std::vector<Visit> visits(kVisits);
    for (Visit& visit : visits) {
        visit.fedBefore = fed;
        const auto visitor = feed->listen();
        visit.begunAfter = begun;

        visit.preamble = readOnce(*visitor).bytes;
        visit.audio = readOnce(*visitor).bytes;
    }

    const bool asked = eventually([&answers] { return answers > 0; });
    stop = true;
    joinOnceFinished(asker, askerFinished, "the last answer");
    joinOnceFinished(feeder, feederFinished, "the feeding thread to stop");
    joinOnceFinished(residentReader, residentFinished, "the format to close");

    REQUIRE_FALSE(stalled);
    REQUIRE(fed < kMostBlocks);

    CHECK(residentBytes == headers() + everything);
    CHECK(encoder.writes() == static_cast<size_t>(fed.load()));
    CHECK(asked);
    CHECK_FALSE(saidOtherwise);

    for (const Visit& visit : visits) {
        CAPTURE(visit.audio);
        CHECK(visit.preamble == headers());

        REQUIRE(visit.audio.size() >= 2);
        CHECK(firstBlockIn(visit.audio) >= visit.fedBefore);
        CHECK(firstBlockIn(visit.audio) <= visit.begunAfter);
        CHECK(everything.find(visit.audio) != std::string::npos);
    }
}

TEST_CASE(
    "a listener joining a format that audio passed unheard is sent, after the preamble, only "
    "blocks fed after it joined") {
    CountingEncoder encoder('o', holdingTwoBlocks());
    const auto feed = feedOf(encoder, headers());

    auto earlier = feed->listen();
    playEach(*feed, {1, 2, 3, 4});
    CHECK(readOnce(*earlier).bytes == headers());
    CHECK(readOnce(*earlier).bytes == "o1;o2;");
    earlier.reset();

    playEach(*feed, {5, 6});

    const auto later = feed->listen();
    playEach(*feed, {7, 8, 9, 10});
    feed->close();

    CHECK(toTheEnd(*later).bytes == headers() + "o7;o8;");
}

TEST_CASE(
    "a listener joining a format its last listener left, with no block fed in between, is sent "
    "only blocks fed after it joined") {
    CountingEncoder encoder('o', holdingTwoBlocks());
    const auto feed = feedOf(encoder, headers());

    auto earlier = feed->listen();
    playEach(*feed, {1, 2, 3, 4});
    earlier.reset();

    const auto later = feed->listen();
    playEach(*feed, {5, 6, 7, 8});
    feed->close();

    CHECK(toTheEnd(*later).bytes == headers() + "o5;o6;");
}

TEST_CASE(
    "a format unheard while the other plays on starts its next listener from later blocks, and "
    "the other's bytes are what they are with no second format") {
    const std::vector<int> heardByBoth = {1, 2, 3, 4};
    const std::vector<int> heardByOne = {5, 6};
    const std::vector<int> heardByBothAgain = {7, 8, 9, 10};

    CountingEncoder alone('o', holdingTwoBlocks());
    const auto oggAlone = feedOf(alone, headers());
    const auto aloneListener = oggAlone->listen();
    playEach(*oggAlone, heardByBoth);
    playEach(*oggAlone, heardByOne);
    playEach(*oggAlone, heardByBothAgain);
    oggAlone->close();
    const std::string aloneHeard = toTheEnd(*aloneListener).bytes;
    REQUIRE(aloneHeard == headers() + "o1;o2;o3;o4;o5;o6;o7;o8;");

    CountingEncoder opus('o', holdingTwoBlocks());
    CountingEncoder aac('a', holdingTwoBlocks());
    FormatFeed ogg("opus", "audio/ogg", kRingBytes, kBriefly, opus, bytes(headers()));
    FormatFeed adts("aac", "audio/aac", kRingBytes, kBriefly, aac);

    const auto oggListener = ogg.listen();
    auto adtsEarlier = adts.listen();
    for (const int id : heardByBoth) {
        play(ogg, id);
        play(adts, id);
    }
    adtsEarlier.reset();

    for (const int id : heardByOne) {
        play(ogg, id);
        play(adts, id);
    }

    const auto adtsLater = adts.listen();
    for (const int id : heardByBothAgain) {
        play(ogg, id);
        play(adts, id);
    }
    ogg.close();
    adts.close();

    CHECK(toTheEnd(*oggListener).bytes == aloneHeard);
    CHECK(dropsOnceWritten(opus).empty());
    CHECK(opus.writes() == 10);

    CHECK(toTheEnd(*adtsLater).bytes == "a7;a8;");
    CHECK(aac.writes() == 8);
}

TEST_CASE(
    "a second listener joining a format somebody is hearing changes nothing for the first, "
    "and neither does one of the two leaving") {
    CountingEncoder encoder('o', holdingTwoBlocks());
    const auto feed = feedOf(encoder, headers());

    const auto resident = feed->listen();
    playEach(*feed, {1, 2, 3, 4});

    auto visitor = feed->listen();
    playEach(*feed, {5, 6});
    CHECK(readOnce(*visitor).bytes == headers());
    CHECK(readOnce(*visitor).bytes == "o3;o4;");
    visitor.reset();

    playEach(*feed, {7, 8});
    feed->close();

    CHECK(toTheEnd(*resident).bytes == headers() + "o1;o2;o3;o4;o5;o6;");
    CHECK(dropsOnceWritten(encoder).empty());
}

TEST_CASE(
    "an encoder is told to drop once for each stretch its format went unheard, before the "
    "first block encoded after it and before no other") {
    CountingEncoder encoder('o', holdingTwoBlocks());
    const auto feed = feedOf(encoder, headers());

    auto first = feed->listen();
    playEach(*feed, {1, 2, 3, 4});
    first.reset();

    playEach(*feed, {5, 6});

    auto second = feed->listen();
    playEach(*feed, {7, 8, 9, 10});
    CHECK(readOnce(*second).bytes == headers());
    CHECK(readOnce(*second).bytes == "o7;o8;");
    second.reset();

    const auto third = feed->listen();
    playEach(*feed, {11, 12, 13, 14});

    const auto fourth = feed->listen();
    playEach(*feed, {15, 16});
    feed->close();

    CHECK(dropsOnceWritten(encoder) == WritesBefore{4, 8});
    CHECK(encoder.writes() == 14);
    CHECK(toTheEnd(*third).bytes == headers() + "o11;o12;o13;o14;");
    CHECK(toTheEnd(*fourth).bytes == headers() + "o13;o14;");
}

TEST_CASE(
    "a format a block passed by tells its encoder to drop before the next block it encodes, "
    "though no listener ever left it") {
    CountingEncoder encoder('o', holdingTwoBlocks());
    const auto feed = feedOf(encoder, headers());

    playEach(*feed, {1, 2});
    CHECK(encoder.writesBeforeEachDrop().empty());

    const auto listener = feed->listen();
    playEach(*feed, {3, 4, 5});
    feed->close();

    CHECK(encoder.writesBeforeEachDrop() == WritesBefore{0});
    CHECK(toTheEnd(*listener).bytes == headers() + "o3;");
}

TEST_CASE("a format whose encoder has failed, or never started, does not tell it to drop") {
    SUBCASE("failed on a block") {
        CountingEncoder encoder('o', holdingTwoBlocks());
        encoder.failOnWrite(3, "the codec gave up, case 2291");
        const auto feed = feedOf(encoder, headers());

        auto earlier = feed->listen();
        playEach(*feed, {1, 2, 3});
        REQUIRE_FALSE(feed->working());
        earlier.reset();

        playEach(*feed, {4, 5});

        const auto later = feed->listen();
        playEach(*feed, {6, 7});

        CHECK(dropsOnceWritten(encoder).empty());
        CHECK(encoder.writes() == 3);
    }

    SUBCASE("never started") {
        CountingEncoder encoder('a', {.startFailure = "no AAC encoder on this machine"});
        const auto feed = feedOf(encoder);

        playEach(*feed, {1, 2});

        auto earlier = feed->listen();
        playEach(*feed, {3, 4});
        earlier.reset();

        const auto later = feed->listen();
        playEach(*feed, {5, 6});

        CHECK(encoder.writesBeforeEachDrop().empty());
        CHECK(encoder.writes() == 0);
    }
}

TEST_CASE(
    "listeners visiting a format nobody else is hearing, beside the feeding thread, are each "
    "sent first a block fed after they joined") {
    constexpr int kVisits = 200;
    constexpr int kBlocksAStep = 12;

    CountingEncoder encoder('o', holdingTwoBlocks());
    const auto feed = feedOf(encoder, headers());

    std::atomic<int> allowed{0};
    std::atomic<int> begun{0};
    std::atomic<int> fed{0};
    std::atomic<bool> stop{false};
    std::atomic<bool> feederFinished{false};
    std::thread feeder([&] {
        for (int id = 0; !stop;) {
            if (id >= allowed) {
                std::this_thread::yield();
                continue;
            }

            begun = id + 1;
            play(*feed, id);
            fed = ++id;
        }
        feederFinished = true;
    });

    const auto feederHasCaughtUp = [&] { return fed >= allowed; };

    struct Visit {
        int fedBefore = 0;
        int begunAfter = 0;
        std::string preamble;
        std::string audio;
        bool feederCaughtUp = false;
    };

    std::vector<Visit> visits(kVisits);
    for (Visit& visit : visits) {
        visit.fedBefore = fed;
        allowed += kBlocksAStep;
        auto visitor = feed->listen();
        visit.begunAfter = begun;

        visit.preamble = readOnce(*visitor).bytes;
        for (bool waiting = true; waiting;) {
            const bool nothingMoreIsComing = feederHasCaughtUp();
            const Read read = readOnce(*visitor);
            visit.audio = read.bytes;
            waiting = read.more && read.bytes.empty() && !nothingMoreIsComing;
        }

        allowed += kBlocksAStep;
        visitor.reset();

        const auto deadline = std::chrono::steady_clock::now() + kWatchdog;
        while (!feederHasCaughtUp() && std::chrono::steady_clock::now() < deadline)
            std::this_thread::yield();
        visit.feederCaughtUp = feederHasCaughtUp();
        if (!visit.feederCaughtUp)
            break;
    }

    stop = true;
    joinOnceFinished(feeder, feederFinished, "the feeding thread to stop");

    for (const Visit& visit : visits) {
        CAPTURE(visit.audio);
        CAPTURE(visit.fedBefore);
        CAPTURE(visit.begunAfter);
        REQUIRE(visit.feederCaughtUp);
        CHECK(visit.preamble == headers());

        REQUIRE(visit.audio.size() >= 2);
        CHECK(firstBlockIn(visit.audio) >= visit.fedBefore);
        CHECK(firstBlockIn(visit.audio) <= visit.begunAfter);
    }
}
