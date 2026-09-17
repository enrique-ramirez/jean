#include "fb2k/PCH.h"

#include "fb2k/playlists.h"

#include "core/log.h"
#include "core/text.h"
#include "fb2k/ask_player.h"
#include "fb2k/strings.h"

#include <algorithm>
#include <iterator>
#include <numeric>
#include <string>
#include <vector>

namespace jean {

namespace {

// {45837D74-FA4F-415C-BBA9-BF2DB8F0DC04}
constexpr GUID kJeanRecord = {
    0x45837d74, 0xfa4f, 0x415c, {0xbb, 0xa9, 0xbf, 0x2d, 0xb8, 0xf0, 0xdc, 0x04}};

// {E937900E-EF79-4574-81B1-2A840C1741CC}
constexpr GUID kBeefwebId = {
    0xe937900e, 0xef79, 0x4574, {0x81, 0xb1, 0x2a, 0x84, 0x0c, 0x17, 0x41, 0xcc}};

// {651E1108-C122-49F5-94E1-89C184CAEDFA}
constexpr GUID kOwnPlaylist = {
    0x651e1108, 0xc122, 0x49f5, {0x94, 0xe1, 0x89, 0xc1, 0x84, 0xca, 0xed, 0xfa}};

std::string readProperty(size_t index, const GUID& property) {
    pfc::array_t<uint8_t> stored;
    if (!playlist_manager_v2::get()->playlist_get_property(index, property, stored))
        return std::string();

    if (stored.get_size() == 0)
        return std::string();

    return std::string(reinterpret_cast<const char*>(stored.get_ptr()), stored.get_size());
}

void writeProperty(size_t index, const GUID& property, const std::string& value) {
    stream_reader_memblock_ref stream{value.data(), value.size()};
    playlist_manager_v2::get()->playlist_set_property(index, property, &stream, value.size(),
                                                      fb2k::noAbort);
}

std::string playlistTitle(size_t index) {
    pfc::string8 title;
    playlist_manager::get()->playlist_get_name(index, title);
    return toStd(title);
}

PlaylistAnnotation annotate(size_t index) {
    PlaylistAnnotation playlist;
    playlist.id = playlistId(index);
    playlist.index = static_cast<int>(index);
    playlist.title = playlistTitle(index);
    playlist.isAutoPlaylist = autoplaylist_manager::get()->is_client_present(index);

    if (const auto beefwebId = readProperty(index, kBeefwebId); looksLikeBeefwebId(beefwebId))
        playlist.beefwebId = beefwebId;

    if (const auto stored = readProperty(index, kJeanRecord); !stored.empty())
        playlist.managed = parseStoredAutoPlaylist(stored);

    return playlist;
}

std::vector<PlaylistAnnotation> everyPlaylist() {
    const auto indices = playlistIndices();

    std::vector<PlaylistAnnotation> playlists;
    playlists.reserve(indices.size());
    std::transform(indices.begin(), indices.end(), std::back_inserter(playlists), annotate);

    return playlists;
}

// pfc::infinite_size when nothing matches. pfc::GUID_from_text never reports a failure, so
// after the shape check in core/playlists.h this is the only thing that can say "no such
// playlist".
size_t findPlaylist(const std::string& id) {
    return playlist_manager_v5::get()->find_playlist_by_guid(pfc::GUID_from_text(id.c_str()));
}

// Throws on a query foobar2000 cannot read, carrying its own message, which is safe to
// relay because it describes only text the client sent.
//
// KFlagAllowSort is what an autoplaylist accepts; validating without it would refuse
// queries the player would have taken.
search_filter_v2::ptr compileQuery(const std::string& query) {
    return search_filter_manager_v2::get()->create_ex(
        query.c_str(), completion_notify::ptr(),
        search_filter_manager_v2::KFlagAllowSort | search_filter_manager_v2::KFlagSuppressNotify);
}

uint32_t flagsFor(const AutoPlaylistSpec& spec) {
    return spec.forceSort ? autoplaylist_flag_sort : 0;
}

bool ours(size_t index) {
    return !readProperty(index, kJeanRecord).empty();
}

// The playlist this component may change, or the outcome saying why it may not. Main
// thread.
struct OurPlaylist {
    size_t index = pfc::infinite_size;
    PlaylistOutcome outcome = PlaylistOutcome::done;
};

OurPlaylist ourPlaylist(const std::string& id) {
    const auto index = findPlaylist(id);
    if (index == pfc::infinite_size)
        return {index, PlaylistOutcome::noSuchPlaylist};

    if (!ours(index))
        return {index, PlaylistOutcome::notOurs};

    return {index, PlaylistOutcome::done};
}

// Main thread. The SDK forbids playlist callbacks from modifying playlist state, so an
// index taken at the top of one of these still names the same playlist at the bottom.
void beginCreate(const AutoPlaylistSpec& spec, int maxAutoPlaylists,
                 const AnswerPtr<PlaylistResult>& answer) {
    const auto existing = everyPlaylist();

    if (const auto room = roomForAnotherAutoPlaylist(existing, maxAutoPlaylists);
        room.outcome != PlaylistOutcome::done) {
        answer->set(room);
        return;
    }

    if (keyTaken(existing, spec.key, {})) {
        answer->set(playlistFailure(PlaylistOutcome::keyInUse, spec.key));
        return;
    }

    try {
        compileQuery(spec.query);
    } catch (const std::exception& e) {
        answer->set(playlistFailure(PlaylistOutcome::queryInvalid, e.what()));
        return;
    }

    auto manager = playlist_manager_v5::get();
    const auto index =
        manager->create_playlist(spec.title.c_str(), spec.title.size(), pfc::infinite_size);

    if (index == pfc::infinite_size) {
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    try {
        autoplaylist_manager::get()->add_client_simple(spec.query.c_str(), spec.sort.c_str(), index,
                                                       flagsFor(spec));
    } catch (const std::exception& e) {
        manager->remove_playlist(index);
        logError(std::string("could not make a new playlist into an autoplaylist: ") + e.what());
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    writeProperty(index, kJeanRecord, serialiseAutoPlaylist(spec));

    logInfo("created autoplaylist '" + spec.title + "'");
    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index)});
}

void beginUpdate(const std::string& id, const AutoPlaylistSpec& spec,
                 const AnswerPtr<PlaylistResult>& answer) {
    const auto found = ourPlaylist(id);
    if (found.outcome != PlaylistOutcome::done) {
        answer->set(playlistFailure(found.outcome));
        return;
    }

    const auto index = found.index;

    if (keyTaken(everyPlaylist(), spec.key, id)) {
        answer->set(playlistFailure(PlaylistOutcome::keyInUse, spec.key));
        return;
    }

    try {
        compileQuery(spec.query);
    } catch (const std::exception& e) {
        answer->set(playlistFailure(PlaylistOutcome::queryInvalid, e.what()));
        return;
    }

    auto autoplaylists = autoplaylist_manager::get();

    // There is no "change the query" call on autoplaylist_manager.
    if (autoplaylists->is_client_present(index))
        autoplaylists->remove_client(index);

    try {
        autoplaylists->add_client_simple(spec.query.c_str(), spec.sort.c_str(), index,
                                         flagsFor(spec));
    } catch (const std::exception& e) {
        logError(std::string("autoplaylist '") + playlistTitle(index) +
                 "' lost its query and is now an ordinary playlist: " + e.what());
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    if (!spec.title.empty())
        playlist_manager::get()->playlist_rename(index, spec.title.c_str(), spec.title.size());

    writeProperty(index, kJeanRecord, serialiseAutoPlaylist(spec));

    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index)});
}

void beginRemove(const std::string& id, const AnswerPtr<PlaylistResult>& answer) {
    const auto found = ourPlaylist(id);
    if (found.outcome != PlaylistOutcome::done) {
        answer->set(playlistFailure(found.outcome));
        return;
    }

    const auto index = found.index;
    const auto title = playlistTitle(index);

    if (!playlist_manager::get()->remove_playlist(index)) {
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    logInfo("removed autoplaylist '" + title + "'");
    answer->set(PlaylistResult{});
}

std::string roleId(OwnPlaylistRole role) {
    switch (role) {
        case OwnPlaylistRole::scratch:
            return "scratch";
        case OwnPlaylistRole::queue:
            return "queue";
    }

    return {};
}

size_t findOwnPlaylist(OwnPlaylistRole role) {
    const auto want = roleId(role);
    const auto indices = playlistIndices();
    const auto found = std::find_if(indices.begin(), indices.end(), [&want](size_t index) {
        return readProperty(index, kOwnPlaylist) == want;
    });

    return found == indices.end() ? pfc::infinite_size : *found;
}

void beginOwnPlaylist(OwnPlaylistRole role, const std::string& title,
                      const AnswerPtr<PlaylistResult>& answer) {
    auto index = findOwnPlaylist(role);

    if (index == pfc::infinite_size) {
        auto manager = playlist_manager_v5::get();
        index = manager->create_playlist(title.c_str(), title.size(), pfc::infinite_size);

        if (index == pfc::infinite_size) {
            answer->set(playlistFailure(PlaylistOutcome::playerRefused));
            return;
        }

        writeProperty(index, kOwnPlaylist, roleId(role));
        logInfo("created own playlist '" + title + "'");
    }

    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index)});
}

// foobar2000 crashes if a playlist the play queue points into is deleted. Removing its items
// rather than the playlist itself keeps the id, and the queue, intact.
void removeEveryItem(size_t index) {
    playlist_manager_v5::get()->playlist_remove_items(index, bit_array_true());
}

// A role with no playlist yet has nothing to empty, so this reports success without making
// one: creating a playlist only to answer a request for less music in it would be odd.
void beginEmptyOwnPlaylist(OwnPlaylistRole role, const AnswerPtr<PlaylistResult>& answer) {
    const auto index = findOwnPlaylist(role);
    if (index == pfc::infinite_size) {
        answer->set(PlaylistResult{});
        return;
    }

    removeEveryItem(index);
    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index)});
}

void beginFill(const std::string& playlistId, const std::string& title, uint64_t structure,
               const std::vector<uint32_t>& ordinals, bool replace,
               const OrdinalResolver& resolveOrdinals, const AnswerPtr<FillResult>& answer) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size) {
        answer->set(FillResult{PlaylistOutcome::noSuchPlaylist, {}});
        return;
    }

    const auto resolved = resolveOrdinals(structure, ordinals);
    if (!resolved.structureMatched) {
        answer->set(FillResult{PlaylistOutcome::structureMoved, {}});
        return;
    }

    if (!title.empty())
        playlist_manager::get()->playlist_rename(index, title.c_str(), title.size());

    auto manager = playlist_manager_v5::get();

    if (replace)
        removeEveryItem(index);

    const auto base = manager->playlist_get_item_count(index);
    manager->playlist_insert_items(index, base, resolved.items, bit_array_false());

    std::vector<size_t> positions(resolved.items.get_count());
    std::iota(positions.begin(), positions.end(), base);

    answer->set(FillResult{PlaylistOutcome::done, std::move(positions), annotate(index).beefwebId});
}

void beginPreview(const std::string& query, const AnswerPtr<PreviewResult>& answer) {
    PreviewResult preview;

    preview.libraryEnabled = library_manager::get()->is_library_enabled();

    search_filter_v2::ptr filter;
    try {
        filter = compileQuery(query);
    } catch (const std::exception& e) {
        preview.error = e.what();
        answer->set(preview);
        return;
    }

    preview.valid = true;

    const auto matches =
        search_index_manager::get()->get_library_index()->search(filter, nullptr, 0, fb2k::noAbort);

    preview.matches = static_cast<int>(matches->get_count());
    answer->set(preview);
}

}  // namespace

std::vector<size_t> playlistIndices() {
    std::vector<size_t> indices(playlist_manager::get()->get_playlist_count());
    std::iota(indices.begin(), indices.end(), size_t{0});
    return indices;
}

std::string playlistId(size_t index) {
    const auto guid = playlist_manager_v5::get()->playlist_get_guid(index);
    return toLower(pfc::print_guid(guid).get_ptr());
}

std::optional<PlayingLocation> queuedLocationOf(const t_playback_queue_item& item) {
    return queuedLocation(item.m_playlist, item.m_item, playlistId);
}

PlaylistLister makePlaylistLister(MainThreadQueue& mainThread) {
    return [&mainThread] {
        return askPlayer<PlaylistsResult>(
            mainThread, "listing playlists",
            [](const AnswerPtr<PlaylistsResult>& answer) {
                answer->set(PlaylistsResult{PlaylistOutcome::done, everyPlaylist()});
            },
            PlaylistsResult{PlaylistOutcome::timedOut, {}},
            PlaylistsResult{PlaylistOutcome::playerRefused, {}});
    };
}

AutoPlaylistCreator makeAutoPlaylistCreator(MainThreadQueue& mainThread, int maxAutoPlaylists) {
    return [&mainThread, maxAutoPlaylists](const AutoPlaylistSpec& spec) {
        if (maxAutoPlaylists <= 0)
            return playlistFailure(PlaylistOutcome::unavailable);

        return askPlayer<PlaylistResult>(
            mainThread, "creating an autoplaylist",
            [spec, maxAutoPlaylists](const AnswerPtr<PlaylistResult>& answer) {
                beginCreate(spec, maxAutoPlaylists, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

AutoPlaylistUpdater makeAutoPlaylistUpdater(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id, const AutoPlaylistSpec& spec) {
        return askPlayer<PlaylistResult>(
            mainThread, "updating an autoplaylist",
            [id, spec](const AnswerPtr<PlaylistResult>& answer) { beginUpdate(id, spec, answer); },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

AutoPlaylistRemover makeAutoPlaylistRemover(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id) {
        return askPlayer<PlaylistResult>(
            mainThread, "removing an autoplaylist",
            [id](const AnswerPtr<PlaylistResult>& answer) { beginRemove(id, answer); },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

OwnPlaylistResolver makeOwnPlaylistResolver(MainThreadQueue& mainThread) {
    return [&mainThread](OwnPlaylistRole role, const std::string& title) {
        return askPlayer<PlaylistResult>(
            mainThread, "resolving one of the component's own playlists",
            [role, title](const AnswerPtr<PlaylistResult>& answer) {
                beginOwnPlaylist(role, title, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

OwnPlaylistEmptier makeOwnPlaylistEmptier(MainThreadQueue& mainThread) {
    return [&mainThread](OwnPlaylistRole role) {
        return askPlayer<PlaylistResult>(
            mainThread, "emptying one of the component's own playlists",
            [role](const AnswerPtr<PlaylistResult>& answer) {
                beginEmptyOwnPlaylist(role, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistFiller makePlaylistFiller(MainThreadQueue& mainThread, OrdinalResolver resolveOrdinals) {
    return [&mainThread, resolveOrdinals](const std::string& playlistId, const std::string& title,
                                          uint64_t structure, const std::vector<uint32_t>& ordinals,
                                          bool replace) {
        return askPlayer<FillResult>(
            mainThread, "filling a playlist",
            [playlistId, title, structure, ordinals, replace, resolveOrdinals](
                const AnswerPtr<FillResult>& answer) {
                beginFill(playlistId, title, structure, ordinals, replace, resolveOrdinals, answer);
            },
            FillResult{PlaylistOutcome::timedOut, {}},
            FillResult{PlaylistOutcome::playerRefused, {}});
    };
}

QueryPreviewer makeQueryPreviewer(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& query) {
        return askPlayer<PreviewResult>(
            mainThread, "previewing a query",
            [query](const AnswerPtr<PreviewResult>& answer) { beginPreview(query, answer); },
            previewFailure(PlaylistOutcome::timedOut),
            previewFailure(PlaylistOutcome::playerRefused));
    };
}

}  // namespace jean
