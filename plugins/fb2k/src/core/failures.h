#pragma once

#include "core/library.h"
#include "core/player_outcome.h"
#include "core/playlists.h"
#include "core/tag_write.h"

#include <string>

// Every refusal and failure a route answers: the sentence a client tells it apart by, the
// status it is sent under and the document that carries it.
namespace jean {

// The category `POST /playback/seek`, `POST /playback/mode` and `POST /volume` each refuse a
// malformed body under, one apiece: contract/openapi.yaml's PlaybackSeekRefusal,
// PlaybackModeRefusal and VolumeRefusal.
enum class PlaybackRefusal { none, badSeek, badMode, badVolume };

std::string describe(PlayerOutcome outcome);
std::string describe(PlaylistRefusal refusal);
std::string describe(PlaybackRefusal refusal);
std::string describe(TagWriteRefusal refusal);
std::string describe(TagWriteOutcome outcome);
std::string describe(LibraryRefusal refusal);
std::string describe(DeltaOutcome outcome);

int httpStatusFor(PlayerOutcome outcome);
int httpStatusFor(PlaylistRefusal refusal);
int httpStatusFor(PlaybackRefusal refusal);
int httpStatusFor(TagWriteRefusal refusal);
int httpStatusFor(TagWriteOutcome outcome);
int httpStatusFor(LibraryRefusal refusal);
int httpStatusFor(DeltaOutcome outcome);

std::string errorDocument(const std::string& message);

// Nothing here describes the player's internals: the detail is empty except for an
// unreadable query, where it is foobar2000's own message about text the client sent.
std::string failureDocument(PlayerOutcome outcome, const std::string& detail = {});

// No detail beyond the category: error text is a reliable way to leak paths.
std::string tagFailureDocument(TagWriteOutcome outcome);

std::string failureDocument(DeltaOutcome outcome);

std::string refusalDocument(PlaylistRefusal refusal, const std::string& detail = {});
std::string refusalDocument(PlaybackRefusal refusal, const std::string& detail);
std::string tagRefusalDocument(TagWriteRefusal refusal, const std::string& detail);
std::string refusalDocument(LibraryRefusal refusal, const std::string& detail);

// contract/openapi.yaml's ActiveOutputRefusal: the one category a malformed body can fail
// under, shaped like a PlaybackRefusal's document with the specific complaint in `detail`.
std::string activeOutputRefusedDocument(const std::string& detail);

}  // namespace jean
