#include "third_party/doctest.h"

#include "core/timeline.h"

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
