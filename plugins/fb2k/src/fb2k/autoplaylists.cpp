#include "fb2k/PCH.h"

#include "fb2k/autoplaylists.h"

#include "core/ask_player.h"
#include "core/log.h"
#include "fb2k/playlist_properties.h"
#include "fb2k/playlists.h"

#include <cstddef>
#include <cstdint>
#include <string>

namespace jean {

namespace {

// Throws on a query foobar2000 cannot read, carrying its own message, which is safe to relay
// because it describes only text the client sent.
//
// KFlagAllowSort is what an autoplaylist accepts; validating without it would refuse queries the
// player would have taken.
search_filter_v2::ptr compileQuery(const std::string& query) {
    return search_filter_manager_v2::get()->create_ex(
        query.c_str(), completion_notify::ptr(),
        search_filter_manager_v2::KFlagAllowSort | search_filter_manager_v2::KFlagSuppressNotify);
}

uint32_t flagsFor(const AutoPlaylistSpec& spec) {
    return spec.forceSort ? autoplaylist_flag_sort : 0;
}

// The playlist this component may change, or the outcome saying why it may not.
struct OurPlaylist {
    size_t index = pfc::infinite_size;
    PlayerOutcome outcome = PlayerOutcome::done;
};

OurPlaylist ourPlaylist(const std::string& id) {
    const auto index = findPlaylist(id);
    if (index == pfc::infinite_size)
        return {index, PlayerOutcome::noSuchPlaylist};

    if (!ours(index))
        return {index, PlayerOutcome::notOurs};

    return {index, PlayerOutcome::done};
}

// The SDK forbids playlist callbacks from modifying playlist state, so an index taken at the top
// of one of these still names the same playlist at the bottom.
PlaylistResult createOnMainThread(const AutoPlaylistSpec& spec, const PlaylistVersions& versions,
                                  int maxAutoPlaylists) {
    const auto existing = everyPlaylist(versions);

    if (auto room = roomForAnotherAutoPlaylist(existing, maxAutoPlaylists);
        room.outcome != PlayerOutcome::done) {
        return room;
    }

    if (keyTaken(existing, spec.key, {}))
        return playlistFailure(PlayerOutcome::keyInUse, spec.key);

    try {
        compileQuery(spec.query);
    } catch (const std::exception& e) {
        return playlistFailure(PlayerOutcome::queryInvalid, e.what());
    }

    const auto manager = playlist_manager_v5::get();
    const auto index =
        manager->create_playlist(spec.title.c_str(), spec.title.size(), pfc::infinite_size);

    if (index == pfc::infinite_size)
        return playlistFailure(PlayerOutcome::playerRefused);

    // add_client_simple leaves the autoplaylist to foobar2000's core, so it survives this
    // component being removed.
    try {
        autoplaylist_manager::get()->add_client_simple(spec.query.c_str(), spec.sort.c_str(), index,
                                                       flagsFor(spec));
    } catch (const std::exception& e) {
        manager->remove_playlist(index);
        logError(std::string("could not make a new playlist into an autoplaylist: ") + e.what());
        return playlistFailure(PlayerOutcome::playerRefused);
    }

    recordAutoPlaylist(index, spec);

    logInfo("created autoplaylist '" + spec.title + "'");
    return PlaylistResult{PlayerOutcome::done, {}, annotate(index, versions)};
}

PlaylistResult updateOnMainThread(const std::string& id, const AutoPlaylistSpec& spec,
                                  const PlaylistVersions& versions) {
    const auto found = ourPlaylist(id);
    if (found.outcome != PlayerOutcome::done)
        return playlistFailure(found.outcome);

    const auto index = found.index;

    if (keyTaken(everyPlaylist(versions), spec.key, id))
        return playlistFailure(PlayerOutcome::keyInUse, spec.key);

    try {
        compileQuery(spec.query);
    } catch (const std::exception& e) {
        return playlistFailure(PlayerOutcome::queryInvalid, e.what());
    }

    const auto autoplaylists = autoplaylist_manager::get();

    // There is no "change the query" call on autoplaylist_manager.
    if (autoplaylists->is_client_present(index))
        autoplaylists->remove_client(index);

    try {
        autoplaylists->add_client_simple(spec.query.c_str(), spec.sort.c_str(), index,
                                         flagsFor(spec));
    } catch (const std::exception& e) {
        logError(std::string("autoplaylist '") + playlistTitle(index) +
                 "' lost its query and is now an ordinary playlist: " + e.what());
        return playlistFailure(PlayerOutcome::playerRefused);
    }

    if (!spec.title.empty())
        playlist_manager::get()->playlist_rename(index, spec.title.c_str(), spec.title.size());

    recordAutoPlaylist(index, spec);

    return PlaylistResult{PlayerOutcome::done, {}, annotate(index, versions)};
}

PlaylistResult removeOnMainThread(const std::string& id) {
    const auto found = ourPlaylist(id);
    if (found.outcome != PlayerOutcome::done)
        return playlistFailure(found.outcome);

    return removePlaylistAt(found.index, "autoplaylist");
}

PreviewResult previewOnMainThread(const std::string& query) {
    PreviewResult preview;
    preview.libraryEnabled = library_manager::get()->is_library_enabled();

    search_filter_v2::ptr filter;
    try {
        filter = compileQuery(query);
    } catch (const std::exception& e) {
        preview.error = e.what();
        return preview;
    }

    preview.valid = true;

    const auto matches =
        search_index_manager::get()->get_library_index()->search(filter, nullptr, 0, fb2k::noAbort);

    preview.matches = static_cast<int>(matches->get_count());
    return preview;
}

}  // namespace

AutoPlaylistCreator makeAutoPlaylistCreator(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions) {
    return [&mainThread, &versions](const AutoPlaylistSpec& spec, int maxAutoPlaylists) {
        if (maxAutoPlaylists <= 0)
            return playlistFailure(PlayerOutcome::unavailable);

        return askForOutcome<PlaylistResult>(
            mainThread, "creating an autoplaylist", [spec, &versions, maxAutoPlaylists] {
                return createOnMainThread(spec, versions, maxAutoPlaylists);
            });
    };
}

AutoPlaylistUpdater makeAutoPlaylistUpdater(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions) {
    return [&mainThread, &versions](const std::string& id, const AutoPlaylistSpec& spec) {
        return askForOutcome<PlaylistResult>(
            mainThread, "updating an autoplaylist",
            [id, spec, &versions] { return updateOnMainThread(id, spec, versions); });
    };
}

AutoPlaylistRemover makeAutoPlaylistRemover(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id) {
        return askForOutcome<PlaylistResult>(mainThread, "removing an autoplaylist",
                                             [id] { return removeOnMainThread(id); });
    };
}

QueryPreviewer makeQueryPreviewer(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& query) {
        return askForOutcome<PreviewResult>(mainThread, "previewing a query",
                                            [query] { return previewOnMainThread(query); });
    };
}

}  // namespace jean
