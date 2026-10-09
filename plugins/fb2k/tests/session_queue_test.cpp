// A detached session's snapshot and its user queue. A wrong answer here is the next track being
// the wrong one, or an edit landing on a queue the client no longer holds.

#include "third_party/doctest.h"

#include "core/audience.h"
#include "core/player_outcome.h"
#include "core/session.h"

#include "support/fixtures.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;

namespace {

using Time = Audience::Clock::time_point;

SessionTrack track(const std::string& name) {
    SessionTrack made;
    made.path = name;
    made.handle = std::make_shared<const std::string>(name);
    return made;
}

std::vector<SessionTrack> rows(size_t count) {
    std::vector<SessionTrack> made;
    made.reserve(count);
    for (size_t row = 0; row < count; ++row)
        made.push_back(track("row " + std::to_string(row)));
    return made;
}

std::vector<SessionTrack> queued(const std::vector<std::string>& names) {
    std::vector<SessionTrack> made;
    made.reserve(names.size());
    for (const auto& name : names)
        made.push_back(track("queued " + name));
    return made;
}

std::vector<SessionTrack> many(size_t count, const std::string& prefix = "filler ") {
    std::vector<SessionTrack> made(count);
    for (size_t i = 0; i < count; ++i)
        made[i].path = prefix + std::to_string(i);
    return made;
}

std::vector<std::string> names(const Session::Queue& queue) {
    std::vector<std::string> paths;
    paths.reserve(queue.entries.size());
    for (const auto& entry : queue.entries)
        paths.push_back(entry.path);
    return paths;
}

std::vector<std::string> played(Session& session, size_t turns, Time now) {
    std::vector<std::string> paths;
    for (size_t i = 0; i < turns; ++i) {
        const auto turn = session.turn();
        if (!turn)
            break;

        paths.push_back(turn->track.path);
        session.ended(turn->serial, now);
    }
    return paths;
}

void endTrack(Session& session, Time now) {
    const auto turn = session.turn();
    REQUIRE(turn.has_value());
    session.ended(turn->serial, now);
}

struct Sessions {
    std::shared_ptr<Session> create(SessionRandom random = countingUp()) {
        const DeviceIdentity creator{"phone", {}};
        return std::make_shared<Session>("session-" + std::to_string(++made), creator, engine,
                                         std::move(random), now);
    }

    Audience engine{8, 30s};
    const Time now = Audience::Clock::now();
    int made = 0;
};

// What a refused edit must leave exactly as it found it.
struct Unchanged {
    explicit Unchanged(const Session& session)
        : entries(names(session.queue())),
          revision(session.queue().revision),
          version(session.revisions().version) {}

    bool still(const Session& session) const {
        return names(session.queue()) == entries && session.queue().revision == revision &&
               session.revisions().version == version;
    }

    std::vector<std::string> entries;
    uint64_t revision;
    uint64_t version;
};

}  // namespace

TEST_CASE("a session plays its snapshot to the end, whatever happens to the list it came from") {
    Sessions sessions;
    const auto session = sessions.create();

    auto list = rows(4);
    const std::weak_ptr<const void> firstHandle = list[0].handle;
    REQUIRE(session->play(list, 0, sessions.now) == PlayerOutcome::done);

    // The playlist edited, then deleted, by whoever holds it.
    list[1].path = "edited";
    list.erase(list.begin() + 2);
    list.push_back(track("added"));
    list.clear();
    list.shrink_to_fit();

    REQUIRE(session->turn().has_value());
    CHECK(session->turn()->track.handle.get() == firstHandle.lock().get());
    CHECK_FALSE(firstHandle.expired());

    CHECK(played(*session, 6, sessions.now) ==
          std::vector<std::string>{"row 0", "row 1", "row 2", "row 3"});
    CHECK_FALSE(session->turn().has_value());
}

TEST_CASE("tracks queued while a row plays come next in the order queued, then the following row") {
    Sessions sessions;
    const auto session = sessions.create();

    REQUIRE(session->play(rows(4), 1, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a"}));
    session->enqueue(queued({"b", "c"}));

    CHECK(played(*session, 8, sessions.now) ==
          std::vector<std::string>{"row 1", "queued a", "queued b", "queued c", "row 2", "row 3"});
    CHECK_FALSE(session->turn().has_value());
}

TEST_CASE("a track queued while a queued track plays goes behind the ones already queued") {
    Sessions sessions;
    const auto session = sessions.create();

    REQUIRE(session->play(rows(3), 0, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a", "b"}));
    endTrack(*session, sessions.now);
    REQUIRE(session->turn()->track.path == "queued a");

    session->enqueue(queued({"c"}));

    CHECK(played(*session, 6, sessions.now) ==
          std::vector<std::string>{"queued a", "queued b", "queued c", "row 1", "row 2"});
}

TEST_CASE("each queued track leaves the queue as it starts, and the queue's revision moves") {
    Sessions sessions;
    const auto session = sessions.create();

    REQUIRE(session->play(rows(3), 0, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a", "b"}));
    const auto full = session->queue().revision;

    endTrack(*session, sessions.now);
    CHECK(session->turn()->track.path == "queued a");
    CHECK(names(session->queue()) == std::vector<std::string>{"queued b"});
    const auto one = session->queue().revision;
    CHECK(one != full);
    CHECK(session->revisions().queue == one);

    endTrack(*session, sessions.now);
    CHECK(session->turn()->track.path == "queued b");
    CHECK(session->queue().entries.empty());
    const auto none = session->queue().revision;
    CHECK(none != one);

    // A snapshot row starting takes nothing off the queue.
    endTrack(*session, sessions.now);
    CHECK(session->turn()->track.path == "row 1");
    CHECK(session->queue().revision == none);
}

TEST_CASE("under repeat all the snapshot resumes after the queue at the next row, round the end") {
    Sessions sessions;
    const auto session = sessions.create();

    session->setOrder(SessionOrder::repeatAll);
    REQUIRE(session->play(rows(3), 2, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a"}));

    CHECK(played(*session, 4, sessions.now) ==
          std::vector<std::string>{"row 2", "queued a", "row 0", "row 1"});
}

TEST_CASE("in order, a track queued during the last row plays, and then the session stops") {
    Sessions sessions;
    const auto session = sessions.create();

    REQUIRE(session->play(rows(2), 1, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a"}));

    CHECK(played(*session, 4, sessions.now) == std::vector<std::string>{"row 1", "queued a"});
    CHECK_FALSE(session->turn().has_value());
}

// Twin sessions drawing the same script: the one with a queue must walk the same rows once its
// queue is played, so a queued track neither ends the walk nor draws a new one.
TEST_CASE("a shuffle walks on after the queue exactly as it would have without one") {
    Sessions sessions;
    const auto plain = sessions.create(countingUp());
    const auto withQueue = sessions.create(countingUp());

    for (const auto& session : {plain, withQueue}) {
        session->setOrder(SessionOrder::shuffleTracks);
        REQUIRE(session->play(rows(5), 2, sessions.now) == PlayerOutcome::done);
    }

    const auto expected = played(*plain, 10, sessions.now);

    auto walked = played(*withQueue, 3, sessions.now);
    withQueue->enqueue(queued({"a", "b"}));
    const auto rest = played(*withQueue, 9, sessions.now);
    REQUIRE(rest.size() == 9);
    CHECK(rest[1] == "queued a");
    CHECK(rest[2] == "queued b");

    std::copy_if(rest.begin(), rest.end(), std::back_inserter(walked),
                 [](const std::string& path) { return path.rfind("queued", 0) != 0; });
    CHECK(walked == expected);
}

TEST_CASE("a track queued at a position goes in there, and at the end for the queue's length") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a", "b"}));

    CHECK(session->enqueueAt(queued({"x", "y"}), 1, session->queue().revision) ==
          PlayerOutcome::done);
    CHECK(names(session->queue()) ==
          std::vector<std::string>{"queued a", "queued x", "queued y", "queued b"});

    CHECK(session->enqueueAt(queued({"z"}), 4, session->queue().revision) == PlayerOutcome::done);
    CHECK(names(session->queue()) ==
          std::vector<std::string>{"queued a", "queued x", "queued y", "queued b", "queued z"});
}

TEST_CASE("moving a queued track puts it where it is told, counted once it is taken out") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a", "b", "c"}));

    CHECK(session->moveQueued(0, 2, session->queue().revision) == PlayerOutcome::done);
    CHECK(names(session->queue()) == std::vector<std::string>{"queued b", "queued c", "queued a"});

    CHECK(session->moveQueued(2, 0, session->queue().revision) == PlayerOutcome::done);
    CHECK(names(session->queue()) == std::vector<std::string>{"queued a", "queued b", "queued c"});

    CHECK(session->moveQueued(1, 2, session->queue().revision) == PlayerOutcome::done);
    CHECK(names(session->queue()) == std::vector<std::string>{"queued a", "queued c", "queued b"});
}

TEST_CASE("removing a queued track takes out that one and leaves the rest in order") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a", "b", "c"}));

    CHECK(session->removeQueued(1, session->queue().revision) == PlayerOutcome::done);
    CHECK(names(session->queue()) == std::vector<std::string>{"queued a", "queued c"});
}

TEST_CASE("clearing the queue empties it") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a", "b"}));

    session->clearQueue();
    CHECK(session->queue().entries.empty());
}

TEST_CASE("an edit at a position the queue does not hold is refused and changes nothing") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a", "b"}));
    const auto revision = session->queue().revision;
    const Unchanged before(*session);

    CHECK(session->enqueueAt(queued({"x"}), 3, revision) == PlayerOutcome::positionPastEnd);
    CHECK(session->moveQueued(2, 0, revision) == PlayerOutcome::positionPastEnd);
    CHECK(session->moveQueued(0, 2, revision) == PlayerOutcome::positionPastEnd);
    CHECK(session->removeQueued(2, revision) == PlayerOutcome::positionPastEnd);

    CHECK(before.still(*session));
}

TEST_CASE("an edit naming a revision that is not the queue's own is refused and changes nothing") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a"}));
    const auto stale = session->queue().revision;
    session->enqueue(queued({"b", "c"}));
    REQUIRE(session->queue().revision != stale);
    const auto ahead = session->queue().revision + 1;
    const Unchanged before(*session);

    for (const auto revision : {stale, ahead}) {
        CAPTURE(revision);
        CHECK(session->enqueueAt(queued({"x"}), 0, revision) == PlayerOutcome::queueMoved);
        CHECK(session->moveQueued(0, 1, revision) == PlayerOutcome::queueMoved);
        CHECK(session->removeQueued(0, revision) == PlayerOutcome::queueMoved);

        // The engine's queue answers a moved queue first: the position was judged against a queue
        // the client no longer holds.
        CHECK(session->removeQueued(9, revision) == PlayerOutcome::queueMoved);
    }

    CHECK(before.still(*session));
}

TEST_CASE("every edit that changes the queue moves its revision and the session's version") {
    Sessions sessions;
    const auto session = sessions.create();

    const auto changes = [&session](const auto& edit) {
        const auto queueBefore = session->revisions().queue;
        const auto versionBefore = session->revisions().version;
        edit();
        CHECK(session->queue().revision == session->revisions().queue);
        return session->revisions().queue != queueBefore &&
               session->revisions().version != versionBefore;
    };

    CHECK(changes([&] { session->enqueue(queued({"a", "b", "c"})); }));
    CHECK(changes([&] { session->enqueueAt(queued({"x"}), 1, session->queue().revision); }));
    CHECK(changes([&] { session->moveQueued(0, 3, session->queue().revision); }));
    CHECK(changes([&] { session->removeQueued(0, session->queue().revision); }));
    CHECK(changes([&] { session->clearQueue(); }));
}

TEST_CASE("an edit that changes nothing moves neither the queue's revision nor the version") {
    Sessions sessions;
    const auto session = sessions.create();
    const Unchanged before(*session);

    session->clearQueue();
    session->enqueue({});

    CHECK(before.still(*session));
}

TEST_CASE("one session's queue is its own") {
    Sessions sessions;
    const auto mine = sessions.create();
    const auto theirs = sessions.create();

    REQUIRE(mine->play(rows(3), 0, sessions.now) == PlayerOutcome::done);
    REQUIRE(theirs->play(rows(3), 0, sessions.now) == PlayerOutcome::done);
    const auto theirRevisions = theirs->revisions();

    mine->enqueue(queued({"a"}));
    CHECK(theirs->queue().entries.empty());
    CHECK(theirs->revisions().queue == theirRevisions.queue);
    CHECK(theirs->revisions().version == theirRevisions.version);

    endTrack(*mine, sessions.now);
    endTrack(*theirs, sessions.now);
    CHECK(mine->turn()->track.path == "queued a");
    CHECK(theirs->turn()->track.path == "row 1");
}

TEST_CASE("the queue holds each track by its handle, and a queued track plays from that handle") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(2), 0, sessions.now) == PlayerOutcome::done);

    std::weak_ptr<const void> handle;
    {
        auto entry = track("queued a");
        entry.subsong = 2;
        entry.libraryPath = "Someone/A Record/disc.flac";
        handle = entry.handle;
        session->enqueue({entry});
    }

    // The caller's copy is gone, and the session's is what keeps the track.
    REQUIRE_FALSE(handle.expired());
    const auto entries = session->queue().entries;
    REQUIRE(entries.size() == 1);
    CHECK(entries[0].handle.get() == handle.lock().get());
    CHECK(entries[0].subsong == 2);
    CHECK(entries[0].libraryPath == std::optional<std::string>("Someone/A Record/disc.flac"));

    endTrack(*session, sessions.now);
    REQUIRE(session->turn().has_value());
    CHECK(session->turn()->track.handle.get() == handle.lock().get());
    CHECK(session->turn()->track.subsong == 2);
}

TEST_CASE("the queue holds at most ten thousand tracks") {
    CHECK(kMaxSessionQueue == 10000);
}

TEST_CASE("tracks that fill the queue exactly are taken, and one more is refused") {
    Sessions sessions;
    const auto session = sessions.create();

    CHECK(session->enqueue(many(kMaxSessionQueue - 1)) == PlayerOutcome::done);
    CHECK(session->enqueue(queued({"last"})) == PlayerOutcome::done);
    REQUIRE(session->queue().entries.size() == kMaxSessionQueue);
    CHECK(session->queue().entries.back().path == "queued last");

    const Unchanged before(*session);
    CHECK(session->enqueue(queued({"over"})) == PlayerOutcome::tooMany);
    CHECK(session->enqueueAt(queued({"over"}), 0, session->queue().revision) ==
          PlayerOutcome::tooMany);
    CHECK(session->enqueueAt(queued({"over"}), kMaxSessionQueue, session->queue().revision) ==
          PlayerOutcome::tooMany);
    CHECK(before.still(*session));
}

// A partial append would leave the client's selection half queued with no way to tell which half.
TEST_CASE("a request past the bound is refused whole, and one that fits exactly is taken whole") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->enqueue(many(kMaxSessionQueue - 2)) == PlayerOutcome::done);

    const Unchanged before(*session);
    CHECK(session->enqueue(queued({"a", "b", "c"})) == PlayerOutcome::tooMany);
    CHECK(session->enqueueAt(queued({"a", "b", "c"}), 1, session->queue().revision) ==
          PlayerOutcome::tooMany);
    CHECK(before.still(*session));

    CHECK(session->enqueueAt(queued({"a", "b"}), 1, session->queue().revision) ==
          PlayerOutcome::done);
    const auto entries = names(session->queue());
    REQUIRE(entries.size() == kMaxSessionQueue);
    CHECK(entries[0] == "filler 0");
    CHECK(entries[1] == "queued a");
    CHECK(entries[2] == "queued b");
    CHECK(entries[3] == "filler 1");
}

TEST_CASE("a stale revision is answered before a full queue") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->enqueue(many(kMaxSessionQueue - 1)) == PlayerOutcome::done);
    const auto stale = session->queue().revision;
    REQUIRE(session->enqueue(queued({"last"})) == PlayerOutcome::done);
    const Unchanged before(*session);

    CHECK(session->enqueueAt(queued({"over"}), 0, stale) == PlayerOutcome::queueMoved);
    CHECK(before.still(*session));
}

TEST_CASE("a queued track taken to play frees its place in a full queue") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(2), 0, sessions.now) == PlayerOutcome::done);
    REQUIRE(session->enqueue(many(kMaxSessionQueue)) == PlayerOutcome::done);
    REQUIRE(session->enqueue(queued({"over"})) == PlayerOutcome::tooMany);

    endTrack(*session, sessions.now);
    REQUIRE(session->turn()->track.path == "filler 0");

    CHECK(session->enqueue(queued({"room"})) == PlayerOutcome::done);
    CHECK(session->queue().entries.size() == kMaxSessionQueue);
    CHECK(session->queue().entries.back().path == "queued room");
}

namespace {

constexpr double kWellIn = 10;

const SessionOrder kEveryOrder[]{SessionOrder::inOrder, SessionOrder::repeatAll,
                                 SessionOrder::repeatOne, SessionOrder::random,
                                 SessionOrder::shuffleTracks};

std::string playingPath(const Session& session) {
    const auto turn = session.turn();
    return turn ? turn->track.path : std::string();
}

}  // namespace

TEST_CASE("next takes a queued track before the snapshot's next row") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(4), 1, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a"}));

    session->next(sessions.now);
    CHECK(playingPath(*session) == "queued a");
    CHECK(session->queue().entries.empty());

    session->next(sessions.now);
    CHECK(playingPath(*session) == "row 2");
}

TEST_CASE("previous takes nothing from the queue, and moves its revision not at all") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(4), 2, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a"}));
    const auto revision = session->queue().revision;

    session->previous(sessions.now);

    CHECK(playingPath(*session) == "row 1");
    CHECK(names(session->queue()) == std::vector<std::string>{"queued a"});
    CHECK(session->queue().revision == revision);
}

TEST_CASE("previous more than three seconds into a queued track starts that track again") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(4), 0, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a", "b"}));
    endTrack(*session, sessions.now);
    REQUIRE(playingPath(*session) == "queued a");
    session->seek(kWellIn, false, sessions.now);
    const auto seeked = session->turn();
    REQUIRE(seeked.has_value());

    session->previous(sessions.now);

    const auto restarted = session->turn();
    REQUIRE(restarted.has_value());
    CHECK(restarted->track.path == "queued a");
    CHECK(restarted->serial != seeked->serial);
    CHECK(restarted->from == doctest::Approx(0));
    CHECK(names(session->queue()) == std::vector<std::string>{"queued b"});
    CHECK(played(*session, 6, sessions.now) ==
          std::vector<std::string>{"queued a", "queued b", "row 1", "row 2", "row 3"});
}

TEST_CASE("previous within three seconds of a queued track goes back to the row played before it") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(4), 1, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a", "b"}));
    endTrack(*session, sessions.now);
    REQUIRE(playingPath(*session) == "queued a");

    session->previous(sessions.now);

    CHECK(playingPath(*session) == "row 1");
    CHECK(names(session->queue()) == std::vector<std::string>{"queued b"});
}

TEST_CASE(
    "previous more than three seconds into a queued track restarts it with no snapshot held") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a", "b"}));
    session->playPause(sessions.now);
    REQUIRE(playingPath(*session) == "queued a");
    session->seek(kWellIn, false, sessions.now);
    const auto seeked = session->turn();
    REQUIRE(seeked.has_value());

    session->previous(sessions.now);

    const auto restarted = session->turn();
    REQUIRE(restarted.has_value());
    CHECK(restarted->track.path == "queued a");
    CHECK(restarted->serial != seeked->serial);
    CHECK(restarted->from == doctest::Approx(0));
    CHECK(names(session->queue()) == std::vector<std::string>{"queued b"});
}

TEST_CASE("previous on a stopped session holding only a queue starts nothing and takes nothing") {
    Sessions sessions;
    const auto session = sessions.create();
    session->enqueue(queued({"a"}));
    const auto version = session->revisions().version;

    session->previous(sessions.now);

    CHECK_FALSE(session->turn().has_value());
    CHECK(session->state(sessions.now).playback == PlaybackState::stopped);
    CHECK(names(session->queue()) == std::vector<std::string>{"queued a"});
    CHECK(session->revisions().version == version);

    session->next(sessions.now);
    CHECK(playingPath(*session) == "queued a");
}

TEST_CASE("play after a stop starts the row it stopped on from its start") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(4), 2, sessions.now) == PlayerOutcome::done);
    session->seek(kWellIn, false, sessions.now);
    session->stop(sessions.now);

    session->playPause(sessions.now);

    REQUIRE(session->turn().has_value());
    CHECK(session->turn()->track.path == "row 2");
    CHECK(session->turn()->from == doctest::Approx(0));
}

TEST_CASE(
    "play after a stop takes the queue first, and the snapshot goes on after the stopped row") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(5), 1, sessions.now) == PlayerOutcome::done);
    session->stop(sessions.now);
    session->enqueue(queued({"a"}));

    session->playPause(sessions.now);

    CHECK(played(*session, 6, sessions.now) ==
          std::vector<std::string>{"queued a", "row 2", "row 3", "row 4"});
}

TEST_CASE("a stop during a queued track loses that track and keeps the rest of the queue") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now) == PlayerOutcome::done);
    session->enqueue(queued({"a", "b"}));
    endTrack(*session, sessions.now);
    REQUIRE(playingPath(*session) == "queued a");

    session->stop(sessions.now);
    CHECK(names(session->queue()) == std::vector<std::string>{"queued b"});

    session->playPause(sessions.now);
    CHECK(played(*session, 4, sessions.now) ==
          std::vector<std::string>{"queued b", "row 1", "row 2"});
}

// Twin sessions drawing the same script, one whose queued track failed and one whose ran out.
// repeatOne is where a failure and an end differ for a row: a failed row moves on, an ended one
// plays again.
TEST_CASE(
    "a queued track that fails resumes the snapshot as though it had ended, under every order") {
    for (const auto order : kEveryOrder) {
        CAPTURE(modeNameOf(order));
        Sessions sessions;
        const auto failing = sessions.create();
        const auto ending = sessions.create();

        for (const auto& session : {failing, ending}) {
            session->setOrder(order);
            REQUIRE(session->play(rows(4), 1, sessions.now) == PlayerOutcome::done);
            session->enqueue(queued({"a"}));
            endTrack(*session, sessions.now);
            REQUIRE(playingPath(*session) == "queued a");
        }

        CHECK(failing->threw(failing->turn()->serial, Thrower::decoder, sessions.now) ==
              AfterThrow::skipTrack);
        endTrack(*ending, sessions.now);

        CHECK(played(*failing, 6, sessions.now) == played(*ending, 6, sessions.now));
    }
}
