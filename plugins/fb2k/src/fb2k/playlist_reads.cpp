#include "fb2k/PCH.h"

#include "fb2k/playlist_reads.h"

#include "core/ask_player.h"
#include "core/library.h"
#include "fb2k/columns.h"
#include "fb2k/playlist_properties.h"
#include "fb2k/playlists.h"
#include "fb2k/tracks.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace jean {

namespace {

// What the main thread hands over for a page of rows: the handles, the cheap half, and the
// compiled columns to run against them off it.
struct CopiedPage {
    PlayerOutcome outcome = PlayerOutcome::done;
    uint64_t structure = 0;
    uint64_t revision = 0;
    size_t totalCount = 0;
    metadb_handle_list handles;
    std::vector<titleformat_object::ptr> scripts;
};

CopiedPage copyRowsOnMainThread(const std::string& playlistId, const PlaylistRowsAsked& rows,
                                const std::vector<std::string>& columns,
                                const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size)
        return failureOf<CopiedPage>(PlayerOutcome::noSuchPlaylist);

    CopiedPage page;

    const auto version = versions.of(playlistId);
    page.structure = version.structure;
    page.revision = version.revision;

    const auto manager = playlist_manager::get();
    page.totalCount = manager->playlist_get_item_count(index);

    if (rows.positions) {
        for (const uint32_t position : *rows.positions) {
            metadb_handle_ptr handle;
            if (position >= page.totalCount ||
                !manager->playlist_get_item_handle(handle, index, position))
                return failureOf<CopiedPage>(PlayerOutcome::positionPastEnd);
            page.handles.add_item(handle);
        }
    } else {
        const auto from = std::min<size_t>(rows.offset, page.totalCount);
        const auto taken = std::min<size_t>(rows.count, page.totalCount - from);
        manager->playlist_get_items(index, page.handles, bit_array_range(from, taken, true));
    }

    page.scripts = compiledColumns(titleformat_compiler::get(), columns);
    return page;
}

struct CopiedPlaylist {
    PlayerOutcome outcome = PlayerOutcome::done;
    uint64_t structure = 0;
    uint64_t revision = 0;
    metadb_handle_list handles;
    std::vector<titleformat_object::ptr> scripts;
};

CopiedPlaylist copyPlaylistOnMainThread(const std::string& playlistId,
                                        const std::vector<std::string>& columns,
                                        const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size)
        return failureOf<CopiedPlaylist>(PlayerOutcome::noSuchPlaylist);

    CopiedPlaylist playlist;

    const auto version = versions.of(playlistId);
    playlist.structure = version.structure;
    playlist.revision = version.revision;

    playlist_manager::get()->playlist_get_all_items(index, playlist.handles);

    playlist.scripts = compiledColumns(titleformat_compiler::get(), columns);
    return playlist;
}

struct CopiedChanges {
    PlayerOutcome outcome = PlayerOutcome::done;
    ReadOutcome catchUp = ReadOutcome::ok;
    uint64_t revision = 0;
    std::vector<uint32_t> positions;
    metadb_handle_list handles;
    std::vector<titleformat_object::ptr> scripts;
};

CopiedChanges copyChangedRowsOnMainThread(const std::string& playlistId, uint64_t structure,
                                          uint64_t since, const std::vector<std::string>& columns,
                                          const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size)
        return failureOf<CopiedChanges>(PlayerOutcome::noSuchPlaylist);

    const ChangedSince changed = versions.changedSince(playlistId, structure, since);

    CopiedChanges copied;
    copied.catchUp = changed.catchUp;
    copied.revision = changed.revision;
    if (copied.catchUp != ReadOutcome::ok)
        return copied;

    const auto manager = playlist_manager::get();
    const auto itemCount = manager->playlist_get_item_count(index);

    for (const uint32_t position : changed.positions) {
        metadb_handle_ptr handle;
        if (position >= itemCount || !manager->playlist_get_item_handle(handle, index, position))
            continue;

        copied.positions.push_back(position);
        copied.handles.add_item(handle);
    }

    copied.scripts = compiledColumns(titleformat_compiler::get(), columns);
    return copied;
}

PlaylistRoleRead roleOnMainThread(const std::string& playlistId) {
    PlaylistRoleRead read;

    const auto index = findPlaylist(playlistId);
    if (index != pfc::infinite_size)
        read.role = roleOf(index);

    return read;
}

struct RowHandle {
    PlayerOutcome outcome = PlayerOutcome::done;
    metadb_handle_ptr handle;
};

RowHandle readRowHandleOnMainThread(const std::string& playlistId, uint32_t row) {
    const auto playlist = findPlaylist(playlistId);
    if (playlist == pfc::infinite_size)
        return failureOf<RowHandle>(PlayerOutcome::noSuchPlaylist);

    const auto manager = playlist_manager::get();
    if (row >= manager->playlist_get_item_count(playlist))
        return failureOf<RowHandle>(PlayerOutcome::positionPastEnd);

    RowHandle found;
    if (!manager->playlist_get_item_handle(found.handle, playlist, row))
        return failureOf<RowHandle>(PlayerOutcome::playerRefused);

    return found;
}

struct TakenHandles {
    PlayerOutcome outcome = PlayerOutcome::done;
    metadb_handle_list handles;
};

TakenHandles takeHandlesOnMainThread(const std::string& playlistId,
                                     const std::optional<std::vector<uint32_t>>& positions) {
    const auto playlist = findPlaylist(playlistId);
    if (playlist == pfc::infinite_size)
        return failureOf<TakenHandles>(PlayerOutcome::noSuchPlaylist);

    const auto manager = playlist_manager::get();
    TakenHandles taken;

    if (!positions) {
        manager->playlist_get_all_items(playlist, taken.handles);
        return taken;
    }

    const auto rowCount = manager->playlist_get_item_count(playlist);
    if (std::any_of(positions->begin(), positions->end(),
                    [rowCount](uint32_t position) { return position >= rowCount; }))
        return failureOf<TakenHandles>(PlayerOutcome::positionPastEnd);

    for (const uint32_t position : *positions) {
        metadb_handle_ptr handle;
        if (!manager->playlist_get_item_handle(handle, playlist, position))
            return failureOf<TakenHandles>(PlayerOutcome::playerRefused);
        taken.handles.add_item(handle);
    }

    return taken;
}

PlaylistRow formattedRow(const metadb_handle_ptr& handle,
                         const std::vector<titleformat_object::ptr>& scripts,
                         const library_manager::ptr& libraryManager) {
    PlaylistRow row;
    row.columns.assign(scripts.size(), kUnresolved);

    if (!handle.is_valid())
        return row;

    row.subsong = handle->get_subsong_index();
    row.columns = formattedColumns(handle, scripts);
    row.libraryPath = libraryPathOf(handle, libraryManager);
    return row;
}

}  // namespace

PlaylistLister makePlaylistLister(MainThreadQueue& mainThread, const PlaylistVersions& versions) {
    return [&mainThread, &versions] {
        return askForOutcome<PlaylistsResult>(mainThread, "listing playlists", [&versions] {
            return PlaylistsResult{PlayerOutcome::done, everyPlaylist(versions)};
        });
    };
}

PlaylistRoleReader makePlaylistRoleReader(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& playlistId) {
        return askForOutcome<PlaylistRoleRead>(
            mainThread, "reading a playlist's role",
            [playlistId] { return roleOnMainThread(playlistId); });
    };
}

PlaylistRowReader makePlaylistRowReader(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions) {
    const auto libraryManager = library_manager::get();

    return [&mainThread, &versions, libraryManager](const std::string& playlistId,
                                                    const PlaylistRowsAsked& rows,
                                                    const std::vector<std::string>& columns) {
        const auto page = askForOutcome<CopiedPage>(
            mainThread, "reading rows of a playlist", [playlistId, rows, columns, &versions] {
                return copyRowsOnMainThread(playlistId, rows, columns, versions);
            });

        PlaylistRowsRead read;
        read.outcome = page.outcome;
        read.structure = page.structure;
        read.revision = page.revision;
        read.totalCount = page.totalCount;

        if (read.outcome != PlayerOutcome::done)
            return read;

        read.rows.reserve(page.handles.get_count());
        for (size_t at = 0; at < page.handles.get_count(); ++at)
            read.rows.push_back(formattedRow(page.handles[at], page.scripts, libraryManager));

        return read;
    };
}

PlaylistTrackReader makePlaylistTracksReader(MainThreadQueue& mainThread,
                                             const PlaylistVersions& versions,
                                             HandleOrdinalMapper ordinalsOf) {
    return [&mainThread, &versions, ordinalsOf = std::move(ordinalsOf)](
               const std::string& playlistId, const std::vector<std::string>& columns) {
        const auto copied = askForOutcome<CopiedPlaylist>(
            mainThread, "reading every row of a playlist", [playlistId, columns, &versions] {
                return copyPlaylistOnMainThread(playlistId, columns, versions);
            });

        PlaylistTracksRead read;
        read.outcome = copied.outcome;
        read.structure = copied.structure;
        read.revision = copied.revision;

        if (read.outcome != PlayerOutcome::done)
            return read;

        HandleOrdinals held;
        if (ordinalsOf)
            held = ordinalsOf(copied.handles);
        read.libraryStructure = held.structure;

        read.rows.reserve(copied.handles.get_count());
        for (size_t at = 0; at < copied.handles.get_count(); ++at) {
            const std::optional<uint32_t> ordinal =
                at < held.ordinals.size() ? held.ordinals[at] : std::nullopt;
            if (ordinal) {
                read.rows.push_back({ordinal, {}});
                continue;
            }

            const metadb_handle_ptr& handle = copied.handles[at];
            read.rows.push_back(
                {std::nullopt, handle.is_valid()
                                   ? formattedColumns(handle, copied.scripts)
                                   : std::vector<std::string>(copied.scripts.size(), kUnresolved)});
        }

        return read;
    };
}

PlaylistChangeReader makeChangedPlaylistRowReader(MainThreadQueue& mainThread,
                                                  const PlaylistVersions& versions) {
    const auto libraryManager = library_manager::get();

    return [&mainThread, libraryManager, &versions](const std::string& playlistId,
                                                    uint64_t structure, uint64_t since,
                                                    const std::vector<std::string>& columns) {
        const auto copied = askForOutcome<CopiedChanges>(
            mainThread, "reading a playlist's changed rows",
            [playlistId, structure, since, columns, &versions] {
                return copyChangedRowsOnMainThread(playlistId, structure, since, columns, versions);
            });

        PlaylistChangesRead read;
        read.outcome = copied.outcome;
        read.catchUp = copied.catchUp;
        read.revision = copied.revision;

        if (read.outcome != PlayerOutcome::done || read.catchUp != ReadOutcome::ok)
            return read;

        read.rows.reserve(copied.positions.size());
        for (size_t at = 0; at < copied.positions.size(); ++at) {
            read.rows.push_back({copied.positions[at],
                                 formattedRow(copied.handles[at], copied.scripts, libraryManager)});
        }

        return read;
    };
}

PlaylistRowArtworkReader makePlaylistRowArtworkReader(MainThreadQueue& mainThread,
                                                      const AlbumArt& art) {
    const auto libraryManager = library_manager::get();

    return [&mainThread, &art, libraryManager](const std::string& playlistId, uint32_t row) {
        const auto found = askForOutcome<RowHandle>(
            mainThread, "reading a playlist row's artwork",
            [playlistId, row] { return readRowHandleOnMainThread(playlistId, row); });

        PlaylistArtworkRead read;
        read.outcome = found.outcome;
        if (read.outcome != PlayerOutcome::done)
            return read;

        read.libraryPath = libraryPathOf(found.handle, libraryManager);
        if (!read.libraryPath)
            read.source = art.of(found.handle);

        return read;
    };
}

PlaylistTrackTaker makePlaylistTrackTaker(MainThreadQueue& mainThread) {
    const auto libraryManager = library_manager::get();

    return [&mainThread, libraryManager](const std::string& playlistId,
                                         const std::optional<std::vector<uint32_t>>& positions) {
        const auto taken = askForOutcome<TakenHandles>(
            mainThread, "taking a playlist's tracks for a session",
            [playlistId, positions] { return takeHandlesOnMainThread(playlistId, positions); });

        SessionTracksRead read;
        read.outcome = taken.outcome;
        if (read.outcome != PlayerOutcome::done)
            return read;

        read.tracks = sessionTracksOf(taken.handles, libraryManager);
        return read;
    };
}

}  // namespace jean
