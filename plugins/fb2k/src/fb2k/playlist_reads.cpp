#include "fb2k/PCH.h"

#include "fb2k/playlist_reads.h"

#include "core/ask_player.h"
#include "core/library.h"
#include "fb2k/columns.h"
#include "fb2k/playlists.h"
#include "fb2k/tracks.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
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

CopiedPage copyPageOnMainThread(const std::string& playlistId, size_t offset, size_t count,
                                const std::vector<std::string>& columns,
                                const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size)
        return failureOf<CopiedPage>(PlayerOutcome::noSuchPlaylist);

    CopiedPage page;

    const auto version = versions.of(playlistId);
    page.structure = version.structure;
    page.revision = version.revision;

    page.totalCount = playlist_manager::get()->playlist_get_item_count(index);

    const auto from = std::min<size_t>(offset, page.totalCount);
    const auto taken = std::min<size_t>(count, page.totalCount - from);
    playlist_manager::get()->playlist_get_items(index, page.handles,
                                                bit_array_range(from, taken, true));

    page.scripts = compiledColumns(titleformat_compiler::get(), columns);
    return page;
}

struct CopiedChanges {
    PlayerOutcome outcome = PlayerOutcome::done;
    DeltaOutcome catchUp = DeltaOutcome::ok;
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
    if (copied.catchUp != DeltaOutcome::ok)
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

PlaylistRowReader makePlaylistRowReader(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions) {
    const auto libraryManager = library_manager::get();

    return [&mainThread, &versions, libraryManager](const std::string& playlistId, size_t offset,
                                                    size_t count,
                                                    const std::vector<std::string>& columns) {
        const auto page = askForOutcome<CopiedPage>(
            mainThread, "reading a page of a playlist",
            [playlistId, offset, count, columns, &versions] {
                return copyPageOnMainThread(playlistId, offset, count, columns, versions);
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

        if (read.outcome != PlayerOutcome::done || read.catchUp != DeltaOutcome::ok)
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

}  // namespace jean
