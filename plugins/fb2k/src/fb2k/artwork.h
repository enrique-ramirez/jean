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

// Registers with the core's own now-playing loader rather than resolving a cover itself, so
// GET /api/artwork/playing answers a stream and a CD track exactly as it answers a library
// file. Construction and destruction are main thread only, for the reason registering with any
// player service is; `on_album_art` arrives on whichever thread the loader finished on, which
// ARCHITECTURE.md, *Facts about the player*, says to treat as a worker and never the main one.
class NowPlayingArtworkWatch : public now_playing_album_art_notify {
public:
    explicit NowPlayingArtworkWatch(NowPlayingArtwork& store);
    ~NowPlayingArtworkWatch();

    NowPlayingArtworkWatch(const NowPlayingArtworkWatch&) = delete;
    NowPlayingArtworkWatch& operator=(const NowPlayingArtworkWatch&) = delete;

private:
    // now_playing_album_art_notify is never called for a track with no cover, for the reason
    // ARCHITECTURE.md, *Facts about the player*, gives, so the store holds whatever it was
    // last handed until the next one arrives.
    void on_album_art(album_art_data::ptr data) override;

    NowPlayingArtwork& store_;
    now_playing_album_art_notify_manager::ptr manager_;
};

}  // namespace jean
