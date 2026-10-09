// Silencing the player while somebody is listening elsewhere. Every case here is about the
// hold declining to argue with a person: the one at the player wins, always, and the worst
// failure this can have is a player left silent with nothing to explain it.
//
// The hold decides on a thread of its own, so a case whose promise is that it left something
// alone waits for an event and never for an interval: `becomes` where there is a change to
// see, and otherwise the end of the hold's own scope, whose destructor joins that thread and
// settles the player. An assertion that nothing happened, made after a guessed wait, passes
// on a machine where that thread had not run at all and can never fail.

#include "third_party/doctest.h"

#include "core/audience.h"
#include "core/output_hold.h"

#include "support/eventually.h"
#include "support/fixtures.h"
#include "support/log_capture.h"

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <optional>
#include <stdexcept>
#include <thread>

using namespace jean;
using namespace jean::testing;
using namespace std::chrono_literals;

namespace {

struct FakePlayer {
    static constexpr float kMuted = -100.0F;

    std::atomic<float> level{-10.0F};
    std::atomic<float> beforeMute{-10.0F};
    std::atomic<bool> muted{false};
    std::atomic<int> writes{0};

    // Silences taken, as against writes of any kind. One episode is one mute, and the
    // unmute that ends it is a write too.
    std::atomic<int> mutes{0};

    // foobar2000 announces a volume change from inside the call that made it, so a test that
    // wants that shape wires these two together.
    std::function<void(bool)> onSetMuted;
    std::function<void(bool)> watcher;

    void setLevel(float value) {
        level = value;
        muted = value <= kMuted;
    }

    OutputHold::Player seam() {
        OutputHold::Player player;
        player.isMuted = [this] { return muted.load(); };
        player.setMuted = [this](bool value) {
            if (value) {
                beforeMute = level.load();
                ++mutes;
            }
            level = value ? kMuted : beforeMute.load();
            muted = value;
            ++writes;
            if (onSetMuted)
                onSetMuted(value);
        };
        player.volume = [this]() -> std::optional<float> { return level.load(); };
        player.setVolume = [this](float value) {
            setLevel(value);
            ++writes;
        };
        return player;
    }
};

// The hold works on a thread of its own, so a test waits for the state it is about to
// assert rather than sleeping for a guessed interval.
bool becomes(const std::atomic<bool>& flag, bool wanted) {
    return eventually([&flag, wanted] { return flag.load() == wanted; });
}

DeviceIdentity phone() {
    return DeviceIdentity{"phone", "Android phone"};
}

DeviceIdentity laptop() {
    return DeviceIdentity{"laptop", "Laptop"};
}

}  // namespace

TEST_CASE("the player is silenced while somebody listens and given its sound back after") {
    Audience audience(8, 0s);
    FakePlayer player;
    const OutputHold hold(audience, player.seam(), true);

    {
        const auto held = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));
        CHECK(hold.held());
    }

    REQUIRE(becomes(player.muted, false));
    CHECK_FALSE(hold.held());

    // The same level it was on before, rather than whatever the player's own unmute would
    // have remembered from the last time somebody pressed it.
    CHECK(player.level == doctest::Approx(-10.0F));
}

TEST_CASE("a player that throws at the hold is logged, and the next listener is tried again") {
    clearLog();
    Audience audience(8, 0s);
    FakePlayer player;
    OutputHold::Player seam = player.seam();
    const auto setMuted = seam.setMuted;
    const auto isMuted = seam.isMuted;
    std::atomic<int> refusals{0};
    std::atomic<int> decisions{0};
    seam.setMuted = [&setMuted, &refusals](bool value) {
        if (value && refusals++ == 0)
            throw std::runtime_error("no output device");
        setMuted(value);
    };
    seam.isMuted = [&isMuted, &decisions] {
        ++decisions;
        return isMuted();
    };
    const OutputHold hold(audience, seam, true);

    {
        const auto first = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(eventually([&refusals] { return refusals.load() == 1; }));
    }
    REQUIRE(eventually([] { return logged("the mute hold failed: no output device"); }));
    REQUIRE(eventually([&decisions] { return decisions.load() == 2; }));
    CHECK_FALSE(player.muted);

    {
        const auto second = audience.join(laptop(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));
    }
    REQUIRE(becomes(player.muted, false));
}

TEST_CASE("a player left silent by hand mid-listen gets the level back it started on") {
    Audience audience(8, 0s);
    FakePlayer player;
    OutputHold hold(audience, player.seam(), true);

    {
        const auto held = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));

        // Both outputs, and then not: the fader goes up, which hands the player back to
        // whoever moved it, and then all the way down again.
        player.setLevel(-20.0F);
        hold.playerVolumeChanged(false);
        player.setLevel(FakePlayer::kMuted);
        hold.playerVolumeChanged(true);
    }

    // Nobody means to leave the player mute once the sound comes back to it, and there is
    // nothing on screen anywhere to say why it is silent.
    REQUIRE(becomes(player.muted, false));
    CHECK(player.level == doctest::Approx(-10.0F));
}

TEST_CASE("a level somebody chose mid-listen is theirs and is left where they put it") {
    Audience audience(8, 0s);
    FakePlayer player;

    {
        OutputHold hold(audience, player.seam(), true);

        const auto held = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));

        player.setLevel(-20.0F);
        hold.playerVolumeChanged(false);
    }

    // Audible, so it is a level somebody can hear and chose: the end of the episode has
    // nothing to put right.
    CHECK(player.level == doctest::Approx(-20.0F));
    CHECK(player.writes == 1);
}

TEST_CASE("a second listener does not mute a player that is already muted for the first") {
    Audience audience(8, 0s);
    FakePlayer player;

    {
        const OutputHold hold(audience, player.seam(), true);

        const auto first = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));

        const auto second = audience.join(laptop(), "opus", Audience::Clock::now());
        REQUIRE(second);
    }

    // One episode, one mute. A per-listener mute would become a reference count with two
    // ways to get the arithmetic wrong.
    CHECK(player.mutes == 1);
}

TEST_CASE("a player muted by hand is left alone, and left muted") {
    Audience audience(8, 0s);
    FakePlayer player;
    player.setLevel(FakePlayer::kMuted);

    {
        const OutputHold hold(audience, player.seam(), true);
        const auto held = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(held);
    }

    // Taking a hold here would mean unmuting a player somebody chose to mute, and putting a
    // level back at the end of the episode would mean the same thing a moment later. The
    // hold is never published either, because it is only ever taken by a write.
    CHECK(player.muted);
    CHECK(player.writes == 0);
}

TEST_CASE("somebody unmuting the player mid-listen keeps their sound") {
    Audience audience(8, 0s);
    FakePlayer player;

    {
        OutputHold hold(audience, player.seam(), true);

        const auto held = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));

        player.setLevel(-20.0F);
        hold.playerVolumeChanged(false);

        // Published, and it has to stop claiming the player straight away: a client would
        // otherwise go on saying the sound is elsewhere while it comes out of the speakers.
        CHECK_FALSE(hold.held());
    }

    // It never re-asserts and never "restores" a state it no longer owns.
    CHECK_FALSE(player.muted);
    CHECK(player.writes == 1);
}

TEST_CASE("the hold's own mute does not read as somebody taking the player back") {
    Audience audience(8, 0s);
    FakePlayer player;

    // What the player does inside volume_mute_toggle: the callback comes back before the
    // call that caused it has returned.
    player.onSetMuted = [&player](bool muted) { player.watcher(muted); };

    std::atomic<bool> heldWhenAnnounced{false};
    OutputHold hold(audience, player.seam(), true);
    player.watcher = [&hold, &heldWhenAnnounced](bool muted) {
        heldWhenAnnounced = hold.held();
        hold.playerVolumeChanged(muted);
    };

    const auto held = audience.join(phone(), "opus", Audience::Clock::now());
    REQUIRE(becomes(player.muted, true));

    CHECK(hold.held());
    CHECK(heldWhenAnnounced);
}

TEST_CASE("a reconnect inside the linger does not let the player back") {
    Audience audience(8, 10s);
    FakePlayer player;

    {
        const OutputHold hold(audience, player.seam(), true);

        {
            const auto held = audience.join(phone(), "opus", Audience::Clock::now());
            REQUIRE(becomes(player.muted, true));
        }

        const auto back = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(back);
    }

    // A blip is one episode: the player is silenced once, and given its sound back once,
    // when the listening is really over.
    CHECK(player.mutes == 1);
    CHECK(player.writes == 2);
}

TEST_CASE("the player keeps its sound when muteWhileStreaming is off") {
    Audience audience(8, 0s);
    FakePlayer player;
    const OutputHold hold(audience, player.seam(), false);

    const auto held = audience.join(phone(), "opus", Audience::Clock::now());
    REQUIRE(held);

    // There is no thread, so nothing is pending: this is the whole of what the hold will
    // ever do on an install that does not mute.
    CHECK_FALSE(hold.enabled());
    CHECK_FALSE(hold.held());
    CHECK_FALSE(player.muted);
    CHECK(player.writes == 0);
}

TEST_CASE("shutting down gives the player its sound back") {
    Audience audience(8, 60s);
    FakePlayer player;

    const auto held = audience.join(phone(), "opus", Audience::Clock::now());

    {
        const OutputHold hold(audience, player.seam(), true);
        REQUIRE(becomes(player.muted, true));
    }

    // A component that quit while holding the mute would leave a player silent with
    // nothing on screen to say why, and the volume survives a restart.
    CHECK_FALSE(player.muted);
}

TEST_CASE("asking for both outputs gives the player its sound back for the episode") {
    Audience audience(8, 0s);
    FakePlayer player;

    {
        OutputHold hold(audience, player.seam(), true);

        const auto held = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));

        hold.release();
        CHECK_FALSE(player.muted);
        CHECK_FALSE(hold.held());

        // A second listener arriving must not silence the player again: the choice was made
        // for this episode, not for this connection.
        const auto second = audience.join(laptop(), "opus", Audience::Clock::now());
        REQUIRE(second);
    }

    CHECK_FALSE(player.muted);
    CHECK(player.mutes == 1);
}

TEST_CASE("the next episode silences the player again") {
    Audience audience(8, 0s);
    FakePlayer player;
    OutputHold hold(audience, player.seam(), true);

    {
        const auto held = audience.join(phone(), "opus", Audience::Clock::now());
        REQUIRE(becomes(player.muted, true));

        hold.release();
        REQUIRE_FALSE(player.muted);

        // Dragged to the bottom by hand after the hold let go, so the end of the episode
        // has a level to put back -- which is also how this knows the hold has seen
        // everybody stop, rather than guessing at how long that takes.
        player.setLevel(FakePlayer::kMuted);
    }

    REQUIRE(becomes(player.muted, false));

    // Everybody stopped, so the choice to hear both went with them.
    const auto later = audience.join(phone(), "opus", Audience::Clock::now());
    CHECK(becomes(player.muted, true));
    CHECK(player.mutes == 2);
}

TEST_CASE("releasing with nobody listening is not a way to suppress the next hold") {
    Audience audience(8, 0s);
    FakePlayer player;
    OutputHold hold(audience, player.seam(), true);

    hold.release();

    const auto held = audience.join(phone(), "opus", Audience::Clock::now());
    CHECK(becomes(player.muted, true));
}

TEST_CASE("an install that never mutes offers nothing to release") {
    Audience audience(8, 0s);
    FakePlayer player;
    const OutputHold hold(audience, player.seam(), false);

    CHECK_FALSE(hold.enabled());
}
