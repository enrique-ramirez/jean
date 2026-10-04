#include "fb2k/PCH.h"

#include "fb2k/tracks.h"

#include "fb2k/strings.h"

#include <memory>
#include <utility>
#include <vector>

namespace jean {

std::string displayPathOf(const metadb_handle_ptr& track) {
    if (!track.is_valid())
        return {};

    try {
        pfc::string8 display;
        filesystem::g_get_display_path(track->get_path(), display);
        return toStd(display);
    } catch (const std::exception&) {
        return track->get_path();
    }
}

std::optional<std::string> libraryPathOf(const metadb_handle_ptr& track,
                                         const library_manager::ptr& libraryManager) {
    if (!track.is_valid())
        return std::nullopt;

    pfc::string8 relative;
    if (!libraryManager->get_relative_path(track, relative))
        return std::nullopt;

    return forwardSlashed(toStd(relative));
}

NameScripts compiledNameScripts(const char* titleScript) {
    const auto compiler = titleformat_compiler::get();

    NameScripts scripts;
    compiler->compile_safe_ex(scripts.title, titleScript, "");
    compiler->compile_safe_ex(scripts.artist, kArtistScript, "");
    compiler->compile_safe_ex(scripts.album, kAlbumScript, "");
    compiler->compile_safe_ex(scripts.albumArtist, kAlbumArtistScript, "");
    return scripts;
}

std::string formattedField(const metadb_handle_ptr& track, const file_info& info,
                           const titleformat_object::ptr& script) {
    pfc::string8 out;
    track->format_title_from_external_info(info, nullptr, out, script, nullptr);
    return toStd(out);
}

metadb_handle_ptr handleOf(const SessionTrack& track) {
    const auto held = std::static_pointer_cast<const metadb_handle_ptr>(track.handle);
    return held ? *held : metadb_handle_ptr();
}

std::shared_ptr<const void> handleFor(const metadb_handle_ptr& track) {
    return std::make_shared<const metadb_handle_ptr>(track);
}

std::vector<SessionTrack> sessionTracksOf(const metadb_handle_list& handles,
                                          const library_manager::ptr& libraryManager) {
    std::vector<SessionTrack> tracks;
    tracks.reserve(handles.get_count());

    for (t_size at = 0; at < handles.get_count(); ++at) {
        const metadb_handle_ptr& handle = handles[at];

        SessionTrack track;
        track.path = displayPathOf(handle);
        track.subsong = handle.is_valid() ? handle->get_subsong_index() : 0;
        track.libraryPath = libraryPathOf(handle, libraryManager);
        track.handle = handleFor(handle);
        tracks.push_back(std::move(track));
    }

    return tracks;
}

}  // namespace jean
