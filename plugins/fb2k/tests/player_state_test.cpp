#include "third_party/doctest.h"

#include "core/player_state.h"

#include <chrono>
#include <cstdint>
#include <optional>

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

constexpr char kPlayingPlaylist[] = "45837d74-fa4f-415c-bba9-bf2db8f0dc04";
constexpr uint32_t kPlayingRow = 7;
constexpr int kEditsInABurst = 50;
constexpr char kTitle[] = "Cirrus Minor";
constexpr char kArtist[] = "Pink Floyd";
constexpr char kSingleSpace[] = " ";

PlayerState playingFrom(uint32_t row) {
    PlayerState state = playing();
    state.playingLocation = PlayingLocation{kPlayingPlaylist, row};
    return state;
}

PlayerState namedAndPlaced() {
    PlayerState state = playingFrom(kPlayingRow);
    state.title = kTitle;
    state.artist = kArtist;
    return state;
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

// A seek moves the mark to where the player jumped to and to when it jumped, and touches
// nothing else the track was carrying.
TEST_CASE("a seek moves the position mark and leaves the rest of the track alone") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    const auto seekedAt = kMarkedAt + kRanOnFor;
    store.seeked(90.0, seekedAt);

    const auto published = store.read();
    CHECK(published.state.playback == PlaybackState::playing);
    CHECK(published.state.path == R"(X:\music\a.flac)");
    CHECK(published.state.duration == doctest::Approx(210.0));
    CHECK(published.state.position.seconds == doctest::Approx(90.0));
    CHECK(published.state.position.taken == seekedAt);
    CHECK(published.version > before);
}

// The hold's mute and the user's own look identical to the store, since neither carries which
// one asked; volumeChanged takes both because that distinction is `fb2k/`'s to make, not the
// store's.
TEST_CASE("a volume change moves the volume and the mute together") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    store.volumeChanged(-12.0, true);

    const auto published = store.read();
    CHECK(published.state.volume == doctest::Approx(-12.0));
    CHECK(published.state.muted);
    CHECK(published.version > before);
}

// A dynamic-info duration is the one field foobar2000 revises mid-track, for a stream whose
// length was not known when it started.
TEST_CASE("a duration change leaves the track and its position alone") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    store.durationChanged(185.0);

    const auto published = store.read();
    CHECK(published.state.path == R"(X:\music\a.flac)");
    CHECK(published.state.duration == doctest::Approx(185.0));
    CHECK(published.state.position.seconds == doctest::Approx(kReachedSeconds));
    CHECK(published.version > before);
}

TEST_CASE("a playback mode change reaches a client, and an order with no Jean name clears it") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    store.playbackModeChanged("random");
    CHECK(store.read().state.playbackMode == "random");

    const uint64_t withRandom = store.read().version;
    CHECK(withRandom > before);

    store.playbackModeChanged(std::nullopt);

    const auto published = store.read();
    CHECK_FALSE(published.state.playbackMode.has_value());
    CHECK(published.version > withRandom);
}

// foobar2000 fires the playlist item callbacks for an edit anywhere in the playlist, once per
// operation rather than once per row, so appending below the playing track hands the store the
// location it is already holding. A location carrying anything that moves on its own, a sequence
// number or the moment it was read, makes each of those a new state and each poll a fresh body.
TEST_CASE("a burst of edits that leaves the playing row where it is leaves the version alone") {
    PlayerStateStore store;
    store.publish(playingFrom(kPlayingRow));
    const uint64_t before = store.read().version;

    for (int edit = 0; edit < kEditsInABurst; ++edit)
        store.playingLocationChanged(PlayingLocation{kPlayingPlaylist, kPlayingRow});

    CHECK(store.read().version == before);
}

TEST_CASE("an edit that moves the playing row advances the version once") {
    PlayerStateStore store;
    store.publish(playingFrom(kPlayingRow));
    const uint64_t before = store.read().version;

    store.playingLocationChanged(PlayingLocation{kPlayingPlaylist, kPlayingRow - 1});
    const uint64_t afterTheMove = store.read().version;

    for (int edit = 0; edit < kEditsInABurst; ++edit)
        store.playingLocationChanged(PlayingLocation{kPlayingPlaylist, kPlayingRow - 1});

    CHECK(afterTheMove > before);
    CHECK(store.read().version == afterTheMove);
    CHECK(store.read().state.playingLocation->index == kPlayingRow - 1);
}

// The two states the "Playing from" line turns on. A place that is merely empty rather than
// absent reads as the first row of a playlist nobody can name.
TEST_CASE("playing from nowhere is distinguishable from playing at the first row of a playlist") {
    PlayerStateStore store;
    store.publish(playingFrom(0));
    const auto atTheFirstRow = store.read();

    store.playingLocationChanged(std::nullopt);

    const auto fromNowhere = store.read();
    CHECK(atTheFirstRow.state.playingLocation.has_value());
    CHECK_FALSE(fromNowhere.state.playingLocation.has_value());
    CHECK(fromNowhere.version > atTheFirstRow.version);
}

TEST_CASE("a stop clears the name and the place, so a stopped player names nothing") {
    PlayerStateStore store;
    store.publish(namedAndPlaced());
    const uint64_t before = store.read().version;

    store.stopped();

    const auto published = store.read();
    CHECK_FALSE(published.state.title.has_value());
    CHECK_FALSE(published.state.artist.has_value());
    CHECK_FALSE(published.state.playingLocation.has_value());
    CHECK(published.version > before);
}

TEST_CASE("a track change does not leave the previous track's name standing") {
    PlayerStateStore store;
    store.publish(namedAndPlaced());

    store.started(anotherTrack(), kMarkedAt + minutes(1));

    const auto published = store.read();
    CHECK(published.state.path == R"(X:\music\b.flac)");
    CHECK_FALSE(published.state.title.has_value());
    CHECK_FALSE(published.state.artist.has_value());
}

// Clearing the place here would blank the "Playing from" line until the next
// playingLocationChanged() call catches it up.
TEST_CASE("a track change keeps the playing location, because the row change is what moves it") {
    PlayerStateStore store;
    store.publish(namedAndPlaced());

    store.started(anotherTrack(), kMarkedAt + minutes(1));

    const auto afterTheTrack = store.read();
    REQUIRE(afterTheTrack.state.playingLocation.has_value());
    CHECK(afterTheTrack.state.playingLocation->playlistId == kPlayingPlaylist);
    CHECK(afterTheTrack.state.playingLocation->index == kPlayingRow);

    store.playingLocationChanged(PlayingLocation{kPlayingPlaylist, kPlayingRow + 1});

    CHECK(store.read().state.playingLocation->index == kPlayingRow + 1);
}

TEST_CASE("a name the player computed as empty reads back absent, one field at a time") {
    PlayerStateStore store;
    store.publish(namedAndPlaced());

    store.nameChanged("", kArtist);

    const auto untitled = store.read();
    CHECK_FALSE(untitled.state.title.has_value());
    REQUIRE(untitled.state.artist.has_value());
    CHECK(*untitled.state.artist == kArtist);

    store.nameChanged(kTitle, "");

    const auto unattributed = store.read();
    REQUIRE(unattributed.state.title.has_value());
    CHECK(*unattributed.state.title == kTitle);
    CHECK_FALSE(unattributed.state.artist.has_value());
}

// A name of one space is what a tag holding one gives, and trimming is a separate decision
// nobody has taken. The store collapses what the title-format engine computed as nothing, and
// nothing else.
TEST_CASE("a name that is a single space is still a name") {
    PlayerStateStore store;
    store.publish(playing());

    store.nameChanged(kSingleSpace, kSingleSpace);

    const auto published = store.read();
    REQUIRE(published.state.title.has_value());
    CHECK(*published.state.title == kSingleSpace);
    REQUIRE(published.state.artist.has_value());
    CHECK(*published.state.artist == kSingleSpace);
}

// A broadcast announces its current song on every dynamic-info tick, so a station whose artist
// never resolves hands over the same empty string all evening. Held as an empty string rather
// than as absent, the first of those is a state change no client can perceive and every poll
// after it carries a body.
TEST_CASE("an empty name over a name already absent leaves the version alone") {
    PlayerStateStore store;
    store.publish(playing());
    const uint64_t before = store.read().version;

    for (int tick = 0; tick < kEditsInABurst; ++tick)
        store.nameChanged("", "");

    const auto published = store.read();
    CHECK_FALSE(published.state.title.has_value());
    CHECK_FALSE(published.state.artist.has_value());
    CHECK(published.version == before);
}
