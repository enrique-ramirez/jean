#include "third_party/doctest.h"

#include "core/player_state.h"

#include <chrono>
#include <cstdint>

using namespace jean;
using namespace std::chrono;

namespace {

constexpr steady_clock::time_point kMarkedAt{seconds(1000)};
constexpr double kReachedSeconds = 42.5;

// Playback runs on for this long after the mark before anybody touches the player, so a
// transition that reads the mark has something to add and a transition that ignores it reports
// kReachedSeconds instead.
constexpr seconds kRanOnFor{10};

PlayerState playing() {
    PlayerState state;
    state.playback = PlaybackState::playing;
    state.path = R"(X:\music\a.flac)";
    state.subsong = 0;
    state.position.seconds = kReachedSeconds;
    state.position.taken = kMarkedAt;
    state.duration = 210.0;
    state.volume = -6.0;
    state.muted = false;
    state.playbackMode = "repeatAll";
    return state;
}

PlayingTrack anotherTrack() {
    PlayingTrack track;
    track.path = R"(X:\music\b.flac)";
    track.subsong = 2;
    track.duration = 185.0;
    return track;
}

}  // namespace

TEST_CASE("a read gives back the state that was published") {
    PlayerStateStore store;
    store.publish(playing());

    const auto published = store.read();

    CHECK(published.state.playback == PlaybackState::playing);
    CHECK(published.state.path == R"(X:\music\a.flac)");
    CHECK(published.state.subsong == 0);
    CHECK(published.state.position.seconds == doctest::Approx(42.5));
    CHECK(published.state.position.taken == steady_clock::time_point{seconds(1000)});
    CHECK(published.state.duration == doctest::Approx(210.0));
    CHECK(published.state.volume == doctest::Approx(-6.0));
    CHECK_FALSE(published.state.muted);
    CHECK(published.state.playbackMode == "repeatAll");
}

TEST_CASE("publishing the same state twice leaves the version alone") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t once = store.read().version;

    store.publish(playing());
    store.publish(playing());

    CHECK(store.read().version == once);
}

TEST_CASE("changing any field a client can see advances the version") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    PlayerState changed = playing();

    SUBCASE("the player pauses") {
        changed.playback = PlaybackState::paused;
    }
    SUBCASE("another track starts") {
        changed.path = R"(X:\music\b.flac)";
    }
    SUBCASE("another subsong of the same file starts") {
        changed.subsong = 3;
    }
    SUBCASE("somebody seeks") {
        changed.position.seconds = 90.0;
    }
    SUBCASE("the track is a different length") {
        changed.duration = 185.0;
    }
    SUBCASE("the volume moves") {
        changed.volume = -12.0;
    }
    SUBCASE("the player is muted") {
        changed.muted = true;
    }
    SUBCASE("the playback order changes") {
        changed.playbackMode = "random";
    }

    store.publish(changed);

    CHECK(store.read().version > before);
}

TEST_CASE("the version never returns to one a client already holds") {
    PlayerStateStore store;
    PlayerState paused = playing();
    paused.playback = PlaybackState::paused;

    store.publish(playing());
    const uint64_t atFirst = store.read().version;
    store.publish(paused);
    store.publish(playing());

    CHECK(store.read().version > atFirst);
}

// The mark is thirty seconds old by the time it is read. A store that answered where playback
// would be now, rather than where it was when the mark was taken, would report a position that
// moved and a version that moved with it, which is every poll of an untouched player a 200.
TEST_CASE("a position mark keeps the moment it was taken, so an untouched player stays still") {
    PlayerStateStore store;
    PlayerState state = playing();
    state.position.seconds = 42.5;
    state.position.taken = steady_clock::now() - seconds(30);
    store.publish(state);

    const auto first = store.read();
    const auto second = store.read();

    CHECK(second.version == first.version);
    CHECK(second.state.position.seconds == doctest::Approx(42.5));
    CHECK(second.state.position.taken == state.position.taken);
}

// The case a person sees most, and the one an implementation reading any not-playing state as an
// empty player gets wrong. The trackbar holds its place, and the track and the duration it is
// drawn against hold with it.
TEST_CASE("a pause keeps the track, its duration and where playback had reached") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    store.paused(kMarkedAt + kRanOnFor);

    const auto published = store.read();
    CHECK(published.state.playback == PlaybackState::paused);
    CHECK(published.state.path == R"(X:\music\a.flac)");
    CHECK(published.state.subsong == 0);
    CHECK(published.state.duration == doctest::Approx(210.0));
    CHECK(published.state.position.seconds ==
          doctest::Approx(kReachedSeconds + kRanOnFor.count()));
    CHECK(published.version > before);
}

// What the poll publishes is a position and how old its mark is, and the client adds the age
// back on. So a resume that leaves the mark where the pause found it hands back a trackbar that
// has spent the whole pause, however long somebody left the player sitting.
TEST_CASE("a resume carries the position through the pause rather than through the clock") {
    PlayerStateStore store;
    store.publish(playing());
    store.paused(kMarkedAt + kRanOnFor);
    const uint64_t whilePaused = store.read().version;

    const auto resumedAt = kMarkedAt + minutes(5);
    store.resumed(resumedAt);

    const auto published = store.read();
    CHECK(published.state.playback == PlaybackState::playing);
    CHECK(published.state.path == R"(X:\music\a.flac)");
    CHECK(published.state.position.seconds ==
          doctest::Approx(kReachedSeconds + kRanOnFor.count()));
    CHECK(published.state.position.taken == resumedAt);
    CHECK(published.version > whilePaused);
}

// foobar2000's volume is dB against full scale, so 0 is the loudest the player goes rather than
// silence. A stop that publishes a default-constructed state clears what it should and throws the
// fader to the top on the way past.
TEST_CASE("a stop clears the track, its duration and its position, and leaves the volume alone") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    store.stopped();

    const auto published = store.read();
    CHECK(published.state.playback == PlaybackState::stopped);
    CHECK(published.state.path.empty());
    CHECK(published.state.subsong == 0);
    CHECK(published.state.duration == doctest::Approx(0.0));
    CHECK(published.state.position.seconds == doctest::Approx(0.0));
    CHECK(published.state.volume == doctest::Approx(-6.0));
    CHECK(published.state.playbackMode == "repeatAll");
    CHECK(published.version > before);
}

TEST_CASE("a track started after a stop is published in full") {
    PlayerStateStore store;
    store.publish(playing());
    store.stopped();
    const uint64_t whileStopped = store.read().version;

    const auto startedAt = kMarkedAt + minutes(1);
    store.started(anotherTrack(), startedAt);

    const auto published = store.read();
    CHECK(published.state.playback == PlaybackState::playing);
    CHECK(published.state.path == R"(X:\music\b.flac)");
    CHECK(published.state.subsong == 2);
    CHECK(published.state.duration == doctest::Approx(185.0));
    CHECK(published.state.position.seconds == doctest::Approx(0.0));
    CHECK(published.state.position.taken == startedAt);
    CHECK(published.version > whileStopped);
}
