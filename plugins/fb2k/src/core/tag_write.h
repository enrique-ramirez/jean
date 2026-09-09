#pragma once

#include "core/settings.h"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

// Turning a POST body into something safe to hand foobar2000, or into a refusal that says
// why. Pure: this half decides whether a file may be rewritten, and fb2k/tag_writer.h writes.
namespace jean {

// Track identity is the path; see ARCHITECTURE.md, *Track identity*.
struct TrackRef {
    std::string path;
    uint32_t subsong = 0;
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
    missingPath,
    unsafePath,
    noFields,
    fieldNotAllowed,
};

struct TagWriteRequest {
    TagWriteRefusal refusal = TagWriteRefusal::none;

    std::string detail;

    TagWrite write;

    bool ok() const { return refusal == TagWriteRefusal::none; }
};

// Not a traversal guard: nothing is concatenated, and the path is an opaque key into
// foobar2000's database. It refuses paths that were never a library track -- relative,
// parent-escaping, UNC, or carrying a URL scheme.
bool isSafeTrackPath(const std::string& path);

// Never throws: the caller is an HTTP handler, where a malformed body is routine.
TagWriteRequest parseTagWrite(const std::string& body, const Settings& settings);

std::string describe(TagWriteRefusal refusal);

enum class TagWriteOutcome {
    written,
    trackNotKnown,
    writeFailed,
    timedOut,
    unavailable,
};

std::string describe(TagWriteOutcome outcome);

}  // namespace jean
