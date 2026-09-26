#include "third_party/doctest.h"

#include "core/timeline.h"

#include <atomic>
#include <string>
#include <thread>
#include <vector>

using namespace jean;

namespace {

StreamMark markAt(double at, const std::string& path) {
    StreamMark mark;
    mark.at = at;
    mark.path = path;
    return mark;
}

}  // namespace

TEST_CASE("the stream clock is what was last encoded") {
    Timeline timeline(8);
    CHECK(timeline.streamTime() == doctest::Approx(0.0));

    timeline.setStreamTime(12.5);
    CHECK(timeline.streamTime() == doctest::Approx(12.5));
}

TEST_CASE("marks come back in the order they were made") {
    Timeline timeline(8);
    timeline.mark(markAt(1.0, "a.mp3"));
    timeline.mark(markAt(2.0, "b.mp3"));

    const auto marks = timeline.marks();
    REQUIRE(marks.size() == 2);
    CHECK(marks[0].path == "a.mp3");
    CHECK(marks[1].path == "b.mp3");
}

TEST_CASE("only the most recent marks are kept, so a day-long stream stays bounded") {
    Timeline timeline(3);
    for (int i = 0; i < 20; ++i)
        timeline.mark(markAt(i, "track-" + std::to_string(i)));

    const auto marks = timeline.marks();
    REQUIRE(marks.size() == 3);
    CHECK(marks.front().path == "track-17");
    CHECK(marks.back().path == "track-19");
}

TEST_CASE("a mark carries where the player was, not only which track") {
    Timeline timeline(8);

    StreamMark mark;
    mark.at = 100.0;
    mark.path = "x.flac";
    mark.subsong = 3;
    mark.position = 12.25;
    timeline.mark(mark);

    const auto marks = timeline.marks();
    REQUIRE(marks.size() == 1);
    CHECK(marks[0].at == doctest::Approx(100.0));
    CHECK(marks[0].subsong == 3);
    CHECK(marks[0].position == doctest::Approx(12.25));
}

// GET /api/state announces a mark through this callback, and a client that sees the announcement
// reads GET /api/stream/timeline straight after. Called before the mark is readable, the client
// reads the timeline without it and waits for the next announcement, which may be a track away.
TEST_CASE("whoever is told of a mark can already read it") {
    std::vector<StreamMark> seen;
    int told = 0;
    Timeline timeline(8, [&timeline, &seen, &told] {
        told++;
        seen = timeline.marks();
    });

    timeline.mark(markAt(1.0, "a.mp3"));
    REQUIRE(told == 1);
    REQUIRE(seen.size() == 1);
    CHECK(seen.back().path == "a.mp3");

    timeline.mark(markAt(2.0, "b.mp3"));
    REQUIRE(told == 2);
    REQUIRE(seen.size() == 2);
    CHECK(seen.back().path == "b.mp3");
}

TEST_CASE("the stream clock moving is not a mark, and nobody is told of it") {
    int told = 0;
    Timeline timeline(8, [&told] { told++; });

    timeline.setStreamTime(12.5);
    timeline.setStreamTime(13.0);

    CHECK(told == 0);
}

TEST_CASE("marks made on the encoder thread while others read are each announced once") {
    constexpr int kMarks = 200;

    std::atomic<int> told{0};
    Timeline timeline(4, [&told] { told++; });

    std::thread encoder([&timeline] {
        for (int i = 0; i < kMarks; ++i)
            timeline.mark(markAt(i, "track-" + std::to_string(i)));
    });

    for (int read = 0; read < kMarks; ++read)
        static_cast<void>(timeline.marks());

    encoder.join();

    CHECK(told == kMarks);
    CHECK(timeline.marks().back().path == "track-" + std::to_string(kMarks - 1));
}
