#include "core/failures.h"

#include "third_party/json.hpp"

using nlohmann::json;

namespace jean {

std::string describe(PlayerOutcome outcome) {
    switch (outcome) {
        case PlayerOutcome::done:
            return "done";
        case PlayerOutcome::queryInvalid:
            return "foobar2000 could not read that query";
        case PlayerOutcome::noSuchPlaylist:
            return "no such playlist";
        case PlayerOutcome::positionPastEnd:
            return "that position is past the end";
        case PlayerOutcome::ambiguousAddress:
            return describe(TagWriteOutcome::ambiguousAddress);
        case PlayerOutcome::notAnAutoPlaylist:
            return "that playlist is not an autoplaylist";
        case PlayerOutcome::keyRefused:
            return describe(PlaylistRefusal::badKey);
        case PlayerOutcome::keyInUse:
            return "another playlist already has that key";
        case PlayerOutcome::tooMany:
            return "this install's autoplaylist limit is reached";
        case PlayerOutcome::structureMoved:
            return kRowsStructureMoved;
        case PlayerOutcome::queueMoved:
            return "the queue changed since that revision; read it again";
        case PlayerOutcome::rowsMoved:
            return "the playlist's rows were added, removed or reordered; read them again";
        case PlayerOutcome::rowsRevisionTooOld:
            return "that revision is not one this playlist can catch up from; read its rows again";
        case PlayerOutcome::playerRefused:
            return "the player could not do that";
        case PlayerOutcome::timedOut:
            return "the player did not answer in time";
        case PlayerOutcome::unavailable:
            return "autoplaylists are not available";
        case PlayerOutcome::writesDisabled:
            return "this install has playlist writes turned off; turn on writePlaylists in "
                   "config.json to allow them";
        case PlayerOutcome::playlistLocked:
            return "another component has locked that playlist against that edit";
        case PlayerOutcome::ownPlaylist:
            return "that playlist is foo_jean's own; address it by its role rather than by its id";
        case PlayerOutcome::playbackDisabled:
            return "this install has playback control turned off; turn on controlPlayback in "
                   "config.json to allow it";
        case PlayerOutcome::changeDisabled:
            return "this install has output device changes turned off; turn on changeOutput in "
                   "config.json to allow them";
        case PlayerOutcome::notListed:
            return "the player does not list that output device; read the outputs again";
    }
    return "unknown";
}

std::string describe(PlaylistRefusal refusal) {
    switch (refusal) {
        case PlaylistRefusal::none:
            return "ok";
        case PlaylistRefusal::malformedBody:
            return "malformed request";
        case PlaylistRefusal::badTitle:
            return "unacceptable title";
        case PlaylistRefusal::badKey:
            return "unacceptable key";
        case PlaylistRefusal::badQuery:
            return "unacceptable query";
        case PlaylistRefusal::badSort:
            return "unacceptable sort";
        case PlaylistRefusal::badId:
            return "unacceptable playlist id";
        case PlaylistRefusal::badOrdinals:
            return "unacceptable ordinal set";
        case PlaylistRefusal::tooFast:
            return "too many requests";
    }
    return "unknown";
}

std::string describe(PlaybackRefusal refusal) {
    switch (refusal) {
        case PlaybackRefusal::none:
            return "ok";
        case PlaybackRefusal::badSeek:
            return "unacceptable seek";
        case PlaybackRefusal::badMode:
            return "unacceptable mode";
        case PlaybackRefusal::badVolume:
            return "unacceptable volume";
    }
    return "unknown";
}

std::string describe(TagWriteRefusal refusal) {
    switch (refusal) {
        case TagWriteRefusal::none:
            return "ok";
        case TagWriteRefusal::malformedBody:
            return "malformed request";
        case TagWriteRefusal::badAddress:
            return "unacceptable address";
        case TagWriteRefusal::noFields:
            return "no fields to write";
        case TagWriteRefusal::fieldNotAllowed:
            return "field not allowed";
    }
    return "unknown";
}

std::string describe(TagWriteOutcome outcome) {
    switch (outcome) {
        case TagWriteOutcome::written:
            return "written";
        case TagWriteOutcome::trackNotKnown:
            return "foobar2000 does not know that track";
        case TagWriteOutcome::ambiguousAddress:
            return "the media library holds more than one track at that address";
        case TagWriteOutcome::rowsMoved:
            return "the playlist's rows were added, removed or reordered; read them again";
        case TagWriteOutcome::libraryRebuilt:
            return "the media library was rebuilt; read the state and ask again";
        case TagWriteOutcome::writeFailed:
            return "the player could not write the tags";
        case TagWriteOutcome::timedOut:
            return "the player did not answer in time";
        case TagWriteOutcome::unavailable:
            return "tag writing is not available";
        case TagWriteOutcome::tooFast:
            return "too many tag writes";
    }
    return "unknown";
}

std::string describe(LibraryRefusal refusal) {
    switch (refusal) {
        case LibraryRefusal::none:
            return "ok";
        case LibraryRefusal::tooManyColumns:
            return "too many columns";
        case LibraryRefusal::badColumn:
            return "unacceptable column";
        case LibraryRefusal::duplicateColumn:
            return "duplicate column";
        case LibraryRefusal::badSince:
            return "unacceptable revision";
        case LibraryRefusal::badRole:
            return "unacceptable role";
        case LibraryRefusal::duplicateRole:
            return "duplicate role";
        case LibraryRefusal::unacceptableQuestion:
            return "unacceptable question";
        case LibraryRefusal::duplicateQuestion:
            return "duplicate question";
        case LibraryRefusal::tooManyRows:
            return kTooManyRowsAsked;
    }
    return "unknown";
}

std::string describe(ReadOutcome outcome) {
    switch (outcome) {
        case ReadOutcome::ok:
            return "ok";
        case ReadOutcome::notBuilt:
            return "the library snapshot has not been built yet";
        case ReadOutcome::revisionTooOld:
            return "that revision is older than the retained window; read the state and ask again";
        case ReadOutcome::revisionUnknown:
            return "no such revision";
        case ReadOutcome::structureMoved:
            return kRowsStructureMoved;
    }
    return "unknown";
}

int httpStatusFor(PlayerOutcome outcome) {
    switch (outcome) {
        case PlayerOutcome::done:
            return 200;
        case PlayerOutcome::queryInvalid:
        case PlayerOutcome::positionPastEnd:
        case PlayerOutcome::keyRefused:
            return 400;
        case PlayerOutcome::writesDisabled:
        case PlayerOutcome::ownPlaylist:
        case PlayerOutcome::playbackDisabled:
        case PlayerOutcome::changeDisabled:
            return 403;
        case PlayerOutcome::noSuchPlaylist:
            return 404;
        case PlayerOutcome::ambiguousAddress:
        case PlayerOutcome::notAnAutoPlaylist:
        case PlayerOutcome::keyInUse:
        case PlayerOutcome::tooMany:
        case PlayerOutcome::structureMoved:
        case PlayerOutcome::queueMoved:
        case PlayerOutcome::rowsMoved:
        case PlayerOutcome::playlistLocked:
        case PlayerOutcome::notListed:
            return 409;
        case PlayerOutcome::rowsRevisionTooOld:
            return 410;
        case PlayerOutcome::playerRefused:
            return 500;
        case PlayerOutcome::timedOut:
            return 504;
        case PlayerOutcome::unavailable:
            return 503;
    }
    return 500;
}

int httpStatusFor(PlaylistRefusal refusal) {
    switch (refusal) {
        case PlaylistRefusal::none:
            return 200;
        case PlaylistRefusal::tooFast:
            return 429;
        case PlaylistRefusal::malformedBody:
        case PlaylistRefusal::badTitle:
        case PlaylistRefusal::badKey:
        case PlaylistRefusal::badQuery:
        case PlaylistRefusal::badSort:
        case PlaylistRefusal::badId:
        case PlaylistRefusal::badOrdinals:
            return 400;
    }
    return 400;
}

int httpStatusFor(PlaybackRefusal refusal) {
    switch (refusal) {
        case PlaybackRefusal::none:
            return 200;
        case PlaybackRefusal::badSeek:
        case PlaybackRefusal::badMode:
        case PlaybackRefusal::badVolume:
            return 400;
    }
    return 400;
}

int httpStatusFor(TagWriteRefusal refusal) {
    switch (refusal) {
        case TagWriteRefusal::none:
            return 200;
        case TagWriteRefusal::fieldNotAllowed:
            return 403;
        case TagWriteRefusal::malformedBody:
        case TagWriteRefusal::badAddress:
        case TagWriteRefusal::noFields:
            return 400;
    }
    return 400;
}

int httpStatusFor(TagWriteOutcome outcome) {
    switch (outcome) {
        case TagWriteOutcome::written:
            return 200;
        case TagWriteOutcome::trackNotKnown:
            return 404;
        case TagWriteOutcome::ambiguousAddress:
        case TagWriteOutcome::rowsMoved:
        case TagWriteOutcome::libraryRebuilt:
            return 409;
        case TagWriteOutcome::writeFailed:
            return 500;
        case TagWriteOutcome::timedOut:
            return 504;
        case TagWriteOutcome::unavailable:
            return 503;
        case TagWriteOutcome::tooFast:
            return 429;
    }
    return 500;
}

int httpStatusFor(LibraryRefusal refusal) {
    switch (refusal) {
        case LibraryRefusal::none:
            return 200;
        case LibraryRefusal::tooManyColumns:
        case LibraryRefusal::badColumn:
        case LibraryRefusal::duplicateColumn:
        case LibraryRefusal::badSince:
        case LibraryRefusal::badRole:
        case LibraryRefusal::duplicateRole:
        case LibraryRefusal::unacceptableQuestion:
        case LibraryRefusal::duplicateQuestion:
        case LibraryRefusal::tooManyRows:
            return 400;
    }
    return 400;
}

int httpStatusFor(ReadOutcome outcome) {
    switch (outcome) {
        case ReadOutcome::ok:
            return 200;
        case ReadOutcome::structureMoved:
            return 409;
        case ReadOutcome::revisionTooOld:
        case ReadOutcome::revisionUnknown:
            return 410;
        case ReadOutcome::notBuilt:
            return 503;
    }
    return 500;
}

std::string errorDocument(const std::string& message) {
    return json{{"error", message}}.dump();
}

std::string undeclaredColumnMessage(const std::string& expression) {
    return "'" + expression + "' is not a declared column";
}

std::string failureDocument(PlayerOutcome outcome, const std::string& detail) {
    const std::string said =
        detail.empty() && outcome == PlayerOutcome::keyRefused ? kKeyRefusedDetail : detail;
    return json{{"error", describe(outcome)}, {"detail", said}}.dump();
}

std::string tagFailureDocument(TagWriteOutcome outcome) {
    return json{{"written", false}, {"error", describe(outcome)}}.dump();
}

std::string failureDocument(ReadOutcome outcome) {
    return json{{"error", describe(outcome)}, {"detail", ""}}.dump();
}

template <PlainRefusal Refusal>
std::string refusalDocument(Refusal refusal, const std::string& detail) {
    return json{{"error", describe(refusal)}, {"detail", detail}}.dump();
}

template std::string refusalDocument(PlaylistRefusal, const std::string&);
template std::string refusalDocument(PlaybackRefusal, const std::string&);
template std::string refusalDocument(LibraryRefusal, const std::string&);

std::string tagRefusalDocument(TagWriteRefusal refusal, const std::string& detail) {
    json body{{"written", false}, {"error", describe(refusal)}, {"detail", detail}};

    if (refusal == TagWriteRefusal::fieldNotAllowed)
        body["field"] = detail;

    return body.dump();
}

std::string activeOutputRefusedDocument(const std::string& detail) {
    return json{{"error", "unacceptable output device"}, {"detail", detail}}.dump();
}

}  // namespace jean
