#pragma once

#include "core/main_thread_queue.h"
#include "core/player.h"
#include "fb2k/artwork.h"

namespace jean {

SessionTrackReader makeSessionTrackReader(MainThreadQueue& mainThread);

SessionArtworkReader makeSessionArtworkReader(const AlbumArt& art);

}  // namespace jean
