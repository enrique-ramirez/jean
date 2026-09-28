#include "fb2k/PCH.h"

#include "fb2k/playlists.h"

#include "core/log.h"
#include "core/text.h"
#include "fb2k/playlist_properties.h"
#include "fb2k/strings.h"

#include <algorithm>
#include <iterator>
#include <numeric>

namespace jean {

std::vector<size_t> playlistIndices() {
    std::vector<size_t> indices(playlist_manager::get()->get_playlist_count());
    std::iota(indices.begin(), indices.end(), size_t{0});
    return indices;
}

size_t findPlaylist(const std::string& id) {
    return playlist_manager_v5::get()->find_playlist_by_guid(pfc::GUID_from_text(id.c_str()));
}

std::string playlistId(size_t index) {
    const auto guid = playlist_manager_v5::get()->playlist_get_guid(index);
    return toLower(pfc::print_guid(guid).get_ptr());
}

std::string playlistTitle(size_t index) {
    pfc::string8 title;
    playlist_manager::get()->playlist_get_name(index, title);
    return toStd(title);
}

std::optional<PlayingLocation> queuedLocationOf(const t_playback_queue_item& item) {
    return queuedLocation(item.m_playlist, item.m_item, playlistId);
}

PlaylistAnnotation annotate(size_t index, const PlaylistVersions& versions) {
    PlaylistAnnotation playlist;
    playlist.id = playlistId(index);
    playlist.index = static_cast<int>(index);
    playlist.title = playlistTitle(index);
    playlist.itemCount = playlist_manager::get()->playlist_get_item_count(index);
    playlist.isAutoPlaylist = autoplaylist_manager::get()->is_client_present(index);
    playlist.role = roleOf(index);
    playlist.managed = storedAutoPlaylist(index);

    const auto version = versions.of(playlist.id);
    playlist.structure = version.structure;
    playlist.revision = version.revision;

    return playlist;
}

std::vector<PlaylistAnnotation> everyPlaylist(const PlaylistVersions& versions) {
    const auto indices = playlistIndices();

    std::vector<PlaylistAnnotation> playlists;
    playlists.reserve(indices.size());
    std::transform(indices.begin(), indices.end(), std::back_inserter(playlists),
                   [&versions](size_t index) { return annotate(index, versions); });

    return playlists;
}

PlaylistResult removePlaylistAt(size_t index, const std::string& kind) {
    const auto title = playlistTitle(index);

    if (!playlist_manager::get()->remove_playlist(index))
        return playlistFailure(PlayerOutcome::playerRefused);

    logInfo("removed " + kind + " '" + title + "'");
    return PlaylistResult{};
}

}  // namespace jean
