#include "third_party/doctest.h"

#include "core/player_state.h"
#include "core/playlists.h"

#include <chrono>
#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

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
constexpr char kAlbum[] = "More";
constexpr char kAlbumArtist[] = "Pink Floyd";
constexpr char kSingleSpace[] = " ";

// The song a station announces next, under the same track handle.
constexpr char kNextTitle[] = "Behave Yourself";
constexpr char kNextArtist[] = "Booker T. & the M.G.'s";
constexpr char kNextAlbum[] = "Green Onions";
constexpr char kNextAlbumArtist[] = "Booker T. & the M.G.'s";

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

constexpr uint32_t kQueuedRow = 3;

QueueEntry queuedFromLibrary(const char* path) {
    QueueEntry entry;
    entry.path = path;
    return entry;
}

QueueEntry queuedFromThePlaylist(uint32_t row) {
    QueueEntry entry;
    entry.path = R"(X:\music\c.flac)";
    entry.location = PlayingLocation{kPlayingPlaylist, row};
    return entry;
}

std::vector<QueueEntry> twoQueued() {
    return {queuedFromLibrary(R"(X:\music\a.flac)"), queuedFromLibrary(R"(X:\music\b.flac)")};
}

constexpr char kAlbumsPlaylist[] = "0c2f9d91-6c8a-4f1c-9a7f-2d3b5e7c1a80";
constexpr char kSinglesPlaylist[] = "b7e41a52-3c9d-4e08-8f16-5a2c7d0be934";
constexpr char kLivePlaylist[] = "3d80f4c6-9b21-4a7e-8c05-6e1f2a9db473";

PlaylistMark markOf(const PlaylistVersions& versions, const char* id, const char* title) {
    const PlaylistVersion version = versions.of(id);
    return PlaylistMark{id, title, version.structure, version.revision};
}

std::vector<PlaylistMark> twoPlaylists(const PlaylistVersions& versions) {
    return {markOf(versions, kAlbumsPlaylist, "Albums"),
            markOf(versions, kSinglesPlaylist, "Singles")};
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
    // A rescan can take the playing track into the media library while it is still playing, and
    // then this is the only field that moves. state_route_test.cpp has what a client misses when
    // a field sits outside this comparison.
    SUBCASE("the media library takes in the track that is playing") {
        changed.libraryPath = "Fictional Artist/Imaginary Album/01 A Title.flac";
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
    CHECK(published.state.position.seconds == doctest::Approx(kReachedSeconds + kRanOnFor.count()));
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
    CHECK(published.state.position.seconds == doctest::Approx(kReachedSeconds + kRanOnFor.count()));
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

TEST_CASE("the focused playlist moves without disturbing where the playing track is") {
    PlayerStateStore store;
    store.publish(playingFrom(kPlayingRow));
    const auto atTheStart = store.read();

    store.currentPlaylistChanged(std::string{"another-playlist"});
    const auto focusedElsewhere = store.read();

    CHECK(focusedElsewhere.version > atTheStart.version);
    CHECK(focusedElsewhere.state.currentPlaylistId == "another-playlist");
    CHECK(focusedElsewhere.state.playingLocation == atTheStart.state.playingLocation);
}

TEST_CASE("the focused playlist reported again unchanged leaves the version alone") {
    PlayerStateStore store;
    store.publish(playingFrom(kPlayingRow));
    store.currentPlaylistChanged(std::string{kPlayingPlaylist});
    const uint64_t before = store.read().version;

    for (int edit = 0; edit < kEditsInABurst; ++edit)
        store.currentPlaylistChanged(std::string{kPlayingPlaylist});

    CHECK(store.read().version == before);
}

// A player with no focused playlist at all is a state foobar2000 can be in, and it has to read
// as that rather than as a playlist whose id is the empty string.
TEST_CASE("no focused playlist is distinguishable from one whose id is empty") {
    PlayerStateStore store;
    store.publish(playingFrom(0));
    store.currentPlaylistChanged(std::string{});
    const auto named = store.read();

    store.currentPlaylistChanged(std::nullopt);
    const auto none = store.read();

    CHECK(named.state.currentPlaylistId.has_value());
    CHECK_FALSE(none.state.currentPlaylistId.has_value());
    CHECK(none.version > named.version);
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

    store.nameChanged("", kArtist, "", "");

    const auto untitled = store.read();
    CHECK_FALSE(untitled.state.title.has_value());
    REQUIRE(untitled.state.artist.has_value());
    CHECK(*untitled.state.artist == kArtist);

    store.nameChanged(kTitle, "", "", "");

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

    store.nameChanged(kSingleSpace, kSingleSpace, "", "");

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
        store.nameChanged("", "", "", "");

    const auto published = store.read();
    CHECK_FALSE(published.state.title.has_value());
    CHECK_FALSE(published.state.artist.has_value());
    CHECK(published.version == before);
}

// `GET /state` answers `null` for a field the player computed nothing for, so an album resolved
// as nothing has to collapse the way a title already does. Held as an empty string it is a
// record, and a client keys a cover by it.
TEST_CASE("a record the player computed as empty reads back absent, one field at a time") {
    PlayerStateStore store;
    store.publish(namedAndPlaced());

    store.nameChanged(kTitle, kArtist, "", kAlbumArtist);

    const auto recordless = store.read();
    CHECK_FALSE(recordless.state.album.has_value());
    CHECK(recordless.state.albumArtist == kAlbumArtist);

    store.nameChanged(kTitle, kArtist, kAlbum, "");

    const auto unattributed = store.read();
    CHECK(unattributed.state.album == kAlbum);
    CHECK_FALSE(unattributed.state.albumArtist.has_value());
}

// A station announcing its next song leaves the track handle where it is, so nothing resets the
// record between one song and the next. Moved as a title and then a record, the state in between
// carries the new song's title beside the previous song's album, which is the wrong sleeve on the
// status bar and on the lock screen. A client reads only states the store published, so one
// version moved is what says no such state existed.
TEST_CASE("a new title never becomes readable beside the previous song's album") {
    PlayerStateStore store;
    store.publish(playing());
    store.nameChanged(kTitle, kArtist, kAlbum, kAlbumArtist);
    const auto firstSong = store.read();

    store.nameChanged(kNextTitle, kNextArtist, kNextAlbum, kNextAlbumArtist);

    const auto nextSong = store.read();
    CHECK(nextSong.version == firstSong.version + 1);
    CHECK(nextSong.state.title == kNextTitle);
    CHECK(nextSong.state.artist == kNextArtist);
    CHECK(nextSong.state.album == kNextAlbum);
    CHECK(nextSong.state.albumArtist == kNextAlbumArtist);
}

// A client refetches the queue whenever the revision moves, so a report that changed nothing and
// moved it anyway costs every client a request, once per report.
TEST_CASE("a queue change moves the version and the queue revision once, however often reported") {
    PlayerStateStore store;
    store.publish(playing());
    const auto before = store.read();

    store.queueChanged(twoQueued());
    const auto afterTheChange = store.read();

    for (int edit = 0; edit < kEditsInABurst; ++edit)
        store.queueChanged(twoQueued());

    CHECK(afterTheChange.version > before.version);
    CHECK(afterTheChange.queueRevision > before.queueRevision);
    CHECK(store.read().version == afterTheChange.version);
    CHECK(store.read().queueRevision == afterTheChange.queueRevision);
}

// The seed `fb2k/playback_watch.cpp` hands a store at construction, on a player whose queue is
// empty, which is most of them.
TEST_CASE("an empty queue reported to a store that has never held one moves nothing") {
    PlayerStateStore store;
    store.publish(playing());
    const auto before = store.read();

    store.queueChanged({});

    CHECK(store.read().version == before.version);
    CHECK(store.read().queueRevision == before.queueRevision);
}

TEST_CASE("the queue revision moves when the queue's contents or order change") {
    PlayerStateStore store;
    store.publish(playing());

    const QueueEntry first = queuedFromLibrary(R"(X:\music\a.flac)");
    const QueueEntry second = queuedFromLibrary(R"(X:\music\b.flac)");
    const QueueEntry positioned = queuedFromThePlaylist(kQueuedRow);
    store.queueChanged({first, second, positioned});
    const auto before = store.read();

    std::vector<QueueEntry> changed;

    SUBCASE("a track is queued at the end") {
        changed = {first, second, positioned, queuedFromLibrary(R"(X:\music\d.flac)")};
    }
    SUBCASE("an entry is removed") {
        changed = {first, positioned};
    }
    SUBCASE("the same entries in another order") {
        changed = {second, first, positioned};
    }
    SUBCASE("the queue is cleared") {
        changed = {};
    }
    SUBCASE("another subsong of a queued file takes its place") {
        QueueEntry otherSubsong = second;
        otherSubsong.subsong = 2;
        changed = {first, otherSubsong, positioned};
    }
    // The position is part of what GET /api/queue answers for an entry, so a row that shifts
    // or loses its place leaves a client drawing it where it no longer is.
    SUBCASE("a queued row moves within its playlist") {
        changed = {first, second, queuedFromThePlaylist(kQueuedRow - 1)};
    }
    SUBCASE("a queued row loses its position") {
        QueueEntry stale = positioned;
        stale.location.reset();
        changed = {first, second, stale};
    }

    store.queueChanged(changed);

    CHECK(store.read().queueRevision > before.queueRevision);
    CHECK(store.read().version > before.version);
}

// foobar2000's queue holds the same track twice as happily as once. A comparison that asks which
// tracks are queued rather than what the queue holds misses the second copy going.
TEST_CASE("removing one of two copies of the same track is a queue change") {
    PlayerStateStore store;
    const QueueEntry track = queuedFromLibrary(R"(X:\music\a.flac)");
    store.queueChanged({track, track});
    const uint64_t before = store.read().queueRevision;

    store.queueChanged({track});

    CHECK(store.read().queueRevision > before);
}

// A client names the revision it holds when it moves an entry, and is refused when that revision
// is stale. A revision that could return to a number it once had would let a queue changed and
// changed back again pass as the one the client last read.
TEST_CASE("a queue changed and changed back again has a revision no client has held") {
    PlayerStateStore store;
    store.queueChanged(twoQueued());
    const uint64_t held = store.read().queueRevision;

    store.queueChanged({});
    store.queueChanged(twoQueued());

    CHECK(store.read().queueRevision > held);
}

TEST_CASE("the queue revision stays where it is while everything else about the player moves") {
    PlayerStateStore store;
    store.publish(playingFrom(kPlayingRow));
    store.queueChanged(twoQueued());
    const auto before = store.read();

    SUBCASE("a whole state is published") {
        PlayerState paused = playingFrom(kPlayingRow);
        paused.playback = PlaybackState::paused;
        store.publish(paused);
    }
    SUBCASE("another track starts") {
        store.started(anotherTrack(), kMarkedAt + minutes(1));
    }
    SUBCASE("somebody seeks") {
        store.seeked(90.0, kMarkedAt + kRanOnFor);
    }
    SUBCASE("the volume moves") {
        store.volumeChanged(-12.0, true);
    }
    SUBCASE("the playing row moves") {
        store.playingLocationChanged(PlayingLocation{kPlayingPlaylist, kPlayingRow + 1});
    }
    SUBCASE("the player stops") {
        store.stopped();
    }

    CHECK(store.read().version > before.version);
    CHECK(store.read().queueRevision == before.queueRevision);
}

// Every way the list a client holds goes stale. A client re-reads GET /api/playlists when this
// number moves and nothing else tells it to, so a trigger missed here leaves the sidebar, the
// pickers and the playlist view wrong until something unrelated moves.
TEST_CASE("the playlists revision moves for every change a client has to re-read the list for") {
    PlaylistVersions versions;
    PlayerStateStore store;
    store.publish(playing());
    store.playlistsChanged(twoPlaylists(versions));
    const auto before = store.read();

    std::vector<PlaylistMark> changed = twoPlaylists(versions);

    // playlist_versions_test.cpp separates the four kinds of row change. All the store sees of
    // any of them is a structure generation that moved, so they are one case here.
    SUBCASE("a playlist's rows are added, removed, reordered or replaced") {
        versions.rowsChanged(kAlbumsPlaylist, RowsChanged::added);
        changed = twoPlaylists(versions);
    }
    SUBCASE("a row's tag, rating or play count changes") {
        versions.contentChanged(kAlbumsPlaylist, {2});
        changed = twoPlaylists(versions);
    }
    SUBCASE("a playlist is created") {
        changed.push_back(markOf(versions, kLivePlaylist, "Live"));
    }
    SUBCASE("a playlist is removed") {
        changed.erase(changed.begin());
    }
    SUBCASE("a playlist is moved in the list") {
        std::swap(changed.front(), changed.back());
    }
    SUBCASE("a playlist is retitled") {
        changed.front().title = "Albums and more";
    }

    store.playlistsChanged(changed);

    CHECK(store.read().playlistsRevision > before.playlistsRevision);
    CHECK(store.read().version > before.version);
}

TEST_CASE("the playlists revision stands still while everything else about the player moves") {
    const PlaylistVersions versions;
    PlayerStateStore store;
    store.publish(playingFrom(kPlayingRow));
    store.playlistsChanged(twoPlaylists(versions));
    const auto before = store.read();

    SUBCASE("a whole state is published") {
        PlayerState paused = playingFrom(kPlayingRow);
        paused.playback = PlaybackState::paused;
        store.publish(paused);
    }
    SUBCASE("another track starts") {
        store.started(anotherTrack(), kMarkedAt + minutes(1));
    }
    SUBCASE("the player pauses") {
        store.paused(kMarkedAt + kRanOnFor);
    }
    SUBCASE("somebody seeks") {
        store.seeked(90.0, kMarkedAt + kRanOnFor);
    }
    SUBCASE("the volume moves") {
        store.volumeChanged(-12.0, true);
    }
    SUBCASE("the playing row moves") {
        store.playingLocationChanged(PlayingLocation{kPlayingPlaylist, kPlayingRow + 1});
    }
    SUBCASE("the queue changes") {
        store.queueChanged(twoQueued());
    }
    SUBCASE("the player stops") {
        store.stopped();
    }

    CHECK(store.read().version > before.version);
    CHECK(store.read().playlistsRevision == before.playlistsRevision);
}

// foobar2000 raises a playlist callback per operation and several of them per edit, so a list
// reported again unchanged is the ordinary case rather than the odd one. Moved anyway, it costs
// every client a fetch of the list per report.
TEST_CASE("a list reported again unchanged moves the playlists revision once") {
    PlaylistVersions versions;
    PlayerStateStore store;
    store.publish(playing());
    store.playlistsChanged(twoPlaylists(versions));
    const auto before = store.read();

    versions.rowsChanged(kAlbumsPlaylist, RowsChanged::added);
    store.playlistsChanged(twoPlaylists(versions));
    const auto afterTheChange = store.read();

    for (int report = 0; report < kEditsInABurst; ++report)
        store.playlistsChanged(twoPlaylists(versions));

    CHECK(afterTheChange.playlistsRevision > before.playlistsRevision);
    CHECK(store.read().playlistsRevision == afterTheChange.playlistsRevision);
    CHECK(store.read().version == afterTheChange.version);
}
