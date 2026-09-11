#pragma once

#include "core/artwork.h"

// The half of artwork that involves foobar2000. What a client may ask for, what validates
// the copy it holds and what type the bytes go out as were decided in src/core/artwork.h.
namespace jean {

class AlbumArt {
public:
    // Main thread only, resolved once here and used from anywhere afterwards, for the reason
    // ARCHITECTURE.md, *Facts about the player*, gives.
    AlbumArt();

    // Any thread, and never the main one, for the same reason.
    ArtworkSource of(const metadb_handle_ptr& item) const;

private:
    album_art_manager_v2::ptr loader_;
};

}  // namespace jean
