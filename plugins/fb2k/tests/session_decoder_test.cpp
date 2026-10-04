// What a detached session's decoder thread waits on, and how a session's stream is stopped. A
// wrong answer here is a decoder spinning while nobody listens, a decoder still decoding an old
// turn, or a reap that hangs the connection thread joining a decoder it never woke.

#include "third_party/doctest.h"

#include "core/audience.h"
#include "core/player_outcome.h"
#include "core/session.h"
#include "core/session_registry.h"

#include "support/eventually.h"
#include "support/fixtures.h"
#include "support/test_server.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;

namespace {

// A steady clock counts from boot, so a departure stamped by the real clock rather than the one
// the audience was given lands years before any instant read off this.
constexpr auto kLongAfterBoot = std::chrono::hours(24 * 365 * 10);

using Time = Audience::Clock::time_point;

// The instants the decoder hands awaitDue() come off the real clock: its pacer's askAgain.
Session::Clock::time_point alreadyDue() {
    return Session::Clock::now() - 1h;
}

Session::Clock::time_point farOff() {
    return Session::Clock::now() + 1h;
}

SessionRandom countingUp() {
    const auto drawn = std::make_shared<size_t>(0);
    return [drawn](size_t bound) { return (*drawn)++ % bound; };
}

std::vector<SessionTrack> rows(size_t count) {
    std::vector<SessionTrack> made(count);
    for (size_t row = 0; row < count; ++row)
        made[row].path = "row " + std::to_string(row);
    return made;
}

DeviceIdentity device(std::string id) {
    return DeviceIdentity{std::move(id), {}};
}

// Sessions on an audience whose linger runs on a clock only the test moves, and a registry on it.
struct Sessions {
    Sessions()
        : engine(8, 30s, [this] { return clock.now(); }),
          registry(engine, 4, countingMint(), countingUp()) {
        clock.advance(kLongAfterBoot);
    }

    Time now() const { return clock.now(); }

    std::shared_ptr<Session> create() {
        return std::make_shared<Session>("session-" + std::to_string(++made), device("phone"),
                                         engine, countingUp(), now());
    }

    std::shared_ptr<Session> registered() {
        const auto created = registry.create(device("phone"), now());
        REQUIRE(created.how == SessionCreation::created);
        return created.session;
    }

    ManualClock clock;
    Audience engine;
    SessionRegistry registry;
    int made = 0;
};

using Wait = std::function<bool(Session&, Turn&)>;

Wait untilRunning() {
    return [](Session& session, Turn& turn) { return session.awaitRunning(turn); };
}

Wait until(Session::Clock::time_point due) {
    return [due](Session& session, Turn& /*turn*/) { return session.awaitDue(due); };
}

struct Decoder {
    Decoder(Session& session, Wait wait, Turn held = {}) : turn(std::move(held)) {
        thread = std::thread([this, &session, wait = std::move(wait)] {
            answered = wait(session, turn);
            finished = true;
        });
    }

    ~Decoder() {
        if (thread.joinable())
            join("the end of a case that failed");
    }

    void join(const char* waitingFor) { joinOnceFinished(thread, finished, waitingFor); }

    Turn turn;
    bool answered = false;
    std::atomic<bool> finished{false};
    std::thread thread;
};

bool parked(const Session& session, size_t decoders) {
    return eventually([&session, decoders] { return session.waitingDecoders() == decoders; });
}

// A call made from another thread while the caller holds whatever it holds. Reached is false where
// a lock the caller holds kept it out until the watchdog ran out; join once the caller lets go.
struct Probe {
    explicit Probe(std::function<void()> call) {
        thread = std::thread([this, call = std::move(call)] {
            call();
            finished = true;
        });
        reached = eventually([this] { return finished.load(); });
    }

    ~Probe() {
        if (thread.joinable())
            join();
    }

    void join() { joinOnceFinished(thread, finished, "a probe kept out by a lock"); }

    std::atomic<bool> finished{false};
    bool reached = false;
    std::thread thread;
};

}  // namespace

TEST_CASE("a running session lets its decoder on at once, leaving a current turn alone") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);
    const auto ears = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(ears);
    REQUIRE(session->running());

    // The decoder's own copy of its turn, moved on as it decodes.
    Turn held = *session->turn();
    held.from = 42;

    Decoder decoder(*session, untilRunning(), held);
    decoder.join("a running session");

    CHECK(decoder.answered);
    CHECK(decoder.turn.serial == held.serial);
    CHECK(decoder.turn.from == 42);
    CHECK(session->waitingDecoders() == 0);
}

TEST_CASE("a decoder holding a turn the session has left is handed the current one as it wakes") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);
    const auto ears = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(ears);

    const Turn held = *session->turn();
    REQUIRE(session->ended(held.serial, sessions.now()));
    session->seek(30, false, sessions.now());
    const Turn current = *session->turn();

    Decoder decoder(*session, untilRunning(), held);
    decoder.join("a running session");

    CHECK(decoder.answered);
    CHECK(decoder.turn.serial == current.serial);
    CHECK(decoder.turn.track.path == "row 1");
    CHECK(decoder.turn.from == 30);
}

TEST_CASE("a session that is not running holds its decoder until it runs") {
    struct Example {
        const char* name;
        std::function<void(Session&, Sessions&, std::vector<std::shared_ptr<void>>&)> before;
        std::function<void(Session&, Sessions&, std::vector<std::shared_ptr<void>>&)> wake;
    };

    const Example examples[]{
        {"playing to nobody, until a listener arrives",
         [](Session& session, Sessions& sessions, auto& /*held*/) {
             REQUIRE(session.play(rows(3), 1, sessions.now()) == PlayerOutcome::done);
         },
         [](Session& session, Sessions& sessions, auto& held) {
             held.push_back(session.listen(device("phone"), "opus", sessions.now()));
         }},
        {"paused with a listener, until it plays again",
         [](Session& session, Sessions& sessions, auto& held) {
             REQUIRE(session.play(rows(3), 1, sessions.now()) == PlayerOutcome::done);
             held.push_back(session.listen(device("phone"), "opus", sessions.now()));
             session.playPause(sessions.now());
         },
         [](Session& session, Sessions& sessions, auto& /*held*/) {
             session.playPause(sessions.now());
         }},
        {"stopped with a listener, until something plays",
         [](Session& session, Sessions& sessions, auto& held) {
             held.push_back(session.listen(device("phone"), "opus", sessions.now()));
         },
         [](Session& session, Sessions& sessions, auto& /*held*/) {
             CHECK(session.play(rows(3), 1, sessions.now()) == PlayerOutcome::done);
         }},
    };

    for (const Example& example : examples) {
        CAPTURE(example.name);
        Sessions sessions;
        const auto session = sessions.create();
        std::vector<std::shared_ptr<void>> held;
        example.before(*session, sessions, held);
        REQUIRE_FALSE(session->running());

        Decoder decoder(*session, untilRunning());
        CHECK(parked(*session, 1));
        CHECK_FALSE(decoder.finished);

        example.wake(*session, sessions, held);
        decoder.join("the session to run");

        CHECK(decoder.answered);
        REQUIRE(session->turn().has_value());
        CHECK(decoder.turn.serial == session->turn()->serial);
        CHECK(decoder.turn.track.path == "row 1");
        CHECK(session->waitingDecoders() == 0);
    }
}

TEST_CASE("a stop leaves the decoder waiting, and the next play wakes it with the new turn") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);
    const auto ears = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(ears);
    session->playPause(sessions.now());

    Decoder decoder(*session, untilRunning(), *session->turn());
    CHECK(parked(*session, 1));

    session->stop(sessions.now());
    CHECK(parked(*session, 1));
    CHECK_FALSE(decoder.finished);

    CHECK(session->play(rows(3), 2, sessions.now()) == PlayerOutcome::done);
    decoder.join("a play after a stop");

    CHECK(decoder.answered);
    CHECK(decoder.turn.serial == session->turn()->serial);
    CHECK(decoder.turn.track.path == "row 2");
}

TEST_CASE("a decoder whose block is not yet due waits for it, running or not") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);
    const auto ears = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(ears);

    Decoder running(*session, until(farOff()));
    CHECK(parked(*session, 1));
    CHECK_FALSE(running.finished);

    // A stop is seen when the wait ends, not before.
    session->stop(sessions.now());
    CHECK(parked(*session, 1));
    CHECK_FALSE(running.finished);

    session->close();
    running.join("a close");
    CHECK_FALSE(running.answered);
}

// The decoder must come back out of the pacing wait on its own to close its input once stopped,
// so the wait for a due instant cannot also be a wait for the session to run.
TEST_CASE("a decoder's wait for its due instant ends then, though the session is not running") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);
    session->stop(sessions.now());
    REQUIRE_FALSE(session->running());

    Decoder overdue(*session, until(alreadyDue()));
    overdue.join("a due instant already passed");
    CHECK(overdue.answered);

    const auto due = Session::Clock::now() + 20ms;
    Decoder soon(*session, until(due));
    soon.join("a due instant 20 ms off");
    CHECK(soon.answered);
    CHECK(Session::Clock::now() >= due);
    CHECK(session->waitingDecoders() == 0);
}

TEST_CASE("closing wakes every decoder waiting, whether for its due instant or for the session") {
    Sessions sessions;
    const auto session = sessions.create();
    CHECK(session->waitingDecoders() == 0);
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);

    Decoder pacing(*session, until(farOff()));
    Decoder idle(*session, untilRunning(), *session->turn());
    CHECK(parked(*session, 2));

    session->close();
    pacing.join("a close");
    idle.join("a close");

    CHECK_FALSE(pacing.answered);
    CHECK_FALSE(idle.answered);
    CHECK(session->waitingDecoders() == 0);
}

TEST_CASE("a closed session answers either wait false at once, even running with a block due") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);
    const auto ears = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(ears);
    session->close();

    Decoder pacing(*session, until(farOff()));
    pacing.join("a closed session");
    Decoder running(*session, untilRunning(), *session->turn());
    running.join("a closed session");

    CHECK_FALSE(pacing.answered);
    CHECK_FALSE(running.answered);
}

TEST_CASE("a reap wakes the decoder of the session it reaps, in either wait") {
    Sessions sessions;
    const auto session = sessions.registered();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);

    Decoder pacing(*session, until(farOff()));
    Decoder idle(*session, untilRunning(), *session->turn());
    CHECK(parked(*session, 2));

    sessions.clock.advance(kControllingGrace + 1s);
    sessions.registry.sweep(sessions.now());
    pacing.join("a reap");
    idle.join("a reap");

    CHECK_FALSE(pacing.answered);
    CHECK_FALSE(idle.answered);
}

TEST_CASE("a session is stopped with no turn, and not while it plays or pauses") {
    Sessions sessions;
    const auto session = sessions.create();
    const auto now = sessions.now();
    CHECK(session->stopped());

    REQUIRE(session->play(rows(2), 0, now) == PlayerOutcome::done);
    CHECK_FALSE(session->stopped());
    const auto ears = session->listen(device("phone"), "opus", now);
    REQUIRE(ears);
    session->playPause(now);
    REQUIRE(session->state(now).playback == PlaybackState::paused);
    CHECK_FALSE(session->stopped());
    session->stop(now);
    CHECK(session->stopped());

    // In order, running off the last row.
    REQUIRE(session->play(rows(2), 1, now) == PlayerOutcome::done);
    REQUIRE_FALSE(session->ended(session->turn()->serial, now));
    CHECK(session->stopped());

    // Every row failing.
    REQUIRE(session->play(rows(2), 0, now) == PlayerOutcome::done);
    for (int i = 0; i < 2; ++i) {
        CHECK_FALSE(session->stopped());
        session->threw(session->turn()->serial, Thrower::decoder, now);
    }
    CHECK(session->stopped());
}

// The stream's stop joins the decoder thread, so it can only run once that thread is awake, and it
// can only reach the session if the session's lock is free.
TEST_CASE("closing stops the attached stream once, after waking the decoder, outside the lock") {
    Sessions sessions;
    const auto session = sessions.create();
    REQUIRE(session->play(rows(3), 0, sessions.now()) == PlayerOutcome::done);

    Decoder decoder(*session, untilRunning(), *session->turn());
    CHECK(parked(*session, 1));

    int stops = 0;
    bool decoderWoken = false;
    std::unique_ptr<Probe> probe;

    SessionStream stream;
    stream.stop = [&] {
        ++stops;
        decoderWoken = eventually([&decoder] { return decoder.finished.load(); });
        probe = std::make_unique<Probe>([&session] { static_cast<void>(session->running()); });
    };
    session->attach(std::move(stream));

    session->close();
    decoder.join("a close");
    REQUIRE(probe);
    probe->join();

    CHECK(stops == 1);
    CHECK(decoderWoken);
    CHECK(probe->reached);

    session->close();
    CHECK(stops == 1);
}

TEST_CASE("a session with no stream attached closes without calling anything") {
    Sessions sessions;
    const auto session = sessions.create();
    CHECK_NOTHROW(session->close());

    const auto bare = sessions.create();
    bare->attach(SessionStream{});
    CHECK_NOTHROW(bare->close());
}

TEST_CASE("a reaped session's stream is stopped once before the registry call returns, unlocked") {
    struct Way {
        const char* name;
        std::function<void(Sessions&, const std::shared_ptr<Session>&)> reap;
    };

    const Way ways[]{
        {"a sweep",
         [](Sessions& sessions, const std::shared_ptr<Session>& /*session*/) {
             sessions.clock.advance(kControllingGrace + 1s);
             sessions.registry.sweep(sessions.now());
         }},
        {"a find",
         [](Sessions& sessions, const std::shared_ptr<Session>& session) {
             sessions.clock.advance(kControllingGrace + 1s);
             static_cast<void>(sessions.registry.find(session->id(), "phone", sessions.now()));
         }},
        {"the last member leaving",
         [](Sessions& sessions, const std::shared_ptr<Session>& session) {
             REQUIRE(sessions.registry.leave(session->id(), "phone", sessions.now()) ==
                     SessionAnswer::Which::detached);
         }},
        {"the registry closing",
         [](Sessions& sessions, const std::shared_ptr<Session>& /*session*/) {
             sessions.registry.close();
         }},
    };

    for (const Way& way : ways) {
        CAPTURE(way.name);
        Sessions sessions;
        const auto session = sessions.registered();

        int stops = 0;
        std::unique_ptr<Probe> registryProbe;
        std::unique_ptr<Probe> sessionProbe;

        SessionStream stream;
        stream.stop = [&] {
            ++stops;
            registryProbe = std::make_unique<Probe>([&sessions] {
                static_cast<void>(sessions.registry.list("phone", sessions.now()));
            });
            sessionProbe =
                std::make_unique<Probe>([&session] { static_cast<void>(session->running()); });
        };
        session->attach(std::move(stream));

        way.reap(sessions, session);
        CHECK(stops == 1);

        REQUIRE(registryProbe);
        REQUIRE(sessionProbe);
        registryProbe->join();
        sessionProbe->join();
        CHECK(registryProbe->reached);
        CHECK(sessionProbe->reached);

        sessions.registry.sweep(sessions.now());
        session->close();
        CHECK(stops == 1);
    }
}

TEST_CASE("each timeline mark moves the session's timeline revision and its version") {
    Sessions sessions;
    const auto session = sessions.create();

    for (int i = 0; i < 3; ++i) {
        const auto before = session->revisions();
        session->timelineMarked();
        CHECK(session->revisions().timeline != before.timeline);
        CHECK(session->revisions().version != before.version);
    }
}

TEST_CASE("nothing but a timeline mark moves the timeline revision") {
    Sessions sessions;
    const auto session = sessions.create();
    const auto timeline = session->revisions().timeline;
    const auto now = sessions.now();

    REQUIRE(session->play(rows(3), 0, now) == PlayerOutcome::done);
    session->began(session->turn()->serial, 300, now);
    const auto ears = session->listen(device("phone"), "opus", now);
    REQUIRE(session->ended(session->turn()->serial, now));
    session->seek(20, false, now);
    REQUIRE(session->enqueue(rows(2)) == PlayerOutcome::done);
    session->clearQueue();
    session->share(true);
    session->setOrder(SessionOrder::repeatAll);
    session->playPause(now);
    session->threw(session->turn()->serial, Thrower::chain, now);
    session->stop(now);

    CHECK(session->revisions().timeline == timeline);
}
