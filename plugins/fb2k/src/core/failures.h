#pragma once

#include "core/library.h"
#include "core/player_outcome.h"
#include "core/playlists.h"
#include "core/tag_write.h"

#include <string>
#include <utility>

// Every refusal and failure a route answers: the sentence a client tells it apart by, the
// status it is sent under and the document that carries it.
namespace jean {

constexpr char kNoPlayback[] = "playback commands are not available";
constexpr char kNoOutputs[] = "output devices are not available";
constexpr char kModeNotOffered[] = "this install does not offer that playback mode";
constexpr char kNoVolume[] = "volume is not available";
constexpr char kNoStreaming[] = "streaming is not available";
constexpr char kStreamingDisabled[] =
    "this install has streaming turned off; turn on streamingEnabled in config.json to allow it";
constexpr char kNoQueue[] = "the queue is not available";
constexpr char kNoPlaylistRows[] = "the playlist's rows are not available";
constexpr char kNoPlaylistWrites[] = "playlist changes are not available";
constexpr char kNoOwnPlaylists[] = "the component's own playlists are not available";
constexpr char kNoLibrary[] = "the media library is not available";
constexpr char kNoSuchLibraryTrack[] = "no such track";
constexpr char kNothingPlaying[] = "nothing is playing";
constexpr char kBadSubsong[] = "'subsong' must be a whole number";
constexpr char kTwoTrackAddressForms[] = "a request names one of 'track' and 'ordinal', never both";
constexpr char kNoTrackAddressForm[] = "'track' or 'ordinal' is required";
constexpr char kLibraryTooLarge[] = "the library snapshot is larger than this component sends";
constexpr char kNoArtwork[] = "artwork is not available";
constexpr char kNoArtworkForTrack[] = "no artwork for that track";
constexpr char kUnpublishableArtwork[] = "that artwork is not in a format this component sends";
constexpr char kArtworkTooLarge[] = "that artwork is larger than this component sends";
constexpr char kSendJson[] = "send application/json";
constexpr char kColumnsRequired[] = "'columns' is required";

constexpr char kRefreshingTooFast[] = "too many library refreshes";
constexpr char kPollingTooFast[] = "too many state polls";
constexpr char kFetchingArtworkTooFast[] = "too many artwork requests";
constexpr char kReadingTracksTooFast[] = "too many track reads";

// The `detail` beside PlaylistRefusal::tooFast where a route names which budget ran out.
constexpr char kChangingPlaylistsTooFast[] =
    "playlist changes are arriving faster than they can be made";
constexpr char kPreviewingTooFast[] = "query previews are arriving faster than they can be run";

// The category `POST /playback/seek`, `POST /playback/mode` and `POST /volume` each refuse a
// malformed body under, one apiece: contract/openapi.yaml's PlaybackSeekRefusal,
// PlaybackModeRefusal and VolumeRefusal.
enum class PlaybackRefusal { none, badSeek, badMode, badVolume };

template <typename Request, typename Refusal>
Request refused(Refusal refusal) {
    Request request;
    request.refusal = refusal;
    return request;
}

template <typename Request, typename Refusal>
Request refused(Refusal refusal, std::string detail) {
    auto request = refused<Request>(refusal);
    request.detail = std::move(detail);
    return request;
}

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
