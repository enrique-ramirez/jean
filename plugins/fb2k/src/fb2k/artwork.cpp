#include "fb2k/PCH.h"

#include "fb2k/artwork.h"

#include "core/log.h"

#include <memory>
#include <string>
#include <utility>

namespace jean {

namespace {

std::string bytesOf(const album_art_data_ptr& data) {
    if (data.is_empty())
        return {};

    return std::string(reinterpret_cast<const char*>(data->begin()), data->size());
}

// album_art_extractor_instance::query throws rather than answering nothing, both for a track
// foobar2000 has no cover for and for a file that has gone since the snapshot named it.
std::string pictureOf(const album_art_extractor_instance_v2::ptr& art, const GUID& what) {
    try {
        return bytesOf(art->query(what, fb2k::noAbort));
    } catch (const std::exception&) {
        return {};
    }
}

// The foobar2000 SDK's album_art_extractor::g_open reads the pictures a file's own tags carry and
// never one beside it, and throws for a file with none.
std::string embeddedPictureOf(const metadb_handle_ptr& item, const GUID& what) {
    try {
        const auto art = album_art_extractor::g_open(nullptr, item->get_path(), fb2k::noAbort);
        return bytesOf(art->query(what, fb2k::noAbort));
    } catch (const std::exception&) {
        return {};
    }
}

}  // namespace

AlbumArt::AlbumArt() : loader_(album_art_manager_v2::tryGet()) {
    if (loader_.is_empty())
        logError("this foobar2000 has no album art loader, so GET /api/artwork finds nothing");
}

ArtworkSource AlbumArt::of(const metadb_handle_ptr& item) const {
    if (loader_.is_empty())
        return {};

    // The front cover alone. Every other album_art_ids entry is a picture a client would
    // have to address separately, and none of them is what a record's sleeve is.
    const GUID& what = album_art_ids::cover_front;

    try {
        metadb_handle_list one;
        one.add_item(item);

        const auto art = loader_->open(one, pfc::list_single_ref_t<GUID>(what), fb2k::noAbort);

        auto picture = publishablePicture(pictureOf(art, what),
                                          [&item, &what] { return embeddedPictureOf(item, what); });
        if (picture.empty())
            return {};

        ArtworkSource source;
        source.tag = artworkTag(picture);
        source.picture = std::make_shared<const std::string>(std::move(picture));
        return source;
    } catch (const std::exception&) {
        return {};
    }
}

NowPlayingArtworkWatch::NowPlayingArtworkWatch(NowPlayingArtwork& store)
    : store_(store), manager_(now_playing_album_art_notify_manager::tryGet()) {
    if (manager_.is_empty()) {
        logError(
            "this foobar2000 has no now-playing album art loader, so "
            "GET /api/artwork/playing finds nothing");
        return;
    }

    manager_->add(this);
}

NowPlayingArtworkWatch::~NowPlayingArtworkWatch() {
    if (!manager_.is_empty())
        manager_->remove(this);
}

void NowPlayingArtworkWatch::on_album_art(album_art_data::ptr data) {
    store_.hold(bytesOf(data));
}

}  // namespace jean
