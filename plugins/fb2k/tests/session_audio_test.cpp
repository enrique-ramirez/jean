// What a detached session asks of foobar2000's ReplayGain and DSP chain, and what it does when
// either fails. A wrong answer here is a session louder than the speakers, a crossfade at the wrong
// boundary, a lyric a block late, or a stop reported as a broken track.

#include "third_party/doctest.h"

#include "core/audience.h"
#include "core/player_outcome.h"
#include "core/session.h"
#include "core/session_audio.h"

#include "support/test_server.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <functional>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
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

SessionRandom countingUp() {
    const auto drawn = std::make_shared<size_t>(0);
    return [drawn](size_t bound) { return (*drawn)++ % bound; };
}

// Each row carries all three things a report names, each different from row to row.
std::vector<SessionTrack> rows(size_t count) {
    std::vector<SessionTrack> made(count);
    for (size_t row = 0; row < count; ++row) {
        made[row].path = "F:\\Music\\Someone\\" + std::to_string(row) + ".cue";
        made[row].subsong = static_cast<uint32_t>(row + 3);
        made[row].libraryPath = "Someone/A Record/" + std::to_string(row) + ".cue";
    }
    return made;
}

SessionTrack queuedTrack(const std::string& name) {
    SessionTrack made;
    made.path = "queued " + name;
    return made;
}

struct Sessions {
    Sessions() : engine(8, 30s, [this] { return clock.now(); }) {
        clock.advance(kLongAfterBoot);
    }

    Time now() const { return clock.now(); }

    std::shared_ptr<Session> create(SessionRandom random = countingUp()) {
        return std::make_shared<Session>("session-" + std::to_string(++made),
                                         DeviceIdentity{"phone", {}}, engine, std::move(random),
                                         now());
    }

    std::shared_ptr<Session> playing(size_t count, size_t row = 0,
                                     SessionOrder order = SessionOrder::inOrder) {
        auto session = create();
        session->setOrder(order);
        REQUIRE(session->play(rows(count), row, now()) == PlayerOutcome::done);
        session->began(serial(*session), 300, now());
        return session;
    }

    static uint64_t serial(const Session& session) {
        const auto turn = session.turn();
        REQUIRE(turn.has_value());
        return turn->serial;
    }

    ManualClock clock;
    Audience engine;
    int made = 0;
};

std::optional<std::string> pathPlaying(const Session& session) {
    const auto turn = session.turn();
    if (!turn)
        return std::nullopt;
    return turn->track.path;
}

std::string pathOf(size_t row) {
    return rows(row + 1)[row].path;
}

struct Stream {
    double time = 0;

    std::optional<StreamMark> write(MarkPlacer& placer, double blockSeconds) {
        auto mark = placer.take(blockSeconds);
        if (mark)
            mark->at = time;
        time += blockSeconds;
        return mark;
    }
};

}  // namespace

TEST_CASE("following the playback order, a session's own order picks track or album gain") {
    const std::pair<SessionOrder, GainSource> table[]{
        {SessionOrder::inOrder, GainSource::album},
        {SessionOrder::repeatAll, GainSource::album},
        {SessionOrder::repeatOne, GainSource::track},
        {SessionOrder::shuffleTracks, GainSource::track},
        {SessionOrder::random, GainSource::track},
    };

    for (const auto& row : table) {
        CAPTURE(modeNameOf(row.first));
        CHECK(replayGainSourceFor(GainSetting::byPlaybackOrder, row.first) == row.second);
    }
}

TEST_CASE("a ReplayGain source chosen outright is handed on unchanged under every order") {
    const std::pair<GainSetting, GainSource> settings[]{
        {GainSetting::none, GainSource::none},
        {GainSetting::track, GainSource::track},
        {GainSetting::album, GainSource::album},
    };

    for (const auto& order : sessionPlaybackModes()) {
        CAPTURE(order);
        const auto parsed = sessionOrderNamed(order);
        REQUIRE(parsed.has_value());
        for (const auto& row : settings)
            CHECK(replayGainSourceFor(row.first, parsed.value_or(SessionOrder::inOrder)) ==
                  row.second);
    }
}

TEST_CASE("each run of the chain carries exactly the flags its row of the table gives") {
    struct Row {
        const char* name;
        ChainRun run;
        bool endOfTrack;
        bool handBack;
        bool flushFirst;
    };

    const Row table[]{
        {"audio", ChainRun::audio, false, false, false},
        {"a track's end, another following", ChainRun::trackEnd, true, false, false},
        {"the last track's end", ChainRun::lastTrackEnd, true, true, false},
        {"the first block after a seek, skip or stop", ChainRun::afterCut, false, false, true},
    };

    for (const Row& row : table) {
        CAPTURE(row.name);
        const ChainFlags flags = chainFlagsFor(row.run);
        CHECK(flags.endOfTrack == row.endOfTrack);
        CHECK(flags.handBack == row.handBack);
        CHECK(flags.flushFirst == row.flushFirst);
    }
}

// The decoder picks the row from Turn::cut: false only where the track before ran out into this
// one, which is the one boundary a gapless chain must not be flushed across.
TEST_CASE("a turn the track before ran out into carries no cut, and every other turn carries one") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(4);
    CHECK(session->turn()->cut);

    REQUIRE(session->ended(Sessions::serial(*session), now));
    CHECK_FALSE(session->turn()->cut);

    session->enqueue({queuedTrack("a")});
    REQUIRE(session->ended(Sessions::serial(*session), now));
    REQUIRE(pathPlaying(*session) == "queued a");
    CHECK_FALSE(session->turn()->cut);

    session->seek(30, false, now);
    CHECK(session->turn()->cut);

    REQUIRE(session->ended(Sessions::serial(*session), now));
    REQUIRE_FALSE(session->turn()->cut);
    session->stop(now);
    session->playPause(now);
    CHECK(session->turn()->cut);

    REQUIRE(session->ended(Sessions::serial(*session), now));
    REQUIRE_FALSE(session->turn()->cut);
    REQUIRE(session->play(rows(4), 2, now) == PlayerOutcome::done);
    CHECK(session->turn()->cut);

    // A track that will not decode did not run out into the next one.
    session->began(Sessions::serial(*session), 300, now);
    REQUIRE(session->threw(Sessions::serial(*session), Thrower::decoder, now) ==
            AfterThrow::skipTrack);
    CHECK(session->turn()->cut);
}

TEST_CASE("a turn's mark names its track and the position the turn starts from") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(3, 1);

    const auto fromStart = markOf(*session->turn());
    CHECK(fromStart.path == pathOf(1));
    CHECK(fromStart.subsong == 4);
    CHECK(fromStart.position == 0.0);

    session->seek(95.5, false, now);
    const auto afterSeek = markOf(*session->turn());
    CHECK(afterSeek.path == pathOf(1));
    CHECK(afterSeek.subsong == 4);
    CHECK(afterSeek.position == 95.5);
}

// Every length below is a binary fraction, so the sums the identity rests on are exact.
TEST_CASE("a mark lands later than the turn's first sample by the latency the chain answered") {
    struct Example {
        const char* name;
        double from;
        double latency;
    };

    const Example examples[]{
        {"a turn from the start, through a chain with latency", 0.0, 0.5},
        {"a turn from mid-track after a seek", 95.5, 0.25},
        {"a chain with no latency", 12.0, 0.0},
    };

    for (const Example& example : examples) {
        CAPTURE(example.name);
        MarkPlacer placer;
        Stream stream;

        // The track before, still playing out.
        for (int i = 0; i < 3; ++i)
            CHECK_FALSE(stream.write(placer, 0.25).has_value());

        StreamMark mark;
        mark.path = "next.flac";
        mark.position = example.from;
        const double firstSample = stream.time;
        placer.pending(mark, example.latency);

        std::optional<StreamMark> laid;
        double laidOnBlockAt = 0;
        for (int i = 0; i < 8 && !laid; ++i) {
            laidOnBlockAt = stream.time;
            laid = stream.write(placer, 0.25);
        }

        REQUIRE(laid.has_value());
        const auto got = laid.value_or(StreamMark{});
        CHECK(got.path == "next.flac");
        CHECK(laidOnBlockAt == firstSample + example.latency);
        CHECK(got.position == example.from);
        CHECK(got.at - (got.position - example.from) == firstSample + example.latency);
    }
}

TEST_CASE("a block that straddles the first audible sample passes, and the next carries the mark") {
    MarkPlacer placer;
    Stream stream;
    stream.write(placer, 0.25);

    StreamMark mark;
    mark.position = 40.0;
    const double firstSample = stream.time;
    placer.pending(mark, 0.375);

    CHECK_FALSE(stream.write(placer, 0.25).has_value());

    // Starts 0.125 s before the track is audible and ends 0.125 s after.
    CHECK_FALSE(stream.write(placer, 0.25).has_value());

    const auto laid = stream.write(placer, 0.25);
    REQUIRE(laid.has_value());
    const auto got = laid.value_or(StreamMark{});
    CHECK(got.at == firstSample + 0.5);
    CHECK(got.position == 40.125);
    CHECK(got.at - (got.position - 40.0) == firstSample + 0.375);
}

TEST_CASE("a mark is answered once, and nothing more until the next turn's") {
    MarkPlacer placer;
    Stream stream;
    CHECK_FALSE(stream.write(placer, 0.25).has_value());

    StreamMark first;
    first.path = "first.flac";
    placer.pending(first, 0.0);
    const auto laid = stream.write(placer, 0.25);
    REQUIRE(laid.has_value());
    CHECK(laid.value_or(StreamMark{}).path == "first.flac");

    for (int i = 0; i < 6; ++i)
        CHECK_FALSE(stream.write(placer, 0.25).has_value());

    StreamMark second;
    second.path = "second.flac";
    placer.pending(second, 0.0);
    const auto next = stream.write(placer, 0.25);
    REQUIRE(next.has_value());
    CHECK(next.value_or(StreamMark{}).path == "second.flac");
    CHECK_FALSE(stream.write(placer, 0.25).has_value());
}

TEST_CASE("a new session has reported nothing and still has its chain") {
    Sessions sessions;
    const auto session = sessions.create();

    CHECK(session->reports().empty());
    CHECK_FALSE(session->chainDropped());
}

TEST_CASE("a track that will not decode is reported by name and skipped to the next by the order") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(4, 1);
    const auto ears = session->listen(DeviceIdentity{"phone", {}}, "opus", now);
    REQUIRE(ears);
    const auto failed = *session->turn();

    CHECK(session->threw(failed.serial, Thrower::decoder, now) == AfterThrow::skipTrack);

    const auto reports = session->reports();
    REQUIRE(reports.size() == 1);
    CHECK(reports[0].kind == SessionReportKind::undecodable);
    CHECK(reports[0].path == pathOf(1));
    CHECK(reports[0].subsong == 4);
    CHECK(reports[0].libraryPath == std::optional<std::string>("Someone/A Record/1.cue"));

    REQUIRE(session->turn().has_value());
    CHECK(session->turn()->serial != failed.serial);
    CHECK(pathPlaying(*session) == pathOf(2));
    CHECK(session->running());
    CHECK_FALSE(session->chainDropped());
}

// Repeating the one track that will not decode would report it forever and play nothing.
TEST_CASE("under repeat one a track that will not decode gives way to the next row") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(3, 2, SessionOrder::repeatOne);

    REQUIRE(session->threw(Sessions::serial(*session), Thrower::decoder, now) ==
            AfterThrow::skipTrack);
    CHECK(pathPlaying(*session) == pathOf(0));
}

TEST_CASE("a track that will not decode gives way to a queued track first, as one that ends does") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(3);
    session->enqueue({queuedTrack("a")});

    REQUIRE(session->threw(Sessions::serial(*session), Thrower::decoder, now) ==
            AfterThrow::skipTrack);
    CHECK(pathPlaying(*session) == "queued a");
    CHECK(session->queue().entries.empty());
}

TEST_CASE("a chain that throws is dropped and reported once, and the same track plays on") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(3, 1);
    const auto ears = session->listen(DeviceIdentity{"phone", {}}, "opus", now);
    REQUIRE(ears);
    const auto turn = *session->turn();

    CHECK(session->threw(turn.serial, Thrower::chain, now) == AfterThrow::dropChain);
    CHECK(session->chainDropped());

    const auto reports = session->reports();
    REQUIRE(reports.size() == 1);
    CHECK(reports[0].kind == SessionReportKind::chainDropped);
    CHECK(reports[0].path == pathOf(1));
    CHECK(reports[0].subsong == 4);
    CHECK(reports[0].libraryPath == std::optional<std::string>("Someone/A Record/1.cue"));

    REQUIRE(session->turn().has_value());
    CHECK(session->turn()->serial == turn.serial);
    CHECK(pathPlaying(*session) == pathOf(1));
    CHECK(session->running());

    // The chain is gone, so a second throw has nothing more to say.
    session->threw(turn.serial, Thrower::chain, now);
    CHECK(session->reports().size() == 1);
}

TEST_CASE("reports and a dropped chain outlast a track change, a stop and a new play") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(4);

    REQUIRE(session->threw(Sessions::serial(*session), Thrower::chain, now) ==
            AfterThrow::dropChain);
    REQUIRE(session->threw(Sessions::serial(*session), Thrower::decoder, now) ==
            AfterThrow::skipTrack);
    REQUIRE(session->reports().size() == 2);

    REQUIRE(session->ended(Sessions::serial(*session), now));
    session->stop(now);
    REQUIRE(session->play(rows(2), 0, now) == PlayerOutcome::done);

    const auto reports = session->reports();
    REQUIRE(reports.size() == 2);
    CHECK(reports[0].kind == SessionReportKind::chainDropped);
    CHECK(reports[0].path == pathOf(0));
    CHECK(reports[1].kind == SessionReportKind::undecodable);
    CHECK(reports[1].path == pathOf(0));
    CHECK(session->chainDropped());
}

namespace {

const SessionOrder kOrders[]{SessionOrder::inOrder, SessionOrder::repeatAll,
                             SessionOrder::repeatOne, SessionOrder::shuffleTracks,
                             SessionOrder::random};

std::optional<std::string> failCurrent(Session& session, Time now) {
    const auto turn = session.turn();
    if (!turn)
        return std::nullopt;
    CHECK(session.threw(turn->serial, Thrower::decoder, now) == AfterThrow::skipTrack);
    return turn->track.path;
}

std::shared_ptr<Audience::Membership> listening(Session& session, Time now) {
    auto ears = session.listen(DeviceIdentity{"phone", {}}, "opus", now);
    REQUIRE(ears);
    return ears;
}

}  // namespace

// One row under a repeat order, or every row unreadable, would otherwise reopen a failing track
// for ever and add a report each time round.
TEST_CASE("a session whose every track fails stops once each has failed, under every order") {
    for (const SessionOrder order : kOrders) {
        for (size_t count = 1; count <= 3; ++count) {
            CAPTURE(modeNameOf(order));
            CAPTURE(count);
            Sessions sessions;
            const auto now = sessions.now();

            // inOrder runs off its last row anyway, so it starts at the first; the others start
            // at the last, where going round is what they would do next.
            const size_t start = order == SessionOrder::inOrder ? 0 : count - 1;
            const auto session = sessions.playing(count, start, order);
            const auto ears = listening(*session, now);

            std::vector<std::string> failed;
            for (size_t i = 0; i < count; ++i) {
                CAPTURE(i);
                const auto path = failCurrent(*session, now);
                REQUIRE(path.has_value());
                failed.push_back(path.value_or(""));
                if (i + 1 < count)
                    CHECK(session->state(now).playback == PlaybackState::playing);
            }

            CHECK(session->state(now).playback == PlaybackState::stopped);
            CHECK_FALSE(session->turn().has_value());

            // Every row was tried once, and no track was tried twice.
            std::sort(failed.begin(), failed.end());
            std::vector<std::string> everyRow;
            everyRow.reserve(count);
            for (size_t row = 0; row < count; ++row)
                everyRow.push_back(pathOf(row));
            std::sort(everyRow.begin(), everyRow.end());
            CHECK(failed == everyRow);

            const auto reports = session->reports();
            CHECK(reports.size() == count);
            for (const auto& report : reports)
                CHECK(report.kind == SessionReportKind::undecodable);
        }
    }
}

TEST_CASE("a track that plays to its end ends a run of failures") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(3, 0, SessionOrder::repeatAll);
    const auto ears = listening(*session, now);

    REQUIRE(failCurrent(*session, now));
    REQUIRE(failCurrent(*session, now));
    session->began(Sessions::serial(*session), 300, now);
    REQUIRE(session->ended(Sessions::serial(*session), now));

    REQUIRE(failCurrent(*session, now));
    REQUIRE(failCurrent(*session, now));
    CHECK(session->state(now).playback == PlaybackState::playing);
    CHECK(session->turn().has_value());
}

// foobar2000's input_helper opens a track before it decodes any of it, so a track can begin and
// still throw on its first chunk. Counting from the open would never let such a snapshot stop.
TEST_CASE("tracks that open and then fail stop the session once every row has failed") {
    for (const SessionOrder order : {SessionOrder::repeatAll, SessionOrder::repeatOne}) {
        CAPTURE(modeNameOf(order));
        Sessions sessions;
        const auto now = sessions.now();
        const auto session = sessions.playing(3, 0, order);

        for (int i = 0; i < 3; ++i) {
            CAPTURE(i);
            REQUIRE(session->turn().has_value());
            session->began(Sessions::serial(*session), 300, now);
            CHECK(failCurrent(*session, now).has_value());
        }

        CHECK(session->state(now).playback == PlaybackState::stopped);
        CHECK_FALSE(session->turn().has_value());
        CHECK(session->reports().size() == 3);
    }
}

TEST_CASE("a chain that throws is no track failing, and counts nothing toward a stop") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(3, 0, SessionOrder::repeatAll);
    const auto ears = listening(*session, now);

    REQUIRE(failCurrent(*session, now));
    REQUIRE(session->threw(Sessions::serial(*session), Thrower::chain, now) ==
            AfterThrow::dropChain);
    REQUIRE(failCurrent(*session, now));

    CHECK(session->state(now).playback == PlaybackState::playing);
    CHECK(pathPlaying(*session) == pathOf(2));
}

// A track that cannot be decoded is skipped, so a queued failure must not stop the pass before
// every row has been tried.
TEST_CASE("a queued track that fails does not cut short a pass over the snapshot's rows") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(2, 0, SessionOrder::repeatAll);
    const auto ears = listening(*session, now);
    session->enqueue({queuedTrack("a")});

    CHECK(failCurrent(*session, now) == pathOf(0));
    CHECK(failCurrent(*session, now) == "queued a");
    CHECK(session->state(now).playback == PlaybackState::playing);
    CHECK(pathPlaying(*session) == pathOf(1));

    CHECK(failCurrent(*session, now) == pathOf(1));
    CHECK(session->state(now).playback == PlaybackState::stopped);
    CHECK_FALSE(session->turn().has_value());
}

TEST_CASE("a session holding only queued tracks stops once each of them has failed") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.create();
    REQUIRE(session->enqueue({queuedTrack("a"), queuedTrack("b")}) == PlayerOutcome::done);
    session->playPause(now);
    REQUIRE(pathPlaying(*session) == "queued a");

    CHECK(failCurrent(*session, now) == "queued a");
    CHECK(failCurrent(*session, now) == "queued b");

    CHECK(session->state(now).playback == PlaybackState::stopped);
    CHECK_FALSE(session->turn().has_value());
    CHECK(session->queue().entries.empty());
    CHECK(session->reports().size() == 2);
}

TEST_CASE("after a stop for failing tracks, a new play starts a fresh run") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(2, 0, SessionOrder::repeatAll);
    const auto ears = listening(*session, now);

    REQUIRE(failCurrent(*session, now));
    REQUIRE(failCurrent(*session, now));
    REQUIRE(session->state(now).playback == PlaybackState::stopped);

    REQUIRE(session->play(rows(2), 0, now) == PlayerOutcome::done);
    CHECK(session->state(now).playback == PlaybackState::playing);
    CHECK(failCurrent(*session, now) == pathOf(0));
    CHECK(session->state(now).playback == PlaybackState::playing);
    CHECK(pathPlaying(*session) == pathOf(1));
}

TEST_CASE("each report carries a sequence above the one before it") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(5, 0, SessionOrder::repeatAll);

    for (int i = 0; i < 3; ++i)
        REQUIRE(session->threw(Sessions::serial(*session), Thrower::decoder, now) ==
                AfterThrow::skipTrack);
    REQUIRE(session->threw(Sessions::serial(*session), Thrower::chain, now) ==
            AfterThrow::dropChain);

    const auto reports = session->reports();
    REQUIRE(reports.size() == 4);
    for (size_t i = 1; i < reports.size(); ++i) {
        CAPTURE(i);
        CHECK(reports[i].sequence > reports[i - 1].sequence);
    }
}

namespace {

struct Move {
    const char* name;
    std::function<void(Session&, Time)> apply;
};

// Each leaves behind the turn `playing(4, 1)` started on, row 1.
const std::vector<Move>& leavingMoves() {
    static const std::vector<Move> moves{
        {"stopped", [](Session& session, Time now) { session.stop(now); }},
        {"sought", [](Session& session, Time now) { session.seek(60, false, now); }},
        {"started the next track",
         [](Session& session, Time now) { REQUIRE(session.ended(session.turn()->serial, now)); }},
        {"played something else",
         [](Session& session, Time now) {
             REQUIRE(session.play(rows(4), 3, now) == PlayerOutcome::done);
         }},
    };
    return moves;
}

struct Before {
    Before(const Session& session, Time now)
        : turn(session.turn()), playback(session.state(now).playback) {}

    void unchanged(const Session& session, Time now) const {
        CHECK(session.state(now).playback == playback);
        REQUIRE(session.turn().has_value() == turn.has_value());
        if (turn) {
            CHECK(session.turn()->serial == turn->serial);
            CHECK(session.turn()->track.path == turn->track.path);
        }
    }

    std::optional<Turn> turn;
    PlaybackState playback;
};

}  // namespace

// foobar2000 raises the same exception out of input_helper::run for the abort a stop, a seek or a
// reap raises as for a real failure. The session tells them apart by the turn the throw came from.
TEST_CASE("a decoder's throw from a turn the session has left, or once closed, changes nothing") {
    std::vector<Move> moves(leavingMoves());
    moves.push_back({"closed", [](Session& session, Time /*now*/) { session.close(); }});

    for (const Move& move : moves) {
        CAPTURE(move.name);
        Sessions sessions;
        const auto now = sessions.now();
        const auto session = sessions.playing(4, 1);
        const auto old = Sessions::serial(*session);

        move.apply(*session, now);
        const Before before(*session, now);

        CHECK(session->threw(old, Thrower::decoder, now) == AfterThrow::nothing);

        CHECK(session->reports().empty());
        before.unchanged(*session, now);
    }
}

// The decoder runs the chain's END_OF_TRACK after ended() has moved the turn on, and its flush
// after a seek or a stop, so a DSP that throws there throws on a turn the session has left.
TEST_CASE("a chain's throw from a turn the session has just left drops the chain and names it") {
    for (const Move& move : leavingMoves()) {
        CAPTURE(move.name);
        Sessions sessions;
        const auto now = sessions.now();
        const auto session = sessions.playing(4, 1);
        const auto old = Sessions::serial(*session);

        move.apply(*session, now);
        const Before before(*session, now);

        CHECK(session->threw(old, Thrower::chain, now) == AfterThrow::dropChain);
        CHECK(session->chainDropped());

        const auto reports = session->reports();
        REQUIRE(reports.size() == 1);
        CHECK(reports[0].kind == SessionReportKind::chainDropped);
        CHECK(reports[0].path == pathOf(1));
        CHECK(reports[0].subsong == 4);
        before.unchanged(*session, now);
    }
}

// Which track a turn older than the last one names is left open; that the chain goes is not.
TEST_CASE("a chain's throw from an older turn still drops the chain and reports it") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(4, 0);
    const auto old = Sessions::serial(*session);
    REQUIRE(session->ended(old, now));
    REQUIRE(session->ended(Sessions::serial(*session), now));

    CHECK(session->threw(old, Thrower::chain, now) == AfterThrow::dropChain);
    CHECK(session->chainDropped());
    CHECK(session->reports().size() == 1);
    CHECK(pathPlaying(*session) == pathOf(2));
}

// A close is the one thing that raises the session's own abort out of dsp_manager::run.
TEST_CASE("a chain's throw once the session is closed changes nothing") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(4, 1);
    const auto current = Sessions::serial(*session);
    session->close();
    const Before before(*session, now);

    CHECK(session->threw(current, Thrower::chain, now) == AfterThrow::nothing);
    CHECK(session->reports().empty());
    CHECK_FALSE(session->chainDropped());
    before.unchanged(*session, now);
}

TEST_CASE("after a cut the audio ahead of a turn's first sample is nothing") {
    CHECK(markLeadSeconds(true, 0.25, 0.5) == 0.0);
    CHECK(markLeadSeconds(true, 0.0, 0.0) == 0.0);
    CHECK(markLeadSeconds(true, 2.0, 0.0) == 0.0);
}

TEST_CASE("after a gapless advance the audio ahead is the chain's latency and the blocks waiting") {
    CHECK(markLeadSeconds(false, 0.25, 0.125) == 0.375);
    CHECK(markLeadSeconds(false, 0.25, 0.0) == 0.25);

    // A chain that was dropped answers no latency, and only the blocks waiting are ahead.
    CHECK(markLeadSeconds(false, 0.0, 0.5) == 0.5);
    CHECK(markLeadSeconds(false, 0.0, 0.0) == 0.0);
}

TEST_CASE("the audio ahead of a turn's first sample is never negative") {
    CHECK(markLeadSeconds(false, -0.25, 0.0) >= 0.0);
    CHECK(markLeadSeconds(false, -0.25, 0.125) >= 0.0);
}

// Blocks already out of the chain go first, then what the chain still holds of the track before,
// then the new track.
TEST_CASE("a gapless advance lays the mark on the block where the new track's first sample is") {
    MarkPlacer placer;
    Stream stream;
    stream.write(placer, 0.5);

    const double waiting = 0.125;
    const double latency = 0.25;
    StreamMark mark;
    mark.path = "next.flac";
    const double firstSample = stream.time + waiting + latency;
    placer.pending(mark, markLeadSeconds(false, latency, waiting));

    CHECK_FALSE(stream.write(placer, waiting).has_value());
    CHECK_FALSE(stream.write(placer, 0.125).has_value());
    CHECK_FALSE(stream.write(placer, 0.125).has_value());

    const auto laid = stream.write(placer, 0.125);
    REQUIRE(laid.has_value());
    CHECK(laid.value_or(StreamMark{}).at == firstSample);
    CHECK(laid.value_or(StreamMark{}).position == 0.0);
}

TEST_CASE("a stop's abort leaves the session to start again on the track it stopped on") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(4, 1);
    const auto old = Sessions::serial(*session);

    session->stop(now);
    REQUIRE(session->threw(old, Thrower::decoder, now) == AfterThrow::nothing);

    session->playPause(now);
    CHECK(pathPlaying(*session) == pathOf(1));
}

namespace {

std::vector<uint64_t> sequencesOf(const std::vector<SessionReport>& reports) {
    std::vector<uint64_t> sequences;
    std::transform(reports.begin(), reports.end(), std::back_inserter(sequences),
                   [](const SessionReport& report) { return report.sequence; });
    return sequences;
}

std::vector<std::string> pathsOf(const std::vector<SessionReport>& reports) {
    std::vector<std::string> paths;
    std::transform(reports.begin(), reports.end(), std::back_inserter(paths),
                   [](const SessionReport& report) { return report.path; });
    return paths;
}

std::vector<std::string> rowPaths(size_t first, size_t last) {
    std::vector<std::string> paths;
    for (size_t row = first; row <= last; ++row)
        paths.push_back(pathOf(row));
    return paths;
}

}  // namespace

TEST_CASE("a session's first report is sequence 1, and each report after it is one higher") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(5, 0, SessionOrder::repeatAll);

    REQUIRE(failCurrent(*session, now));
    REQUIRE(session->threw(Sessions::serial(*session), Thrower::chain, now) ==
            AfterThrow::dropChain);
    REQUIRE(failCurrent(*session, now));

    CHECK(sequencesOf(session->reports()) == std::vector<uint64_t>{1, 2, 3});
}

// Twelve rows, so ten failures in a row never stop the session before the tenth.
TEST_CASE(
    "a session keeps its last eight reports, oldest first, and each new one drops the oldest") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(12);

    for (int i = 0; i < 8; ++i)
        REQUIRE(failCurrent(*session, now));

    const auto eight = session->reports();
    CHECK(sequencesOf(eight) == std::vector<uint64_t>{1, 2, 3, 4, 5, 6, 7, 8});
    CHECK(pathsOf(eight) == rowPaths(0, 7));

    REQUIRE(failCurrent(*session, now));

    const auto ninth = session->reports();
    CHECK(sequencesOf(ninth) == std::vector<uint64_t>{2, 3, 4, 5, 6, 7, 8, 9});
    CHECK(pathsOf(ninth) == rowPaths(1, 8));

    REQUIRE(failCurrent(*session, now));

    const auto tenth = session->reports();
    CHECK(sequencesOf(tenth) == std::vector<uint64_t>{3, 4, 5, 6, 7, 8, 9, 10});
    CHECK(pathsOf(tenth) == rowPaths(2, 9));
}

TEST_CASE("a dropped chain is still reported once its own report is no longer among the eight") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(20);

    REQUIRE(session->threw(Sessions::serial(*session), Thrower::chain, now) ==
            AfterThrow::dropChain);
    for (int i = 0; i < 8; ++i)
        REQUIRE(failCurrent(*session, now));

    const auto reports = session->reports();
    REQUIRE(reports.size() == 8);
    CHECK(std::none_of(reports.begin(), reports.end(), [](const SessionReport& report) {
        return report.kind == SessionReportKind::chainDropped;
    }));
    CHECK(session->chainDropped());
}

// A chain report changes nothing else a poll answers, so the version moving there is the report's.
TEST_CASE("each report moves the session's revision and the version its poll is tagged with") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(5, 0, SessionOrder::repeatAll);

    const auto start = session->revisions();
    REQUIRE(failCurrent(*session, now));
    const auto undecodable = session->revisions();
    CHECK(undecodable.session > start.session);
    CHECK(undecodable.version > start.version);

    REQUIRE(session->threw(Sessions::serial(*session), Thrower::chain, now) ==
            AfterThrow::dropChain);
    const auto dropped = session->revisions();
    CHECK(dropped.session > undecodable.session);
    CHECK(dropped.version > undecodable.version);
}

namespace {

// Everything a controller does to a session, and a track running out, none of which is a report.
const std::vector<Move>& movesThatReportNothing() {
    static const std::vector<Move> moves{
        {"pause", [](Session& session, Time now) { session.playPause(now); }},
        {"resume", [](Session& session, Time now) { session.playPause(now); }},
        {"next", [](Session& session, Time now) { session.next(now); }},
        {"previous", [](Session& session, Time now) { session.previous(now); }},
        {"seek", [](Session& session, Time now) { session.seek(30, false, now); }},
        {"order", [](Session& session, Time) { session.setOrder(SessionOrder::repeatAll); }},
        {"queue", [](Session& session, Time) { session.enqueue({queuedTrack("a")}); }},
        {"clear the queue", [](Session& session, Time) { session.clearQueue(); }},
        {"track ends",
         [](Session& session, Time now) {
             session.began(Sessions::serial(session), 300, now);
             session.ended(Sessions::serial(session), now);
         }},
        {"names read",
         [](Session& session, Time) {
             session.named(Sessions::serial(session), "Title", "Artist", "Album", "Album artist");
         }},
        {"play another row", [](Session& session, Time now) { session.play(rows(4), 3, now); }},
        {"stop", [](Session& session, Time now) { session.stop(now); }},
    };
    return moves;
}

}  // namespace

TEST_CASE("a track change, a queue edit and every transport command leave the session revision") {
    Sessions sessions;
    const auto now = sessions.now();
    const auto session = sessions.playing(4, 1);
    const auto start = session->revisions();

    for (const auto& move : movesThatReportNothing()) {
        CAPTURE(move.name);
        const auto before = session->revisions();
        move.apply(*session, now);
        const auto after = session->revisions();
        CHECK(after.session == before.session);
    }

    // Each move above moved what the poll answers, so a revision that never moved is not idle.
    CHECK(session->revisions().version > start.version);
    CHECK(session->revisions().session == start.session);
}
