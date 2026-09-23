#pragma once

#include "core/http_server.h"
#include "core/playlists.h"
#include "fb2k/library.h"
#include "fb2k/main_thread.h"

// The half of tag writing that involves foobar2000. Whether a write is *permitted* is
// decided in src/core/tag_write.h and has already happened by the time this runs.
namespace jean {

TagWriter makeTagWriter(MainThreadQueue& mainThread, LibraryTrackResolver resolveLibraryTrack,
                        OrdinalResolver resolveOrdinal, const PlaylistVersions& versions);

}  // namespace jean
