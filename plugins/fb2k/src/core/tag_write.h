#pragma once

#include "core/settings.h"

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

// Turning a POST body into something safe to hand foobar2000, or into a refusal that says
// why. Pure: this half decides whether a file may be rewritten, and fb2k/tag_writer.h writes.
namespace jean {

// The library-relative address `GET /api/artwork?track=` takes, and the subsong within the
// file it names.
struct LibraryTrackRef {
    std::string track;
    uint32_t subsong = 0;
};

// A position in the media library snapshot, with the generation it was read at. The precise
// form of the library address: an ordinal names one track where a relative path can name two.
struct OrdinalTrackRef {
    uint32_t ordinal = 0;
    uint64_t structure = 0;
};

// The refusal text for an OrdinalTrackRef that fails to parse, shared with GET
// /api/track/library's ordinal form: the same address read from a query string rather than a
// JSON body.
constexpr char kBadOrdinal[] = "'ordinal' must be a non-negative number";
constexpr char kBadOrdinalStructure[] = "'structure' is required and must be a non-negative number";

// A row the media library does not hold, addressed by where a playlist holds it and by the
// structure generation the client read that position at.
struct PlaylistTrackRef {
    std::string playlistId;
    uint32_t index = 0;
    uint64_t structure = 0;
};

// Exactly one of the three; see ARCHITECTURE.md, *Track identity*.
struct TrackRef {
    std::optional<LibraryTrackRef> library;
    std::optional<OrdinalTrackRef> ordinal;
    std::optional<PlaylistTrackRef> playlist;
};

struct TagWrite {
    TrackRef track;

    // Ordered rather than hashed, so two responses can be diffed by eye.
    std::map<std::string, std::string> fields;
};

// "Fix your request" versus "ask whoever owns the player to change its configuration".
enum class TagWriteRefusal {
    none,
    malformedBody,
    badAddress,
    noFields,
    fieldNotAllowed,
};

struct TagWriteRequest {
    TagWriteRefusal refusal = TagWriteRefusal::none;

    std::string detail;

    TagWrite write;

    bool ok() const { return refusal == TagWriteRefusal::none; }
};

// Never throws: the caller is an HTTP handler, where a malformed body is routine.
TagWriteRequest parseTagWrite(const std::string& body, const Settings& settings);

enum class TagWriteOutcome {
    written,
    trackNotKnown,

    // A foobar2000 media library can have several roots, and two of them can hold one
    // library-relative path, so that address names a track under each.
    ambiguousAddress,

    rowsMoved,
    libraryRebuilt,
    writeFailed,
    timedOut,
    unavailable,
    tooFast,
};

}  // namespace jean
