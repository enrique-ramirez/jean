#pragma once

namespace jean {

enum class PlayerOutcome {
    done,
    // An outcome rather than a refusal because only foobar2000 can parse a query.
    queryInvalid,
    noSuchPlaylist,
    positionPastEnd,
    // Says what POST /api/tags says by TagWriteOutcome::ambiguousAddress, in those words: a
    // client tells one refusal from another by the sentence rather than by the route.
    ambiguousAddress,
    notAnAutoPlaylist,
    keyRefused,
    keyInUse,
    tooMany,
    // Means what GET /api/library/changes already means by 409: export again, then ask again.
    structureMoved,
    // The revision a move, a remove or a positioned queue named is not the queue's current
    // one, checked at the route and answered again from inside the job for the same reason
    // structureMoved is: a change can land between the two. Distinct from structureMoved so a
    // client with both remedies at hand -- re-read the queue, or export the library again --
    // knows which one applies.
    queueMoved,
    rowsMoved,
    rowsRevisionTooOld,
    playerRefused,
    timedOut,
    unavailable,
    // The read-only-playlists setting, checked at the route before the player is asked
    // anything. Distinct from notAnAutoPlaylist, which only the player can report.
    writesDisabled,
    playlistLocked,
    ownPlaylist,
    playbackDisabled,
    changeDisabled,
    notListed,
};

}  // namespace jean
