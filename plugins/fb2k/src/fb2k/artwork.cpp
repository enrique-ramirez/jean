#include "fb2k/PCH.h"

#include "fb2k/artwork.h"

#include "core/log.h"

#include <string>
#include <vector>

namespace jean {

namespace {

std::string bytesOf(const album_art_data_ptr& data) {
    return std::string(reinterpret_cast<const char*>(data->begin()), data->size());
}

// Empty is how the caller says there is no picture, and a file deleted between the stat and
// the read is exactly that by the time anybody looks.
std::string pictureOf(const album_art_extractor_instance_v2::ptr& art, const GUID& what) {
    try {
        return bytesOf(art->query(what, fb2k::noAbort));
    } catch (const std::exception&) {
        return {};
    }
}

// stats2_legacy is the size and the modification time and nothing else, which is the whole
// of what an ETag is folded from.
bool statOne(const char* path, ArtworkFile& file) {
    try {
        const auto stats = filesystem::g_get_stats2(path, stats2_legacy, fb2k::noAbort);
        if (!stats.haveSize() || !stats.haveTimestamp())
            return false;

        file.path = path;
        file.size = stats.m_size;
        file.modified = stats.m_timestamp;
        return true;
    } catch (const std::exception&) {
        return false;
    }
}

std::vector<ArtworkFile> sourcesOf(const album_art_extractor_instance_v2::ptr& art,
                                   const GUID& what) {
    album_art_path_list::ptr paths;

    try {
        paths = art->query_paths(what, fb2k::noAbort);
    } catch (const std::exception&) {
        return {};
    }

    if (paths.is_empty())
        return {};

    std::vector<ArtworkFile> files(paths->get_count());
    for (size_t at = 0; at < files.size(); ++at) {
        if (!statOne(paths->get_path(at), files[at]))
            return {};
    }

    return files;
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

        ArtworkSource source;

        if (const auto files = sourcesOf(art, what); !files.empty()) {
            source.tag = artworkTag(files);
            source.read = [art, what] { return pictureOf(art, what); };
            return source;
        }

        const auto picture = pictureOf(art, what);
        if (picture.empty())
            return {};

        source.tag = artworkTagOfBytes(picture);
        source.read = [picture] { return picture; };
        return source;
    } catch (const std::exception&) {
        return {};
    }
}

}  // namespace jean
