#pragma once

#include "core/player_outcome.h"

// Which refusal a playlist or queue edit answers when more than one applies. fb2k/ reads the
// facts off the player on its main thread, and the order they are weighed in is decided here.
// A fact an edit does not check stays false.
namespace jean {

struct PlaylistEditFacts {
    bool noSuchPlaylist = false;

    // One of this component's own playlists, which only this component edits.
    bool ownPlaylist = false;

    // foobar2000's lock on the playlist refuses this kind of edit.
    bool locked = false;

    // The media library snapshot has been rebuilt since the ordinals the edit names were read.
    bool libraryMoved = false;

    // The playlist's structure generation is not the one the edit's positions were read at.
    bool rowsMoved = false;

    bool positionPastEnd = false;
};

// done where nothing refuses the edit. A lock outranks a stale structure: re-reading the
// playlist is a remedy for the second and not for the first, so a request that is both answers
// the refusal a re-read cannot fix.
PlayerOutcome playlistEditRefusal(const PlaylistEditFacts& facts);

struct QueueEditFacts {
    // The queue revision the edit names is not the queue's current one.
    bool queueMoved = false;

    bool noSuchPlaylist = false;

    // The media library snapshot has been rebuilt since the ordinals the edit names were read.
    bool libraryMoved = false;

    // A row past the end of its playlist, or a queue position past the end of the queue.
    bool positionPastEnd = false;
};

// done where nothing refuses the edit. A moved queue outranks everything else: every other fact
// was read against a queue the client no longer holds.
PlayerOutcome queueEditRefusal(const QueueEditFacts& facts);

}  // namespace jean
