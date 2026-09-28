// Which refusal a playlist or queue edit answers when several apply at once. The facts are read
// off foobar2000 in fb2k/, where nothing runs on this machine, so the order is pinned here.

#include "third_party/doctest.h"

#include "core/refusal_order.h"

using namespace jean;

namespace {

PlaylistEditFacts everyPlaylistRefusal() {
    PlaylistEditFacts facts;
    facts.noSuchPlaylist = true;
    facts.ownPlaylist = true;
    facts.locked = true;
    facts.libraryMoved = true;
    facts.rowsMoved = true;
    facts.positionPastEnd = true;
    return facts;
}

QueueEditFacts everyQueueRefusal() {
    QueueEditFacts facts;
    facts.queueMoved = true;
    facts.noSuchPlaylist = true;
    facts.libraryMoved = true;
    facts.positionPastEnd = true;
    return facts;
}

}  // namespace

TEST_CASE("a playlist edit nothing refuses goes ahead") {
    CHECK(playlistEditRefusal(PlaylistEditFacts{}) == PlayerOutcome::done);
}

TEST_CASE("a playlist edit answers the first refusal in order, whatever else also applies") {
    auto facts = everyPlaylistRefusal();
    CHECK(playlistEditRefusal(facts) == PlayerOutcome::noSuchPlaylist);

    facts.noSuchPlaylist = false;
    CHECK(playlistEditRefusal(facts) == PlayerOutcome::ownPlaylist);

    facts.ownPlaylist = false;
    CHECK(playlistEditRefusal(facts) == PlayerOutcome::playlistLocked);

    facts.locked = false;
    CHECK(playlistEditRefusal(facts) == PlayerOutcome::structureMoved);

    facts.libraryMoved = false;
    CHECK(playlistEditRefusal(facts) == PlayerOutcome::rowsMoved);

    facts.rowsMoved = false;
    CHECK(playlistEditRefusal(facts) == PlayerOutcome::positionPastEnd);
}

// Re-reading the playlist fixes a stale structure and does nothing for a lock, so answering the
// stale structure would send a client round a re-read only to be refused again.
TEST_CASE("a locked playlist answers the lock ahead of a stale structure") {
    PlaylistEditFacts facts;
    facts.locked = true;
    facts.rowsMoved = true;
    CHECK(playlistEditRefusal(facts) == PlayerOutcome::playlistLocked);
}

TEST_CASE("a queue edit nothing refuses goes ahead") {
    CHECK(queueEditRefusal(QueueEditFacts{}) == PlayerOutcome::done);
}

TEST_CASE("a queue edit answers the first refusal in order, whatever else also applies") {
    auto facts = everyQueueRefusal();
    CHECK(queueEditRefusal(facts) == PlayerOutcome::queueMoved);

    facts.queueMoved = false;
    CHECK(queueEditRefusal(facts) == PlayerOutcome::noSuchPlaylist);

    facts.noSuchPlaylist = false;
    CHECK(queueEditRefusal(facts) == PlayerOutcome::structureMoved);

    facts.libraryMoved = false;
    CHECK(queueEditRefusal(facts) == PlayerOutcome::positionPastEnd);
}
