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
// player service is; which thread `on_album_art` arrives on is not this file's to assume, and
// ARCHITECTURE.md, *Facts about the player*, has what is known about it.
class NowPlayingArtworkWatch : public now_playing_album_art_notify {
public:
    explicit NowPlayingArtworkWatch(NowPlayingArtwork& store);
    ~NowPlayingArtworkWatch();

    NowPlayingArtworkWatch(const NowPlayingArtworkWatch&) = delete;
    NowPlayingArtworkWatch& operator=(const NowPlayingArtworkWatch&) = delete;

private:
    // foobar2000 breaks the SDK's own album_art.h promise that this is never called with a
    // null object, for the reason ARCHITECTURE.md, *Facts about the player*, gives. bytesOf
    // answers an empty string for a null data, and NowPlayingArtwork::hold treats an empty
    // picture the same as letting go of one, so this callback needs no branch of its own;
    // PlaybackWatch::Callback::on_playback_new_track is what lets go of a picture on an
    // ordinary track change.
    void on_album_art(album_art_data::ptr data) override;

    NowPlayingArtwork& store_;
    now_playing_album_art_notify_manager::ptr manager_;
};

}  // namespace jean
