#include "fb2k/PCH.h"

#include "fb2k/tracks.h"

#include "fb2k/strings.h"

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

}  // namespace jean
