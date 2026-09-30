#include "fb2k/PCH.h"

#include "fb2k/autoplaylists.h"

#include "core/ask_player.h"
#include "core/log.h"
#include "core/refusal_order.h"
#include "fb2k/playlist_properties.h"
#include "fb2k/playlists.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>

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

struct AutoPlaylistTarget {
    size_t index = pfc::infinite_size;
    PlayerOutcome outcome = PlayerOutcome::done;
};

AutoPlaylistTarget findAutoPlaylist(const std::string& id) {
    const auto index = findPlaylist(id);

    PlaylistEditFacts facts;
    facts.noSuchPlaylist = index == pfc::infinite_size;
    facts.ownPlaylist = !facts.noSuchPlaylist && roleOf(index).has_value();
    if (const auto refusal = playlistEditRefusal(facts); refusal != PlayerOutcome::done)
        return {index, refusal};

    // foobar2000 replaces a plain playlist's rows with a query's results once it is made an
    // autoplaylist. One that still carries this component's record lost its client to a failed
    // update, and is the one plain playlist accepted: sending the update again restores it.
    if (!autoplaylist_manager::get()->is_client_present(index) && !ours(index))
        return {index, PlayerOutcome::notAnAutoPlaylist};

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
    const auto found = findAutoPlaylist(id);
    if (found.outcome != PlayerOutcome::done)
        return playlistFailure(found.outcome);

    const auto index = found.index;

    const bool made = ours(index);
    if (!made && !spec.key.empty())
        return playlistFailure(PlayerOutcome::keyRefused);

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

    if (made)
        recordAutoPlaylist(index, spec);

    return PlaylistResult{PlayerOutcome::done, {}, annotate(index, versions)};
}

PlaylistResult removeOnMainThread(const std::string& id) {
    const auto found = findAutoPlaylist(id);
    if (found.outcome != PlayerOutcome::done)
        return playlistFailure(found.outcome);

    if (lockRefuses(found.index, playlist_lock::filter_remove_playlist))
        return playlistFailure(PlayerOutcome::playlistLocked);

    return removePlaylistAt(found.index, "autoplaylist");
}

PreviewResult previewOnMainThread(const std::string& query, bool withRows,
                                  metadb_handle_list& matched) {
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

    if (withRows) {
        matched.set_size(matches->get_count());
        size_t at = 0;
        for (const metadb_handle_ptr& handle : matches->typed<metadb_handle>())
            matched[at++] = handle;
    }

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

QueryPreviewer makeQueryPreviewer(MainThreadQueue& mainThread, OrdinalMatcher ordinalMatcher) {
    return [&mainThread, ordinalMatcher = std::move(ordinalMatcher)](const std::string& query,
                                                                     bool withRows) {
        const auto matched = std::make_shared<metadb_handle_list>();
        auto preview = askForOutcome<PreviewResult>(
            mainThread, "previewing a query",
            [query, withRows, matched] { return previewOnMainThread(query, withRows, *matched); });

        if (preview.outcome != PlayerOutcome::done || !preview.valid || !withRows)
            return preview;

        MatchedOrdinals found;
        if (ordinalMatcher)
            found = ordinalMatcher(*matched);

        preview.hasRows = true;
        preview.structure = found.structure;
        preview.ordinals = std::move(found.ordinals);
        return preview;
    };
}

}  // namespace jean
