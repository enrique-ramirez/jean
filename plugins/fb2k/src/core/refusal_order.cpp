#include "core/refusal_order.h"

namespace jean {

PlayerOutcome playlistEditRefusal(const PlaylistEditFacts& facts) {
    if (facts.noSuchPlaylist)
        return PlayerOutcome::noSuchPlaylist;
    if (facts.ownPlaylist)
        return PlayerOutcome::ownPlaylist;
    if (facts.locked)
        return PlayerOutcome::playlistLocked;
    if (facts.libraryMoved)
        return PlayerOutcome::structureMoved;
    if (facts.rowsMoved)
        return PlayerOutcome::rowsMoved;
    if (facts.positionPastEnd)
        return PlayerOutcome::positionPastEnd;
    return PlayerOutcome::done;
}

PlayerOutcome queueEditRefusal(const QueueEditFacts& facts) {
    if (facts.queueMoved)
        return PlayerOutcome::queueMoved;
    if (facts.noSuchPlaylist)
        return PlayerOutcome::noSuchPlaylist;
    if (facts.libraryMoved)
        return PlayerOutcome::structureMoved;
    if (facts.positionPastEnd)
        return PlayerOutcome::positionPastEnd;
    return PlayerOutcome::done;
}

}  // namespace jean
