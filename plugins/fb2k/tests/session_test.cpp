// Detached sessions: who may find one, what it plays next, and when it ends. A wrong answer here
// is somebody's music stopping under them, or a session nobody can reach holding a place forever.

#include "third_party/doctest.h"

#include "core/audience.h"
#include "core/session.h"
#include "core/session_registry.h"

#include "support/fixtures.h"
#include "support/test_server.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <memory>
#include <numeric>
#include <optional>
#include <string>
#include <vector>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;

namespace {

constexpr auto kLinger = 30s;
constexpr int kStreamCap = 8;
constexpr int kMaxSessions = 4;

// A steady clock counts from boot on macOS, Linux and Windows, so a departure stamped by the real
// clock rather than the one the audience was given lands years before any instant read off this.
constexpr auto kLongAfterBoot = std::chrono::hours(24 * 365 * 10);

using Time = Audience::Clock::time_point;

DeviceIdentity device(std::string id) {
    return DeviceIdentity{std::move(id), {}};
}

// Each script below cycles through every value under a bound, so an implementation that draws
// again until it gets a row other than the last one still finishes.
SessionRandom countingDown() {
    const auto drawn = std::make_shared<size_t>(0);
    return [drawn](size_t bound) { return bound - 1 - ((*drawn)++ % bound); };
}

SessionRandom scattered() {
    const auto state = std::make_shared<uint64_t>(0x9e3779b97f4a7c15ULL);
    return [state](size_t bound) {
        *state = (*state * 6364136223846793005ULL) + 1442695040888963407ULL;
        return static_cast<size_t>((*state >> 33U) % bound);
    };
}

TicketMint failingOnce() {
    const auto calls = std::make_shared<int>(0);
    return [calls] { return ++*calls == 1 ? std::string() : "session-" + std::to_string(*calls); };
}

// The engine session's audience on a clock only the test moves, and the registry built on it.
struct Sessions {
    explicit Sessions(int maxSessions = kMaxSessions, SessionRandom random = scattered(),
                      TicketMint mint = countingMint())
        : engine(kStreamCap, kLinger, [this] { return clock.now(); }),
          registry(engine, maxSessions, std::move(mint), std::move(random)) {
        clock.advance(kLongAfterBoot);
    }

    Time now() const { return clock.now(); }

    void wait(Audience::Clock::duration by) { clock.advance(by); }

    std::shared_ptr<Session> create(const std::string& creator) {
        const auto created = registry.create(device(creator), now());
        REQUIRE(created.how == SessionCreation::created);
        REQUIRE(created.session.get() != nullptr);
        return created.session;
    }

    std::shared_ptr<Session> createShared(const std::string& creator) {
        auto session = create(creator);
        REQUIRE(registry.share(session->id(), creator, true, now()) == SessionShare::done);
        return session;
    }

    SessionAnswer::Which whichFor(const std::string& id, const std::string& deviceId) {
        return registry.find(id, deviceId, now()).which;
    }

    // What a state poll or a ticket naming the session does for a device.
    bool joins(const std::shared_ptr<Session>& session, const std::string& deviceId) {
        return registry.find(session->id(), deviceId, now(), Naming::joining).which ==
               SessionAnswer::Which::detached;
    }

    bool exists(const std::shared_ptr<Session>& shared) {
        return whichFor(shared->id(), "a stranger") == SessionAnswer::Which::detached;
    }

    std::vector<std::string> listedFor(const std::string& deviceId) {
        std::vector<std::string> ids;
        for (const auto& session : registry.list(deviceId, now()))
            ids.push_back(session->id());
        return ids;
    }

    ManualClock clock;
    Audience engine;
    SessionRegistry registry;
};

std::vector<SessionTrack> tracks(size_t count) {
    std::vector<SessionTrack> made(count);
    for (size_t row = 0; row < count; ++row)
        made[row].path = "Someone/A Record/" + std::to_string(row) + ".flac";
    return made;
}

std::optional<size_t> rowPlaying(const Session& session, const std::vector<SessionTrack>& rows) {
    const auto turn = session.turn();
    if (!turn)
        return std::nullopt;

    const auto found = std::find_if(rows.begin(), rows.end(), [&turn](const SessionTrack& row) {
        return row.path == turn->track.path;
    });
    if (found == rows.end())
        return std::nullopt;

    return static_cast<size_t>(std::distance(rows.begin(), found));
}

std::vector<size_t> rowsPlayed(Session& session, const std::vector<SessionTrack>& rows,
                               size_t turns, Time now) {
    std::vector<size_t> played;
    for (size_t i = 0; i < turns; ++i) {
        const auto row = rowPlaying(session, rows);
        if (!row)
            break;

        played.push_back(*row);
        session.ended(session.turn()->serial, now);
    }
    return played;
}

bool everyRowOnce(std::vector<size_t> played, size_t count) {
    std::vector<size_t> rows(count);
    std::iota(rows.begin(), rows.end(), size_t{0});
    std::sort(played.begin(), played.end());
    return played == rows;
}

double heard(const PlayerState& state, Time now) {
    if (state.playback != PlaybackState::playing)
        return state.position.seconds;

    const auto since = std::chrono::duration<double>(now - state.position.taken);
    return state.position.seconds + since.count();
}

}  // namespace

TEST_CASE("a new session is private, stopped, empty and in order") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();

    CHECK_FALSE(session->shared());
    CHECK(session->state(now).playback == PlaybackState::stopped);
    CHECK(session->state(now).playbackMode == "inOrder");
    CHECK_FALSE(session->turn().has_value());

    // Play with nothing in the snapshot has nothing to start.
    session->playPause(now);
    CHECK_FALSE(session->turn().has_value());
}

// Each order set from one that is not it, in a sequence that is not the declared one, so an
// accessor answering the order before the last one set is caught.
TEST_CASE("a session answers the order it was last given, as its state names it") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();

    CHECK(session->order() == SessionOrder::inOrder);

    for (const auto order : {SessionOrder::random, SessionOrder::repeatOne, SessionOrder::inOrder,
                             SessionOrder::shuffleTracks, SessionOrder::repeatAll}) {
        CAPTURE(modeNameOf(order));
        session->setOrder(order);
        CHECK(session->order() == order);
        CHECK(modeNameOf(session->order()) == session->state(now).playbackMode);
    }
}

TEST_CASE("two sessions each keep their own track, order, position and transport") {
    Sessions sessions;
    const auto mine = sessions.create("phone");
    const auto theirs = sessions.create("laptop");
    const auto now = sessions.now();
    const auto songs = tracks(3);

    REQUIRE(mine->id() != theirs->id());

    const auto myEars = mine->listen(device("phone"), "opus", now);
    const auto theirEars = theirs->listen(device("laptop"), "opus", now);
    REQUIRE(myEars);
    REQUIRE(theirEars);

    REQUIRE(mine->play(songs, 2, now) == PlayerOutcome::done);
    CHECK(theirs->state(now).playback == PlaybackState::stopped);
    CHECK_FALSE(theirs->turn().has_value());

    REQUIRE(theirs->play(songs, 0, now) == PlayerOutcome::done);
    mine->setOrder(SessionOrder::repeatOne);
    mine->seek(42, false, now);
    mine->playPause(now);

    CHECK(mine->state(now).playback == PlaybackState::paused);
    CHECK(theirs->state(now).playback == PlaybackState::playing);
    CHECK(mine->state(now).playbackMode == "repeatOne");
    CHECK(theirs->state(now).playbackMode == "inOrder");
    CHECK(mine->order() == SessionOrder::repeatOne);
    CHECK(theirs->order() == SessionOrder::inOrder);
    CHECK(heard(mine->state(now), now) == doctest::Approx(42));
    CHECK(heard(theirs->state(now), now) == doctest::Approx(0));

    theirs->ended(theirs->turn()->serial, now);
    CHECK(rowPlaying(*theirs, songs) == size_t{1});
    CHECK(rowPlaying(*mine, songs) == size_t{2});

    theirs->stop(now);
    CHECK(mine->state(now).playback == PlaybackState::paused);
    CHECK(mine->turn().has_value());
}

TEST_CASE("in order stops after the last row, and play then starts from the first") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    const auto songs = tracks(4);

    // Started at a row other than the first, so starting again from it is not starting over.
    REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
    CHECK(session->ended(session->turn()->serial, now));
    CHECK(rowPlaying(*session, songs) == size_t{3});

    CHECK_FALSE(session->ended(session->turn()->serial, now));
    CHECK_FALSE(session->turn().has_value());
    CHECK(session->state(now).playback == PlaybackState::stopped);

    session->playPause(now);
    CHECK(rowPlaying(*session, songs) == size_t{0});
}

TEST_CASE("repeating all goes from the last row back to the first") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    const auto songs = tracks(4);

    session->setOrder(SessionOrder::repeatAll);
    REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);

    CHECK(rowsPlayed(*session, songs, 6, now) == std::vector<size_t>{2, 3, 0, 1, 2, 3});
}

TEST_CASE("repeating one plays the same row again when it ends") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    const auto songs = tracks(3);

    session->setOrder(SessionOrder::repeatOne);
    REQUIRE(session->play(songs, 1, now) == PlayerOutcome::done);

    CHECK(rowsPlayed(*session, songs, 3, now) == std::vector<size_t>{1, 1, 1});
}

TEST_CASE("a shuffle started at a row plays that row first") {
    const auto songs = tracks(5);

    for (const auto& script : {countingUp, countingDown, scattered}) {
        for (size_t row = 0; row < songs.size(); ++row) {
            CAPTURE(row);
            Sessions sessions(kMaxSessions, script());
            const auto session = sessions.create("phone");

            session->setOrder(SessionOrder::shuffleTracks);
            REQUIRE(session->play(songs, row, sessions.now()) == PlayerOutcome::done);
            CHECK(rowPlaying(*session, songs) == row);
        }
    }
}

TEST_CASE("a shuffle plays every row once before any row plays again, and never stops") {
    const auto songs = tracks(5);

    for (const auto& script : {countingUp, countingDown, scattered}) {
        Sessions sessions(kMaxSessions, script());
        const auto session = sessions.create("phone");

        session->setOrder(SessionOrder::shuffleTracks);
        REQUIRE(session->play(songs, 3, sessions.now()) == PlayerOutcome::done);

        const auto played = rowsPlayed(*session, songs, 3 * songs.size(), sessions.now());
        REQUIRE(played.size() == 3 * songs.size());

        for (size_t walk = 0; walk < 3; ++walk) {
            CAPTURE(walk);
            const auto from = played.begin() + static_cast<std::ptrdiff_t>(walk * songs.size());
            CHECK(everyRowOnce({from, from + static_cast<std::ptrdiff_t>(songs.size())},
                               songs.size()));
        }

        CHECK(session->turn().has_value());
    }
}

// A pass that ends on the row the next pass happens to start with would play it twice running.
// With two rows and a script whose first draw is 0, an unguarded second pass starts on that row.
TEST_CASE("a shuffle never plays one row twice running where one pass gives way to the next") {
    for (const size_t count : {size_t{2}, size_t{3}, size_t{4}, size_t{5}}) {
        for (const auto& script : {countingUp, countingDown, scattered}) {
            CAPTURE(count);
            const auto songs = tracks(count);
            Sessions sessions(kMaxSessions, script());
            const auto session = sessions.create("phone");

            session->setOrder(SessionOrder::shuffleTracks);
            REQUIRE(session->play(songs, 0, sessions.now()) == PlayerOutcome::done);

            const size_t passes = 8;
            const auto played = rowsPlayed(*session, songs, passes * count, sessions.now());
            REQUIRE(played.size() == passes * count);

            CHECK(std::adjacent_find(played.begin(), played.end()) == played.end());
            for (size_t pass = 0; pass < passes; ++pass) {
                CAPTURE(pass);
                const auto from = played.begin() + static_cast<std::ptrdiff_t>(pass * count);
                CHECK(everyRowOnce({from, from + static_cast<std::ptrdiff_t>(count)}, count));
            }
        }
    }
}

TEST_CASE("a shuffle and a random pick both draw on the source the registry was given") {
    const auto songs = tracks(5);

    for (const auto order : {SessionOrder::shuffleTracks, SessionOrder::random}) {
        CAPTURE(modeNameOf(order));
        std::vector<std::vector<size_t>> walks;

        for (const auto& script : {countingUp, countingDown}) {
            Sessions sessions(kMaxSessions, script());
            const auto session = sessions.create("phone");

            session->setOrder(order);
            REQUIRE(session->play(songs, 0, sessions.now()) == PlayerOutcome::done);
            walks.push_back(rowsPlayed(*session, songs, songs.size(), sessions.now()));
        }

        CHECK(walks[0] != walks[1]);
    }
}

TEST_CASE("random never plays one row twice running, and never stops") {
    for (const size_t count : {size_t{2}, size_t{5}}) {
        for (const auto& script : {countingUp, countingDown, scattered}) {
            CAPTURE(count);
            const auto songs = tracks(count);
            Sessions sessions(kMaxSessions, script());
            const auto session = sessions.create("phone");

            session->setOrder(SessionOrder::random);
            REQUIRE(session->play(songs, 0, sessions.now()) == PlayerOutcome::done);

            const auto played = rowsPlayed(*session, songs, 20, sessions.now());
            REQUIRE(played.size() == 20);
            CHECK(std::adjacent_find(played.begin(), played.end()) == played.end());
            CHECK(session->turn().has_value());
        }
    }
}

TEST_CASE("a session offers exactly the five orders it can play, in sequence, and knows no other") {
    CHECK(sessionPlaybackModes() ==
          std::vector<std::string>{"inOrder", "repeatAll", "repeatOne", "random", "shuffleTracks"});

    for (const auto& name : sessionPlaybackModes()) {
        CAPTURE(name);
        const auto order = sessionOrderNamed(name);
        REQUIRE(order.has_value());
        CHECK(modeNameOf(*order) == name);
    }

    CHECK_FALSE(sessionOrderNamed("shuffleAlbums").has_value());
    CHECK_FALSE(sessionOrderNamed("shuffleFolders").has_value());
    CHECK_FALSE(sessionOrderNamed("").has_value());
}

TEST_CASE("an empty session id and the engine's own name the engine session, for anyone") {
    Sessions sessions;
    const auto now = sessions.now();

    for (const std::string& id : {std::string(), std::string(kEngineSessionId)}) {
        for (const std::string asking : {"phone", ""}) {
            CAPTURE(id);
            CAPTURE(asking);
            const auto answer = sessions.registry.find(id, asking, now);
            CHECK(answer.which == SessionAnswer::Which::engine);
            CHECK(answer.session.get() == nullptr);
        }
    }

    CHECK(std::string(kEngineSessionId) == "engine");
}

TEST_CASE("the engine session cannot be unshared or left away, and nothing reaps it") {
    Sessions sessions;

    CHECK(sessions.registry.share(kEngineSessionId, "phone", false, sessions.now()) ==
          SessionShare::engine);
    CHECK(sessions.registry.share(kEngineSessionId, "phone", true, sessions.now()) ==
          SessionShare::engine);
    CHECK(sessions.registry.leave(kEngineSessionId, "phone", sessions.now()) ==
          SessionAnswer::Which::engine);

    sessions.wait(24h * 365);
    sessions.registry.sweep(sessions.now());
    CHECK(sessions.whichFor(kEngineSessionId, "phone") == SessionAnswer::Which::engine);
}

TEST_CASE("the engine session takes no place under the cap") {
    Sessions one(1);
    CHECK(one.registry.create(device("phone"), one.now()).how == SessionCreation::created);

    Sessions none(0);
    CHECK(none.whichFor(kEngineSessionId, "phone") == SessionAnswer::Which::engine);
}

TEST_CASE("creating past the cap is refused and leaves nothing behind") {
    Sessions sessions(2);
    sessions.createShared("phone");
    sessions.createShared("laptop");

    const auto refused = sessions.registry.create(device("tablet"), sessions.now());
    CHECK(refused.how == SessionCreation::atTheCap);
    CHECK(refused.session.get() == nullptr);

    CHECK(sessions.listedFor("tablet").size() == 2);
    CHECK(sessions.listedFor("").size() == 2);
}

TEST_CASE("a cap of zero refuses every session") {
    Sessions sessions(0);

    const auto refused = sessions.registry.create(device("phone"), sessions.now());
    CHECK(refused.how == SessionCreation::atTheCap);
    CHECK(refused.session.get() == nullptr);
    CHECK(sessions.listedFor("phone").empty());
}

TEST_CASE("a reaped session gives its place under the cap back") {
    Sessions sessions(1);
    sessions.create("phone");
    REQUIRE(sessions.registry.create(device("laptop"), sessions.now()).how ==
            SessionCreation::atTheCap);

    sessions.wait(15min + 1s);
    CHECK(sessions.registry.create(device("laptop"), sessions.now()).how ==
          SessionCreation::created);
}

TEST_CASE("a mint that answers nothing creates nothing and takes no place") {
    Sessions sessions(1, scattered(), failingOnce());

    const auto refused = sessions.registry.create(device("phone"), sessions.now());
    CHECK(refused.how == SessionCreation::noId);
    CHECK(refused.session.get() == nullptr);
    CHECK(sessions.listedFor("phone").empty());

    CHECK(sessions.registry.create(device("phone"), sessions.now()).how ==
          SessionCreation::created);
}

TEST_CASE("a private session is found and listed only for a device in it") {
    Sessions sessions;
    const auto session = sessions.create("phone");

    CHECK(sessions.whichFor(session->id(), "phone") == SessionAnswer::Which::detached);
    CHECK(sessions.registry.find(session->id(), "phone", sessions.now()).session.get() ==
          session.get());
    CHECK(sessions.listedFor("phone") == std::vector<std::string>{session->id()});

    const auto hidden = sessions.registry.find(session->id(), "laptop", sessions.now());
    CHECK(hidden.which == SessionAnswer::Which::none);
    CHECK(hidden.session.get() == nullptr);
    CHECK(sessions.listedFor("laptop").empty());
    CHECK(sessions.listedFor("").empty());

    // Sharing is for a member, and a device that cannot see the session is answered as if it
    // were not there.
    CHECK(sessions.registry.share(session->id(), "laptop", true, sessions.now()) ==
          SessionShare::noSuchSession);
    CHECK_FALSE(session->shared());
}

TEST_CASE("a shared session is found and listed for every device, and for a request naming none") {
    Sessions sessions;
    const auto session = sessions.create("phone");

    CHECK(sessions.registry.share(session->id(), "phone", true, sessions.now()) ==
          SessionShare::done);
    CHECK(session->shared());

    CHECK(sessions.whichFor(session->id(), "laptop") == SessionAnswer::Which::detached);
    CHECK(sessions.whichFor(session->id(), "") == SessionAnswer::Which::detached);
    CHECK(sessions.listedFor("laptop") == std::vector<std::string>{session->id()});
    CHECK(sessions.listedFor("") == std::vector<std::string>{session->id()});
}

TEST_CASE("sessions are listed in the order they were created") {
    Sessions sessions;
    const auto first = sessions.createShared("phone");
    const auto second = sessions.createShared("laptop");
    const auto third = sessions.createShared("tablet");

    CHECK(sessions.listedFor("") ==
          std::vector<std::string>{first->id(), second->id(), third->id()});
}

TEST_CASE("unsharing hides a session again and disconnects nobody listening to it") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 0, now) == PlayerOutcome::done);

    REQUIRE(sessions.joins(session, "laptop"));
    const auto ears = session->listen(device("laptop"), "opus", now);
    REQUIRE(ears);

    CHECK(sessions.registry.share(session->id(), "phone", false, now) == SessionShare::done);
    CHECK_FALSE(session->shared());

    CHECK(sessions.whichFor(session->id(), "tablet") == SessionAnswer::Which::none);
    CHECK(sessions.listedFor("tablet").empty());

    CHECK(session->running());
    REQUIRE(session->audience().roster(now).size() == 1);
    CHECK(session->audience().roster(now)[0].deviceId == "laptop");
    CHECK(session->member("laptop", now));
    CHECK(sessions.whichFor(session->id(), "laptop") == SessionAnswer::Which::detached);
}

TEST_CASE("a session nobody issued is answered exactly as a private one is to a stranger") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();

    const auto hidden = sessions.registry.find(session->id(), "laptop", now);
    const auto missing = sessions.registry.find("session-99", "laptop", now);

    CHECK(missing.which == SessionAnswer::Which::none);
    CHECK(missing.which == hidden.which);
    CHECK(missing.session.get() == hidden.session.get());

    CHECK(sessions.registry.share("session-99", "laptop", true, now) ==
          sessions.registry.share(session->id(), "laptop", true, now));
    CHECK(sessions.registry.leave("session-99", "laptop", now) ==
          sessions.registry.leave(session->id(), "laptop", now));
    CHECK(sessions.registry.leave("session-99", "laptop", now) == SessionAnswer::Which::none);
}

TEST_CASE("the creator is a member from the moment it creates the session") {
    Sessions sessions;
    const auto session = sessions.create("phone");

    CHECK(session->member("phone", sessions.now()));
    CHECK_FALSE(session->member("laptop", sessions.now()));
}

TEST_CASE("naming a shared session in a poll or a share makes a member, and passing does not") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");
    const auto now = sessions.now();

    REQUIRE(sessions.registry.find(session->id(), "laptop", now, Naming::passing).which ==
            SessionAnswer::Which::detached);
    CHECK_FALSE(session->member("laptop", now));

    REQUIRE(sessions.joins(session, "laptop"));
    CHECK(session->member("laptop", now));

    REQUIRE(sessions.registry.share(session->id(), "tablet", true, now) == SessionShare::done);
    CHECK(session->member("tablet", now));
}

TEST_CASE("naming a private session makes nobody a member of it") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();

    CHECK(sessions.registry.find(session->id(), "laptop", now, Naming::joining).which ==
          SessionAnswer::Which::none);
    CHECK_FALSE(session->member("laptop", now));

    // Sharing it later lets the laptop in only once the laptop names it.
    REQUIRE(sessions.registry.share(session->id(), "phone", true, now) == SessionShare::done);
    REQUIRE(sessions.registry.share(session->id(), "phone", false, now) == SessionShare::done);
    CHECK(sessions.whichFor(session->id(), "laptop") == SessionAnswer::Which::none);
}

TEST_CASE("a device that joined while a session was shared stays a member once it is not") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    REQUIRE(sessions.joins(session, "laptop"));
    REQUIRE(sessions.registry.share(session->id(), "phone", false, sessions.now()) ==
            SessionShare::done);

    sessions.wait(5min);
    CHECK(session->member("laptop", sessions.now()));
    CHECK(sessions.whichFor(session->id(), "laptop") == SessionAnswer::Which::detached);
    CHECK(sessions.listedFor("laptop") == std::vector<std::string>{session->id()});
}

TEST_CASE("a request naming no device is nobody's, whatever it does") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");
    const auto now = sessions.now();

    CHECK(sessions.registry.find(session->id(), "", now, Naming::joining).which ==
          SessionAnswer::Which::detached);
    CHECK(sessions.registry.share(session->id(), "", true, now) == SessionShare::done);
    session->seen("", now);
    const auto ears = session->listen(DeviceIdentity{}, "opus", now);
    REQUIRE(ears);
    CHECK_FALSE(session->member("", now));

    REQUIRE(sessions.registry.share(session->id(), "phone", false, now) == SessionShare::done);
    CHECK(sessions.whichFor(session->id(), "") == SessionAnswer::Which::none);
}

TEST_CASE("a controller stops being a member when its grace runs out, and a poll extends it") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");
    const auto created = sessions.now();

    CHECK(session->member("phone", created + 15min - 1s));
    CHECK_FALSE(session->member("phone", created + 15min + 1s));

    sessions.wait(10min);
    REQUIRE(sessions.joins(session, "phone"));
    CHECK(session->member("phone", created + 25min - 1s));
    CHECK_FALSE(session->member("phone", created + 25min + 1s));
}

TEST_CASE("a listener stays a member through its linger after its grace has run out") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    REQUIRE(sessions.joins(session, "laptop"));
    {
        const auto ears = session->listen(device("laptop"), "opus", sessions.now());
        REQUIRE(ears);
        sessions.wait(20min);
        CHECK(session->member("laptop", sessions.now()));
    }
    const auto released = sessions.now();

    CHECK(session->member("laptop", released + 29s));
    CHECK_FALSE(session->member("laptop", released + 31s));
}

TEST_CASE("a member who both controlled and listened stays until the later of the two runs out") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto created = sessions.now();

    {
        const auto ears = session->listen(device("phone"), "opus", created);
        REQUIRE(ears);
        sessions.wait(1min);
    }

    CHECK(session->member("phone", created + 10min));
    CHECK_FALSE(session->member("phone", created + 15min + 1s));
}

namespace {

std::string visitor(size_t n) {
    return "device-" + std::to_string(n);
}

// The creator, then visitors 1 to 63 naming the session a second apart: as many devices as a
// session remembers, the creator the least recently seen of them.
std::shared_ptr<Session> rememberingAll(Sessions& sessions) {
    const auto session = sessions.createShared("phone");
    for (size_t n = 1; n < kMaxSessionControllers; ++n) {
        sessions.wait(1s);
        REQUIRE(sessions.joins(session, visitor(n)));
    }
    return session;
}

}  // namespace

TEST_CASE("a session remembers at most 64 devices and forgets the least recently seen first") {
    CHECK(kMaxSessionControllers == 64);

    Sessions sessions;
    const auto session = rememberingAll(sessions);

    sessions.wait(1s);
    REQUIRE(sessions.joins(session, visitor(kMaxSessionControllers)));

    CHECK_FALSE(session->member("phone", sessions.now()));
    for (size_t n = 1; n <= kMaxSessionControllers; ++n) {
        CAPTURE(n);
        CHECK(session->member(visitor(n), sessions.now()));
    }
}

TEST_CASE("a device the session already remembers naming it again makes it forget nobody") {
    Sessions sessions;
    const auto session = rememberingAll(sessions);

    sessions.wait(1s);
    REQUIRE(sessions.joins(session, visitor(1)));

    CHECK(session->member("phone", sessions.now()));
    for (size_t n = 1; n < kMaxSessionControllers; ++n) {
        CAPTURE(n);
        CHECK(session->member(visitor(n), sessions.now()));
    }
}

TEST_CASE("a device forgotten while it listens is still a member, and nobody is forgotten for it") {
    Sessions sessions;
    const auto session = rememberingAll(sessions);
    const auto listening = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(listening);

    sessions.wait(1s);
    REQUIRE(sessions.joins(session, visitor(kMaxSessionControllers)));

    CHECK(session->member("phone", sessions.now()));
    for (size_t n = 1; n <= kMaxSessionControllers; ++n) {
        CAPTURE(n);
        CHECK(session->member(visitor(n), sessions.now()));
    }
}

TEST_CASE("the controlling grace is fifteen minutes") {
    CHECK(kControllingGrace == std::chrono::minutes(15));
}

TEST_CASE("a session decodes only while it plays to a connected listener") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();

    REQUIRE(session->play(tracks(3), 0, now) == PlayerOutcome::done);
    CHECK_FALSE(session->running());

    {
        const auto ears = session->listen(device("phone"), "opus", now);
        REQUIRE(ears);
        CHECK(session->running());

        session->playPause(now);
        CHECK_FALSE(session->running());
        session->playPause(now);
        CHECK(session->running());
    }

    // The linger is for a reconnect, and nobody hears what is decoded through it.
    REQUIRE(session->audience().anyListening(now));
    CHECK_FALSE(session->running());

    const auto back = session->listen(device("phone"), "opus", now);
    REQUIRE(back);
    session->stop(now);
    CHECK_FALSE(session->running());
}

TEST_CASE("a session's position stands still while nobody is listening") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto started = sessions.now();

    REQUIRE(session->play(tracks(3), 0, started) == PlayerOutcome::done);
    session->began(session->turn()->serial, 300, started);

    sessions.wait(60s);
    CHECK(heard(session->state(sessions.now()), sessions.now()) == doctest::Approx(0));

    {
        const auto ears = session->listen(device("phone"), "opus", sessions.now());
        REQUIRE(ears);
        sessions.wait(10s);
        CHECK(heard(session->state(sessions.now()), sessions.now()) == doctest::Approx(10));
    }

    sessions.wait(20s);
    CHECK(heard(session->state(sessions.now()), sessions.now()) == doctest::Approx(10));
}

namespace {

// Further than any track runs, as a client may send it.
constexpr double kFarPastAnyLength = 1e300;

constexpr double kLength = 240;

void namedWithLength(Session& session, double length) {
    session.named(session.turn()->serial, "A Title", "An Artist", "A Record", "An Artist", length);
}

double positionOf(const Session& session, Time now) {
    return session.state(now).position.seconds;
}

}  // namespace

// Nothing says how long the track is until its names are read or a decoder opens it, so there is
// nothing to hold a seek to.
TEST_CASE("a seek before the track's length is known is held where it was asked") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 0, now) == PlayerOutcome::done);

    session->seek(kFarPastAnyLength, false, now);
    CHECK(positionOf(*session, now) == doctest::Approx(kFarPastAnyLength));
    CHECK(session->turn()->from == doctest::Approx(kFarPastAnyLength));

    namedWithLength(*session, 0);
    CHECK(positionOf(*session, now) == doctest::Approx(kFarPastAnyLength));
}

// A decoder told to start past the end makes foobar2000's input throw, and a good file is then
// reported undecodable and skipped.
TEST_CASE("a position past the length the names give is brought back to that length") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 0, now) == PlayerOutcome::done);
    session->seek(kFarPastAnyLength, false, now);

    namedWithLength(*session, kLength);

    CHECK(positionOf(*session, now) == doctest::Approx(kLength));
    CHECK(session->turn()->from == doctest::Approx(kLength));
}

TEST_CASE(
    "a position past the length the decoder gives is brought back, and the turn starts there") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 0, now) == PlayerOutcome::done);
    session->seek(kFarPastAnyLength, false, now);

    session->began(session->turn()->serial, kLength, now);

    CHECK(positionOf(*session, now) == doctest::Approx(kLength));
    CHECK(session->turn()->from == doctest::Approx(kLength));
}

TEST_CASE("a position inside the length stays where it is when the length arrives either way") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 0, now) == PlayerOutcome::done);
    session->seek(42, false, now);

    namedWithLength(*session, kLength);
    CHECK(positionOf(*session, now) == doctest::Approx(42));
    CHECK(session->turn()->from == doctest::Approx(42));

    session->began(session->turn()->serial, kLength, now);
    CHECK(positionOf(*session, now) == doctest::Approx(42));
    CHECK(session->turn()->from == doctest::Approx(42));
}

TEST_CASE("a relative seek back past the start lands at the start") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 0, now) == PlayerOutcome::done);
    session->seek(42, false, now);

    session->seek(-100, true, now);

    CHECK(positionOf(*session, now) == doctest::Approx(0));
    CHECK(session->turn()->from == doctest::Approx(0));
}

TEST_CASE("a session nobody controls or hears is reaped once its grace has run out") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    sessions.wait(15min - 1s);
    sessions.registry.sweep(sessions.now());
    CHECK_FALSE(session->expired(sessions.now()));
    CHECK(sessions.exists(session));

    sessions.wait(2s);
    CHECK(session->expired(sessions.now()));
    sessions.registry.sweep(sessions.now());
    CHECK(session->listen(device("laptop"), "opus", sessions.now()) == nullptr);
    CHECK_FALSE(sessions.exists(session));
    CHECK(sessions.listedFor("").empty());
}

TEST_CASE("a session outlives its controllers' grace for as long as a listener lingers") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    {
        const auto ears = session->listen(device("laptop"), "opus", sessions.now());
        REQUIRE(ears);
        sessions.wait(20min);
        sessions.registry.sweep(sessions.now());
        CHECK(sessions.exists(session));
    }

    sessions.wait(29s);
    sessions.registry.sweep(sessions.now());
    CHECK(sessions.exists(session));

    sessions.wait(2s);
    sessions.registry.sweep(sessions.now());
    CHECK_FALSE(sessions.exists(session));
}

TEST_CASE("a session held by a caller takes no listener once a sweep finds its linger run out") {
    Sessions sessions;
    const auto session = sessions.create("phone");

    {
        const auto ears = session->listen(device("phone"), "opus", sessions.now());
        REQUIRE(ears);
        sessions.wait(20min);
    }

    sessions.wait(31s);
    sessions.registry.sweep(sessions.now());
    CHECK(session->listen(device("phone"), "opus", sessions.now()) == nullptr);
}

// The registry asks this as one step, so a listen on a held session cannot land between the
// check and the close and leave a listener on a session the registry has let go.
TEST_CASE("closing a session if it has expired closes an expired one and only an expired one") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    CHECK_FALSE(session->closeIfExpired(sessions.now()));

    auto ears = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(ears);
    sessions.wait(20min);
    CHECK_FALSE(session->closeIfExpired(sessions.now()));

    ears.reset();
    sessions.wait(29s);
    CHECK_FALSE(session->closeIfExpired(sessions.now()));
    {
        const auto back = session->listen(device("phone"), "opus", sessions.now());
        CHECK(back);
    }

    sessions.wait(31s);
    CHECK(session->closeIfExpired(sessions.now()));
    CHECK(session->listen(device("phone"), "opus", sessions.now()) == nullptr);
}

TEST_CASE("a poll inside the grace keeps a session another fifteen minutes") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    sessions.wait(14min);
    REQUIRE(sessions.joins(session, "phone"));

    sessions.wait(15min - 1s);
    sessions.registry.sweep(sessions.now());
    CHECK(sessions.exists(session));

    sessions.wait(2s);
    sessions.registry.sweep(sessions.now());
    CHECK_FALSE(sessions.exists(session));
}

TEST_CASE("a reconnect inside the linger keeps a session its listener was the only member of") {
    Sessions sessions;
    const auto session = sessions.create("phone");

    {
        const auto ears = session->listen(device("phone"), "opus", sessions.now());
        REQUIRE(ears);
        sessions.wait(20min);
    }

    // Swept in the gap, as any other request arriving then would.
    sessions.wait(5s);
    sessions.registry.sweep(sessions.now());

    sessions.wait(5s);
    const auto back = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(back);
    CHECK(sessions.registry.find(session->id(), "phone", sessions.now()).which ==
          SessionAnswer::Which::detached);

    sessions.wait(1h);
    sessions.registry.sweep(sessions.now());
    CHECK(sessions.registry.find(session->id(), "phone", sessions.now()).which ==
          SessionAnswer::Which::detached);
}

TEST_CASE("leaving ends a device's grace and linger while the session goes on for the others") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    REQUIRE(sessions.joins(session, "laptop"));
    {
        const auto ears = session->listen(device("laptop"), "opus", sessions.now());
        REQUIRE(ears);
        sessions.wait(1min);
    }

    CHECK(sessions.registry.leave(session->id(), "laptop", sessions.now()) ==
          SessionAnswer::Which::detached);
    CHECK_FALSE(session->member("laptop", sessions.now()));
    CHECK(session->member("phone", sessions.now()));
    CHECK(sessions.exists(session));
}

TEST_CASE("a session is reaped at once when its last member leaves on purpose") {
    Sessions sessions(1);
    const auto session = sessions.createShared("phone");

    {
        const auto ears = session->listen(device("phone"), "opus", sessions.now());
        REQUIRE(ears);
        sessions.wait(1min);
    }

    CHECK(sessions.registry.leave(session->id(), "phone", sessions.now()) ==
          SessionAnswer::Which::detached);

    // Asked before anything else reaches the registry, since every other call sweeps first and
    // would reap it then. A reaped session takes no listener.
    CHECK(session->listen(device("laptop"), "opus", sessions.now()) == nullptr);

    CHECK_FALSE(sessions.exists(session));
    CHECK(sessions.registry.create(device("laptop"), sessions.now()).how ==
          SessionCreation::created);
}

TEST_CASE("a leave reaps nothing while a controller inside its grace remains") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    REQUIRE(sessions.joins(session, "laptop"));
    sessions.wait(1min);

    sessions.registry.leave(session->id(), "phone", sessions.now());
    CHECK(sessions.exists(session));
    CHECK(session->member("laptop", sessions.now()));
}

TEST_CASE("a leave reaps nothing while a listener is connected, past every grace") {
    Sessions sessions;
    const auto session = sessions.createShared("phone");

    REQUIRE(sessions.joins(session, "laptop"));
    const auto ears = session->listen(device("laptop"), "opus", sessions.now());
    REQUIRE(ears);

    sessions.wait(20min);
    REQUIRE(sessions.joins(session, "phone"));
    sessions.registry.leave(session->id(), "phone", sessions.now());

    CHECK(sessions.exists(session));
    CHECK(session->member("laptop", sessions.now()));
}

TEST_CASE("a device still connected stays in a session after it leaves") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto ears = session->listen(device("phone"), "opus", sessions.now());
    REQUIRE(ears);

    CHECK(sessions.registry.leave(session->id(), "phone", sessions.now()) ==
          SessionAnswer::Which::detached);
    CHECK(session->member("phone", sessions.now()));

    sessions.wait(20min);
    CHECK(sessions.whichFor(session->id(), "phone") == SessionAnswer::Which::detached);
    REQUIRE(session->audience().roster(sessions.now()).size() == 1);
}

TEST_CASE("a device leaving a session it was never in reaps nothing") {
    Sessions sessions;
    const auto shared = sessions.createShared("phone");
    const auto hidden = sessions.create("laptop");

    sessions.registry.leave(shared->id(), "tablet", sessions.now());
    CHECK(sessions.exists(shared));

    CHECK(sessions.registry.leave(hidden->id(), "tablet", sessions.now()) ==
          SessionAnswer::Which::none);
    CHECK(sessions.whichFor(hidden->id(), "laptop") == SessionAnswer::Which::detached);
}

namespace {

std::shared_ptr<Audience::Membership> listening(Session& session, Time now) {
    auto ears = session.listen(device("phone"), "opus", now);
    REQUIRE(ears);
    return ears;
}

PlaybackState playbackOf(const Session& session, Time now) {
    return session.state(now).playback;
}

}  // namespace

TEST_CASE(
    "a session set to play reads paused while nobody listens, and playing while somebody does") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    REQUIRE(session->play(tracks(3), 1, sessions.now()) == PlayerOutcome::done);
    session->began(session->turn()->serial, 300, sessions.now());

    sessions.wait(60s);
    CHECK(playbackOf(*session, sessions.now()) == PlaybackState::paused);
    CHECK(heard(session->state(sessions.now()), sessions.now()) == doctest::Approx(0));
    CHECK(session->turn().has_value());
    CHECK_FALSE(session->running());

    auto ears = listening(*session, sessions.now());
    CHECK(playbackOf(*session, sessions.now()) == PlaybackState::playing);
    sessions.wait(10s);
    CHECK(heard(session->state(sessions.now()), sessions.now()) == doctest::Approx(10));

    ears.reset();
    REQUIRE(session->audience().anyListening(sessions.now()));
    CHECK(playbackOf(*session, sessions.now()) == PlaybackState::paused);

    sessions.wait(20s);
    CHECK(playbackOf(*session, sessions.now()) == PlaybackState::paused);
    CHECK(heard(session->state(sessions.now()), sessions.now()) == doctest::Approx(10));
}

TEST_CASE("a session its controller paused reads paused whether or not a connection listens") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 1, now) == PlayerOutcome::done);

    auto ears = listening(*session, now);
    session->playPause(now);
    CHECK(playbackOf(*session, now) == PlaybackState::paused);

    ears.reset();
    CHECK(playbackOf(*session, now) == PlaybackState::paused);

    ears = listening(*session, now);
    CHECK(playbackOf(*session, now) == PlaybackState::paused);
    CHECK_FALSE(session->running());
}

TEST_CASE("a stopped session reads stopped whether or not a connection listens") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();

    auto ears = listening(*session, now);
    CHECK(playbackOf(*session, now) == PlaybackState::stopped);

    REQUIRE(session->play(tracks(3), 1, now) == PlayerOutcome::done);
    session->stop(now);
    CHECK(playbackOf(*session, now) == PlaybackState::stopped);

    ears.reset();
    CHECK(playbackOf(*session, now) == PlaybackState::stopped);
}

// Pressed once: a press that paused would leave the session paused for the listener arriving next.
TEST_CASE(
    "play-pause on a session that reads paused only because nobody listens leaves it set to play") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 1, now) == PlayerOutcome::done);

    session->playPause(now);
    CHECK(playbackOf(*session, now) == PlaybackState::paused);
    CHECK(rowPlaying(*session, tracks(3)) == size_t{1});

    const auto ears = listening(*session, now);
    CHECK(playbackOf(*session, now) == PlaybackState::playing);
    CHECK(session->running());
}

TEST_CASE(
    "play-pause on a session its controller paused sets it to play, read paused until heard") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 1, now) == PlayerOutcome::done);

    auto ears = listening(*session, now);
    session->playPause(now);
    REQUIRE(playbackOf(*session, now) == PlaybackState::paused);

    session->playPause(now);
    CHECK(playbackOf(*session, now) == PlaybackState::playing);

    session->playPause(now);
    REQUIRE(playbackOf(*session, now) == PlaybackState::paused);
    ears.reset();

    session->playPause(now);
    CHECK(playbackOf(*session, now) == PlaybackState::paused);
    CHECK(rowPlaying(*session, tracks(3)) == size_t{1});
    CHECK_FALSE(session->running());

    ears = listening(*session, now);
    CHECK(playbackOf(*session, now) == PlaybackState::playing);
    CHECK(session->running());
}

TEST_CASE(
    "play-pause on a session reading playing pauses it, and it stays paused for a reconnect") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    REQUIRE(session->play(tracks(3), 1, now) == PlayerOutcome::done);

    auto ears = listening(*session, now);
    REQUIRE(playbackOf(*session, now) == PlaybackState::playing);

    session->playPause(now);
    CHECK(playbackOf(*session, now) == PlaybackState::paused);

    ears.reset();
    ears = listening(*session, now);
    CHECK(playbackOf(*session, now) == PlaybackState::paused);
    CHECK_FALSE(session->running());
}

namespace {

constexpr double kJustUnderThree = 2.999;
constexpr double kExactlyThree = 3;
constexpr double kJustOverThree = 3.001;

constexpr double kWellIn = 10;

const SessionOrder kEveryOrder[]{SessionOrder::inOrder, SessionOrder::repeatAll,
                                 SessionOrder::repeatOne, SessionOrder::random,
                                 SessionOrder::shuffleTracks};

}  // namespace

TEST_CASE("previous restarts a track once it is more than three seconds in") {
    CHECK(kPreviousRestartsAfter == std::chrono::seconds(3));
}

TEST_CASE("previous more than three seconds into a track starts it again as a new turn from 0") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    const auto songs = tracks(5);
    REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
    session->seek(kWellIn, false, now);
    const auto seeked = session->turn();
    REQUIRE(seeked.has_value());

    session->previous(now);

    const auto restarted = session->turn();
    REQUIRE(restarted.has_value());
    CHECK(restarted->track.path == songs[2].path);
    CHECK(restarted->serial != seeked->serial);
    CHECK(restarted->cut);
    CHECK(restarted->from == doctest::Approx(0));
    CHECK(session->state(now).position.seconds == doctest::Approx(0));
}

TEST_CASE("previous goes back at three seconds in or less, and restarts the track just past it") {
    const auto songs = tracks(5);
    const std::pair<double, size_t> table[]{
        {kJustUnderThree, 1}, {kExactlyThree, 1}, {kJustOverThree, 2}};

    for (const auto& asked : table) {
        const double position = asked.first;
        const size_t row = asked.second;
        CAPTURE(position);
        Sessions sessions;
        const auto session = sessions.create("phone");
        const auto now = sessions.now();
        REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
        session->seek(position, false, now);

        session->previous(now);
        CHECK(rowPlaying(*session, songs) == row);
    }
}

TEST_CASE("a position a listener heard counts toward the three seconds as a seek's does") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto songs = tracks(5);
    REQUIRE(session->play(songs, 2, sessions.now()) == PlayerOutcome::done);
    session->began(session->turn()->serial, 300, sessions.now());
    const auto ears = listening(*session, sessions.now());

    sessions.wait(4s);
    session->previous(sessions.now());
    CHECK(rowPlaying(*session, songs) == size_t{2});
    CHECK(heard(session->state(sessions.now()), sessions.now()) == doctest::Approx(0));

    sessions.wait(2s);
    session->previous(sessions.now());
    CHECK(rowPlaying(*session, songs) == size_t{1});
}

TEST_CASE("previous more than three seconds into a paused track restarts it and plays it") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto songs = tracks(5);
    REQUIRE(session->play(songs, 2, sessions.now()) == PlayerOutcome::done);
    session->began(session->turn()->serial, 300, sessions.now());
    const auto ears = listening(*session, sessions.now());
    sessions.wait(10s);
    session->playPause(sessions.now());
    REQUIRE(playbackOf(*session, sessions.now()) == PlaybackState::paused);

    session->previous(sessions.now());

    CHECK(rowPlaying(*session, songs) == size_t{2});
    CHECK(session->turn()->from == doctest::Approx(0));
    CHECK(playbackOf(*session, sessions.now()) == PlaybackState::playing);
}

TEST_CASE("restarting a track leaves what plays after it as it was, under every order") {
    const auto songs = tracks(5);

    for (const auto order : kEveryOrder) {
        CAPTURE(modeNameOf(order));
        Sessions restartedOnes(kMaxSessions, countingUp());
        Sessions untouchedOnes(kMaxSessions, countingUp());
        const auto restarted = restartedOnes.create("phone");
        const auto untouched = untouchedOnes.create("phone");
        const auto now = restartedOnes.now();

        for (const auto& session : {restarted, untouched}) {
            session->setOrder(order);
            REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
        }
        restarted->seek(kWellIn, false, now);
        restarted->previous(now);

        CHECK(rowsPlayed(*restarted, songs, 8, now) == rowsPlayed(*untouched, songs, 8, now));
    }
}

TEST_CASE("previous goes back a row, holding the first under in order and wrapping under repeats") {
    const auto songs = tracks(5);
    const std::pair<SessionOrder, size_t> fromTheFirst[]{
        {SessionOrder::inOrder, 0}, {SessionOrder::repeatAll, 4}, {SessionOrder::repeatOne, 4}};

    for (const auto& asked : fromTheFirst) {
        const SessionOrder order = asked.first;
        const size_t wrapped = asked.second;
        CAPTURE(modeNameOf(order));
        Sessions sessions;
        const auto session = sessions.create("phone");
        const auto now = sessions.now();
        session->setOrder(order);

        REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
        session->previous(now);
        CHECK(rowPlaying(*session, songs) == size_t{1});

        REQUIRE(session->play(songs, 0, now) == PlayerOutcome::done);
        session->previous(now);
        CHECK(rowPlaying(*session, songs) == wrapped);
    }
}

TEST_CASE("previous under shuffle walks back along the rows it played and stays on the first") {
    const auto songs = tracks(5);

    for (const auto& script : {countingUp, countingDown, scattered}) {
        Sessions sessions(kMaxSessions, script());
        const auto session = sessions.create("phone");
        const auto now = sessions.now();
        session->setOrder(SessionOrder::shuffleTracks);
        REQUIRE(session->play(songs, 3, now) == PlayerOutcome::done);

        const auto walked = rowsPlayed(*session, songs, 2, now);
        REQUIRE(walked.size() == 2);
        REQUIRE(walked[0] == 3);

        const std::vector<size_t> expected{walked[1], walked[0], walked[0]};
        std::vector<size_t> back;
        for (size_t step = 0; step < expected.size(); ++step) {
            session->previous(now);
            back.push_back(rowPlaying(*session, songs).value_or(songs.size()));
        }
        CHECK(back == expected);
    }
}

TEST_CASE("previous under random draws its row afresh from the session's source") {
    const auto songs = tracks(5);
    std::vector<size_t> drawn;

    for (const auto& script : {countingUp, countingDown}) {
        Sessions sessions(kMaxSessions, script());
        const auto session = sessions.create("phone");
        const auto now = sessions.now();
        session->setOrder(SessionOrder::random);
        REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);

        session->previous(now);
        const auto row = rowPlaying(*session, songs);
        REQUIRE(row.has_value());
        drawn.push_back(row.value_or(0));
    }

    CHECK(drawn[0] != drawn[1]);
}

TEST_CASE("previous on a stopped session goes back a row and starts it") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    const auto songs = tracks(5);
    REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
    session->seek(kWellIn, false, now);
    session->stop(now);

    session->previous(now);

    CHECK(rowPlaying(*session, songs) == size_t{1});
    const auto ears = listening(*session, now);
    CHECK(playbackOf(*session, now) == PlaybackState::playing);
}

TEST_CASE("next on in order's last row wraps to the first, and under repeat one moves on a row") {
    const auto songs = tracks(5);
    const std::pair<SessionOrder, size_t> fromTheLast[]{{SessionOrder::inOrder, 0},
                                                        {SessionOrder::repeatOne, 0}};

    for (const auto& asked : fromTheLast) {
        const SessionOrder order = asked.first;
        const size_t wrapped = asked.second;
        CAPTURE(modeNameOf(order));
        Sessions sessions;
        const auto session = sessions.create("phone");
        const auto now = sessions.now();
        session->setOrder(order);

        REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
        session->next(now);
        CHECK(rowPlaying(*session, songs) == size_t{3});

        REQUIRE(session->play(songs, 4, now) == PlayerOutcome::done);
        session->next(now);
        CHECK(rowPlaying(*session, songs) == wrapped);
    }
}

TEST_CASE("next under repeat all, shuffle and random moves as a track's end does") {
    const auto songs = tracks(4);

    for (const auto order :
         {SessionOrder::repeatAll, SessionOrder::shuffleTracks, SessionOrder::random}) {
        CAPTURE(modeNameOf(order));
        Sessions skippedOnes(kMaxSessions, scattered());
        Sessions endedOnes(kMaxSessions, scattered());
        const auto skipped = skippedOnes.create("phone");
        const auto ended = endedOnes.create("phone");
        const auto now = skippedOnes.now();

        for (const auto& session : {skipped, ended}) {
            session->setOrder(order);
            REQUIRE(session->play(songs, 1, now) == PlayerOutcome::done);
        }

        std::vector<size_t> bySkipping;
        std::vector<size_t> byEnding;
        for (size_t step = 0; step < 2 * songs.size(); ++step) {
            skipped->next(now);
            ended->ended(ended->turn()->serial, now);
            bySkipping.push_back(rowPlaying(*skipped, songs).value_or(songs.size()));
            byEnding.push_back(rowPlaying(*ended, songs).value_or(songs.size()));
        }
        CHECK(bySkipping == byEnding);
    }
}

TEST_CASE("next and previous on a paused or a stopped session with something to play start it") {
    const auto songs = tracks(5);

    for (const bool stopping : {false, true}) {
        for (const bool forward : {true, false}) {
            CAPTURE(stopping);
            CAPTURE(forward);
            Sessions sessions;
            const auto session = sessions.create("phone");
            const auto now = sessions.now();
            REQUIRE(session->play(songs, 2, now) == PlayerOutcome::done);
            const auto ears = listening(*session, now);

            if (stopping)
                session->stop(now);
            else
                session->playPause(now);
            REQUIRE(playbackOf(*session, now) != PlaybackState::playing);

            if (forward)
                session->next(now);
            else
                session->previous(now);

            CHECK(playbackOf(*session, now) == PlaybackState::playing);
            CHECK(rowPlaying(*session, songs) == (forward ? size_t{3} : size_t{1}));
        }
    }
}

TEST_CASE("next and previous on a session with nothing to play change nothing") {
    Sessions sessions;
    const auto session = sessions.create("phone");
    const auto now = sessions.now();
    const auto version = session->revisions().version;

    session->next(now);
    session->previous(now);

    CHECK(playbackOf(*session, now) == PlaybackState::stopped);
    CHECK_FALSE(session->turn().has_value());
    CHECK(session->revisions().version == version);
}

TEST_CASE("a shuffle pass a next ends gives way to one that starts on another row") {
    for (const size_t count : {size_t{2}, size_t{3}, size_t{5}}) {
        for (const auto& script : {countingUp, countingDown, scattered}) {
            CAPTURE(count);
            const auto songs = tracks(count);
            Sessions sessions(kMaxSessions, script());
            const auto session = sessions.create("phone");
            const auto now = sessions.now();
            session->setOrder(SessionOrder::shuffleTracks);
            REQUIRE(session->play(songs, 0, now) == PlayerOutcome::done);

            const size_t passes = 8;
            std::vector<size_t> played{0};
            for (size_t step = 1; step < passes * count; ++step) {
                session->next(now);
                played.push_back(rowPlaying(*session, songs).value_or(count));
            }

            CHECK(std::adjacent_find(played.begin(), played.end()) == played.end());
            for (size_t pass = 0; pass < passes; ++pass) {
                CAPTURE(pass);
                const auto from = played.begin() + static_cast<std::ptrdiff_t>(pass * count);
                CHECK(everyRowOnce({from, from + static_cast<std::ptrdiff_t>(count)}, count));
            }
        }
    }
}
