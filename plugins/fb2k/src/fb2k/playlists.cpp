#include "fb2k/PCH.h"

#include "fb2k/playlists.h"

#include "core/library.h"
#include "core/log.h"
#include "core/text.h"
#include "fb2k/ask_player.h"
#include "fb2k/strings.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <memory>
#include <numeric>
#include <string>
#include <utility>
#include <vector>

namespace jean {

namespace {

// {45837D74-FA4F-415C-BBA9-BF2DB8F0DC04}
constexpr GUID kJeanRecord = {
    0x45837d74, 0xfa4f, 0x415c, {0xbb, 0xa9, 0xbf, 0x2d, 0xb8, 0xf0, 0xdc, 0x04}};

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

std::optional<OwnPlaylistRole> roleOf(size_t index) {
    if (readProperty(index, kOwnPlaylist) == roleName(OwnPlaylistRole::scratch))
        return OwnPlaylistRole::scratch;

    return std::nullopt;
}

// See ARCHITECTURE.md, *Facts about the player*, for what the mask covers and what it does not.
bool lockRefuses(size_t index, uint32_t filter) {
    return (playlist_manager::get()->playlist_lock_get_filter_mask(index) & filter) != 0;
}

// Main thread, which is also where the version callbacks run, so the counts and the two
// numbers here are taken from one state of the player rather than from two.
PlaylistAnnotation annotate(size_t index, const PlaylistVersions& versions) {
    PlaylistAnnotation playlist;
    playlist.id = playlistId(index);
    playlist.index = static_cast<int>(index);
    playlist.title = playlistTitle(index);
    playlist.itemCount = playlist_manager::get()->playlist_get_item_count(index);
    playlist.isAutoPlaylist = autoplaylist_manager::get()->is_client_present(index);
    playlist.role = roleOf(index);

    const auto version = versions.of(playlist.id);
    playlist.structure = version.structure;
    playlist.revision = version.revision;

    if (const auto stored = readProperty(index, kJeanRecord); !stored.empty())
        playlist.managed = parseStoredAutoPlaylist(stored);

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

PlaylistMark markOf(size_t index, const PlaylistVersions& versions) {
    PlaylistMark mark;
    mark.id = playlistId(index);
    mark.title = playlistTitle(index);

    const auto version = versions.of(mark.id);
    mark.structure = version.structure;
    mark.revision = version.revision;

    return mark;
}

std::vector<PlaylistMark> everyMark(const PlaylistVersions& versions) {
    const auto indices = playlistIndices();

    std::vector<PlaylistMark> marks;
    marks.reserve(indices.size());
    std::transform(indices.begin(), indices.end(), std::back_inserter(marks),
                   [&versions](size_t index) { return markOf(index, versions); });

    return marks;
}

// Linear in the row count rather than in the marked positions, and why that is still the
// cheap side: ARCHITECTURE.md, *Facts about the player*.
std::vector<uint32_t> markedPositions(size_t playlist, const bit_array& mask) {
    const auto rows = playlist_manager::get()->playlist_get_item_count(playlist);

    std::vector<uint32_t> positions;
    for (t_size at = mask.find_first(true, 0, rows); at < rows;
         at = mask.find_next(true, at, rows)) {
        positions.push_back(static_cast<uint32_t>(at));
    }

    return positions;
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
void beginCreate(const AutoPlaylistSpec& spec, const PlaylistVersions& versions,
                 int maxAutoPlaylists, const AnswerPtr<PlaylistResult>& answer) {
    const auto existing = everyPlaylist(versions);

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
    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index, versions)});
}

void beginUpdate(const std::string& id, const AutoPlaylistSpec& spec,
                 const PlaylistVersions& versions, const AnswerPtr<PlaylistResult>& answer) {
    const auto found = ourPlaylist(id);
    if (found.outcome != PlaylistOutcome::done) {
        answer->set(playlistFailure(found.outcome));
        return;
    }

    const auto index = found.index;

    if (keyTaken(everyPlaylist(versions), spec.key, id)) {
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

    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index, versions)});
}

void removePlaylistAt(size_t index, const std::string& kind,
                      const AnswerPtr<PlaylistResult>& answer) {
    const auto title = playlistTitle(index);

    if (!playlist_manager::get()->remove_playlist(index)) {
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    logInfo("removed " + kind + " '" + title + "'");
    answer->set(PlaylistResult{});
}

void beginRemove(const std::string& id, const AnswerPtr<PlaylistResult>& answer) {
    const auto found = ourPlaylist(id);
    if (found.outcome != PlaylistOutcome::done) {
        answer->set(playlistFailure(found.outcome));
        return;
    }

    removePlaylistAt(found.index, "autoplaylist", answer);
}

size_t findOwnPlaylist(OwnPlaylistRole role) {
    const auto indices = playlistIndices();
    const auto found = std::find_if(indices.begin(), indices.end(),
                                    [role](size_t index) { return roleOf(index) == role; });

    return found == indices.end() ? pfc::infinite_size : *found;
}

void beginOwnPlaylist(OwnPlaylistRole role, const std::string& title,
                      const PlaylistVersions& versions,
                      const AnswerPtr<PlaylistResult>& answer) {
    auto index = findOwnPlaylist(role);

    if (index == pfc::infinite_size) {
        auto manager = playlist_manager_v5::get();
        index = manager->create_playlist(title.c_str(), title.size(), pfc::infinite_size);

        if (index == pfc::infinite_size) {
            answer->set(playlistFailure(PlaylistOutcome::playerRefused));
            return;
        }

        writeProperty(index, kOwnPlaylist, roleName(role));
        logInfo("created own playlist '" + title + "'");
    }

    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index, versions)});
}

// Removing items rather than deleting and recreating the playlist keeps its id, and any
// `kOwnPlaylist` role property, stable. foobar2000 itself tolerates a deleted playlist the
// play queue still points into; see ARCHITECTURE.md, *Facts about the player*.
void removeEveryItem(size_t index) {
    playlist_manager_v5::get()->playlist_remove_items(index, bit_array_true());
}

// A role with no playlist yet has nothing to empty, so this reports success without making
// one: creating a playlist only to answer a request for less music in it would be odd.
void beginEmptyOwnPlaylist(OwnPlaylistRole role, const PlaylistVersions& versions,
                           const AnswerPtr<PlaylistResult>& answer) {
    const auto index = findOwnPlaylist(role);
    if (index == pfc::infinite_size) {
        answer->set(PlaylistResult{});
        return;
    }

    removeEveryItem(index);
    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index, versions)});
}

void beginFill(const std::string& playlistId, const std::string& title, uint64_t structure,
               const std::vector<uint32_t>& ordinals, bool replace,
               const OrdinalResolver& resolveOrdinals, const AnswerPtr<FillResult>& answer) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size) {
        answer->set(FillResult{PlaylistOutcome::noSuchPlaylist, {}});
        return;
    }

    if (lockRefuses(index, playlist_lock::filter_add)) {
        answer->set(FillResult{PlaylistOutcome::playlistLocked, {}});
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

    answer->set(FillResult{PlaylistOutcome::done, std::move(positions)});
}

struct CopiedRows {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    metadb_handle_list items;
};

CopiedRows rowsFailure(PlaylistOutcome outcome) {
    CopiedRows rows;
    rows.outcome = outcome;
    return rows;
}

// No role check: this only ever reads, and both a copy's source and a create's source route
// through here, so the scratch has to stay reachable by this call for *Add to playlist* and
// *Save as playlist* to keep working over a set Jean played through it.
CopiedRows rowsOfPlaylist(const std::string& playlistId, const std::vector<uint32_t>& positions) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size)
        return rowsFailure(PlaylistOutcome::noSuchPlaylist);

    const auto manager = playlist_manager::get();
    const auto rowCount = manager->playlist_get_item_count(index);

    CopiedRows copied;
    for (const uint32_t position : positions) {
        if (position >= rowCount)
            return rowsFailure(PlaylistOutcome::positionPastEnd);

        metadb_handle_ptr handle;
        if (!manager->playlist_get_item_handle(handle, index, position))
            return rowsFailure(PlaylistOutcome::playerRefused);

        copied.items.add_item(handle);
    }

    return copied;
}

CopiedRows rowsFor(const NewPlaylistRows& rows, const OrdinalResolver& resolveOrdinals) {
    if (!rows.sourcePlaylistId.empty())
        return rowsOfPlaylist(rows.sourcePlaylistId, rows.positions);

    if (rows.ordinals.empty())
        return {};

    const auto resolved = resolveOrdinals(rows.structure, rows.ordinals);
    if (!resolved.structureMatched)
        return rowsFailure(PlaylistOutcome::structureMoved);

    CopiedRows gathered;
    gathered.items = resolved.items;
    return gathered;
}

// Main thread, and one work item on purpose: a create and a fill taking one each would leave a
// window in which a client reads a playlist nobody asked for, holding nothing.
void beginCreatePlaylist(const std::string& title, const NewPlaylistRows& rows,
                         const PlaylistVersions& versions, const OrdinalResolver& resolveOrdinals,
                         const AnswerPtr<PlaylistResult>& answer) {
    const auto gathered = rowsFor(rows, resolveOrdinals);
    if (gathered.outcome != PlaylistOutcome::done) {
        answer->set(playlistFailure(gathered.outcome));
        return;
    }

    auto manager = playlist_manager_v5::get();
    const auto index = manager->create_playlist(title.c_str(), title.size(), pfc::infinite_size);

    if (index == pfc::infinite_size) {
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    manager->playlist_insert_items(index, 0, gathered.items, bit_array_false());

    logInfo("created playlist '" + title + "'");
    answer->set(PlaylistResult{PlaylistOutcome::done, {}, annotate(index, versions)});
}

void beginRenamePlaylist(const std::string& id, const std::string& title,
                         const AnswerPtr<PlaylistResult>& answer) {
    const auto index = findPlaylist(id);
    if (index == pfc::infinite_size) {
        answer->set(playlistFailure(PlaylistOutcome::noSuchPlaylist));
        return;
    }

    if (roleOf(index)) {
        answer->set(playlistFailure(PlaylistOutcome::ownPlaylist));
        return;
    }

    if (lockRefuses(index, playlist_lock::filter_rename)) {
        answer->set(playlistFailure(PlaylistOutcome::playlistLocked));
        return;
    }

    if (!playlist_manager::get()->playlist_rename(index, title.c_str(), title.size())) {
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    answer->set(PlaylistResult{});
}

// The play queue is left alone on purpose. What foobar2000 does with a queued entry whose
// whole playlist is gone is ARCHITECTURE.md, *Facts about the player*.
void beginRemovePlaylist(const std::string& id, const AnswerPtr<PlaylistResult>& answer) {
    const auto index = findPlaylist(id);
    if (index == pfc::infinite_size) {
        answer->set(playlistFailure(PlaylistOutcome::noSuchPlaylist));
        return;
    }

    if (roleOf(index)) {
        answer->set(playlistFailure(PlaylistOutcome::ownPlaylist));
        return;
    }

    if (lockRefuses(index, playlist_lock::filter_remove_playlist)) {
        answer->set(playlistFailure(PlaylistOutcome::playlistLocked));
        return;
    }

    removePlaylistAt(index, "playlist", answer);
}

// The permutation playlist_manager::reorder expects; see ARCHITECTURE.md, *Facts about the
// player*.
std::vector<t_size> listOrderMoving(size_t count, size_t from, size_t to) {
    std::vector<t_size> order(count);
    std::iota(order.begin(), order.end(), t_size{0});

    const auto moved = order.begin() + static_cast<std::ptrdiff_t>(from);
    const auto target = order.begin() + static_cast<std::ptrdiff_t>(to);

    if (from < to)
        std::rotate(moved, moved + 1, target + 1);
    else
        std::rotate(target, moved, moved + 1);

    return order;
}

void beginMovePlaylist(const std::string& id, uint32_t index,
                       const AnswerPtr<PlaylistResult>& answer) {
    const auto from = findPlaylist(id);
    if (from == pfc::infinite_size) {
        answer->set(playlistFailure(PlaylistOutcome::noSuchPlaylist));
        return;
    }

    if (roleOf(from)) {
        answer->set(playlistFailure(PlaylistOutcome::ownPlaylist));
        return;
    }

    auto manager = playlist_manager::get();
    const auto count = manager->get_playlist_count();
    if (index >= count) {
        answer->set(playlistFailure(PlaylistOutcome::positionPastEnd));
        return;
    }

    const auto order = listOrderMoving(count, from, index);
    if (!manager->reorder(order.data(), order.size())) {
        answer->set(playlistFailure(PlaylistOutcome::playerRefused));
        return;
    }

    answer->set(PlaylistResult{});
}

RowsEdited rowsEditFailure(PlaylistOutcome outcome) {
    RowsEdited edited;
    edited.outcome = outcome;
    return edited;
}

// Main thread.
void beginCopyRows(const std::string& playlistId, const std::string& sourcePlaylistId,
                   const std::vector<uint32_t>& positions, const PlaylistVersions& versions,
                   const AnswerPtr<RowsEdited>& answer) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size) {
        answer->set(rowsEditFailure(PlaylistOutcome::noSuchPlaylist));
        return;
    }

    // The target only. A source is read rather than changed, so *Add to playlist* over results
    // Jean played through the scratch keeps working.
    if (roleOf(index)) {
        answer->set(rowsEditFailure(PlaylistOutcome::ownPlaylist));
        return;
    }

    if (lockRefuses(index, playlist_lock::filter_add)) {
        answer->set(rowsEditFailure(PlaylistOutcome::playlistLocked));
        return;
    }

    const auto gathered = rowsOfPlaylist(sourcePlaylistId, positions);
    if (gathered.outcome != PlaylistOutcome::done) {
        answer->set(rowsEditFailure(gathered.outcome));
        return;
    }

    auto manager = playlist_manager_v5::get();
    const auto base = manager->playlist_get_item_count(index);
    manager->playlist_insert_items(index, base, gathered.items, bit_array_false());

    RowsEdited copied;
    copied.positions.resize(gathered.items.get_count());
    std::iota(copied.positions.begin(), copied.positions.end(), base);
    copied.structure = versions.of(playlistId).structure;

    answer->set(std::move(copied));
}

// Main thread.
void beginRemoveRows(const std::string& playlistId, uint64_t structure,
                     const std::vector<uint32_t>& positions, const PlaylistVersions& versions,
                     const AnswerPtr<RowsEdited>& answer) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size) {
        answer->set(rowsEditFailure(PlaylistOutcome::noSuchPlaylist));
        return;
    }

    if (roleOf(index)) {
        answer->set(rowsEditFailure(PlaylistOutcome::ownPlaylist));
        return;
    }

    // Checked ahead of the structure below: a stale structure has a remedy a client reaches by
    // reading the playlist again, and a lock has none, so a request that is both answers the one
    // outcome a re-read cannot fix.
    if (lockRefuses(index, playlist_lock::filter_remove)) {
        answer->set(rowsEditFailure(PlaylistOutcome::playlistLocked));
        return;
    }

    if (versions.of(playlistId).structure != structure) {
        answer->set(rowsEditFailure(PlaylistOutcome::rowsMoved));
        return;
    }

    auto manager = playlist_manager_v5::get();
    const auto rowCount = manager->playlist_get_item_count(index);

    if (std::any_of(positions.begin(), positions.end(),
                    [rowCount](uint32_t position) { return position >= rowCount; })) {
        answer->set(rowsEditFailure(PlaylistOutcome::positionPastEnd));
        return;
    }

    bit_array_bittable mask(rowCount);
    for (const uint32_t position : positions)
        mask.set(position, true);

    manager->playlist_remove_items(index, mask);

    answer->set(RowsEdited{PlaylistOutcome::done, versions.of(playlistId).structure, {}});
}

// What the main thread hands over for a page of rows: the handles, the cheap half, and the
// compiled columns to run against them off it. See ARCHITECTURE.md, *Facts about the player*.
struct CopiedPage {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    uint64_t structure = 0;
    uint64_t revision = 0;
    size_t totalCount = 0;
    metadb_handle_list handles;
    std::vector<titleformat_object::ptr> scripts;
};

CopiedPage pageFailure(PlaylistOutcome outcome) {
    CopiedPage page;
    page.outcome = outcome;
    return page;
}

std::vector<titleformat_object::ptr> compiledColumns(const std::vector<std::string>& columns) {
    const auto compiler = titleformat_compiler::get();

    std::vector<titleformat_object::ptr> scripts;
    scripts.reserve(columns.size());
    for (const std::string& column : columns) {
        titleformat_object::ptr script;
        compiler->compile_safe_ex(script, column.c_str(), kUnresolved);
        scripts.push_back(std::move(script));
    }

    return scripts;
}

void beginReadRows(const std::string& playlistId, size_t offset, size_t count,
                   const std::vector<std::string>& columns, const PlaylistVersions& versions,
                   const AnswerPtr<CopiedPage>& answer) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size) {
        answer->set(pageFailure(PlaylistOutcome::noSuchPlaylist));
        return;
    }

    CopiedPage page;

    const auto version = versions.of(playlistId);
    page.structure = version.structure;
    page.revision = version.revision;

    page.totalCount = playlist_manager::get()->playlist_get_item_count(index);

    const auto from = std::min<size_t>(offset, page.totalCount);
    const auto taken = std::min<size_t>(count, page.totalCount - from);
    playlist_manager::get()->playlist_get_items(index, page.handles,
                                                bit_array_range(from, taken, true));

    page.scripts = compiledColumns(columns);
    answer->set(std::move(page));
}

struct CopiedChanges {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    DeltaOutcome catchUp = DeltaOutcome::ok;
    uint64_t revision = 0;
    std::vector<uint32_t> positions;
    metadb_handle_list handles;
    std::vector<titleformat_object::ptr> scripts;
};

CopiedChanges changesFailure(PlaylistOutcome outcome) {
    CopiedChanges changes;
    changes.outcome = outcome;
    return changes;
}

void beginReadChangedRows(const std::string& playlistId, uint64_t structure, uint64_t since,
                          const std::vector<std::string>& columns,
                          const PlaylistVersions& versions,
                          const AnswerPtr<CopiedChanges>& answer) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size) {
        answer->set(changesFailure(PlaylistOutcome::noSuchPlaylist));
        return;
    }

    const ChangedSince changed = versions.changedSince(playlistId, structure, since);

    CopiedChanges copied;
    copied.catchUp = changed.catchUp;
    copied.revision = changed.revision;
    if (copied.catchUp != DeltaOutcome::ok) {
        answer->set(std::move(copied));
        return;
    }

    const auto manager = playlist_manager::get();
    const auto itemCount = manager->playlist_get_item_count(index);

    for (const uint32_t position : changed.positions) {
        metadb_handle_ptr handle;
        if (position >= itemCount || !manager->playlist_get_item_handle(handle, index, position))
            continue;

        copied.positions.push_back(position);
        copied.handles.add_item(handle);
    }

    copied.scripts = compiledColumns(columns);
    answer->set(std::move(copied));
}

// plugins/fb2k/ARCHITECTURE.md, "Facts about the player": why this ignores the bool
// playlist_execute_default_action returns.
PlaylistOutcome beginPlayRow(const std::string& playlistId, uint32_t index) {
    const auto playlist = findPlaylist(playlistId);
    if (playlist == pfc::infinite_size)
        return PlaylistOutcome::noSuchPlaylist;

    const auto manager = playlist_manager::get();
    if (index >= manager->playlist_get_item_count(playlist))
        return PlaylistOutcome::positionPastEnd;

    manager->playlist_execute_default_action(playlist, index);
    return PlaylistOutcome::done;
}

PlaylistRow formattedRow(const metadb_handle_ptr& handle,
                         const std::vector<titleformat_object::ptr>& scripts,
                         const library_manager::ptr& libraryManager) {
    PlaylistRow row;
    row.columns.assign(scripts.size(), kUnresolved);

    if (!handle.is_valid())
        return row;

    metadb_info_container::ptr info;
    if (handle->get_info_ref(info)) {
        pfc::string8 text;
        for (size_t column = 0; column < scripts.size(); ++column) {
            handle->format_title_from_external_info(info->info(), nullptr, text, scripts[column],
                                                    nullptr);
            row.columns[column] = toStd(text);
        }
    }

    pfc::string8 relative;
    if (libraryManager->get_relative_path(handle, relative))
        row.libraryPath = forwardSlashed(toStd(relative));

    return row;
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

size_t findPlaylist(const std::string& id) {
    return playlist_manager_v5::get()->find_playlist_by_guid(pfc::GUID_from_text(id.c_str()));
}

std::string playlistId(size_t index) {
    const auto guid = playlist_manager_v5::get()->playlist_get_guid(index);
    return toLower(pfc::print_guid(guid).get_ptr());
}

std::optional<PlayingLocation> queuedLocationOf(const t_playback_queue_item& item) {
    return queuedLocation(item.m_playlist, item.m_item, playlistId);
}

// The SDK has no per-playlist subscription, so every playlist's events arrive here and each
// callback resolves the one it was handed: ARCHITECTURE.md, *Facts about the player*. The mask
// is only valid for the length of the call, so it is walked here and the marks are published
// from a main-thread callback of their own. Both sides run on foobar2000's main thread:
// ARCHITECTURE.md, *Facts about the player*. A publish already queued has not read anything
// yet and will see whatever the rest of the burst leaves behind.
struct PlaylistWatch::Callback : public playlist_callback_impl_base {
    Callback(MainThreadQueue& mainThread, PlaylistVersions& versions, PlayerStateStore& store)
        : playlist_callback_impl_base(flag_on_items_added | flag_on_items_removed |
                                       flag_on_items_reordered | flag_on_items_replaced |
                                       flag_on_items_modified | flag_on_playlist_created |
                                       flag_on_playlists_reorder | flag_on_playlists_removing |
                                       flag_on_playlists_removed | flag_on_playlist_renamed),
          mainThread_(mainThread), versions_(versions), store_(store) {}

    void on_items_added(t_size playlist, t_size, metadb_handle_list_cref,
                         const bit_array&) override {
        structureMoved(playlist, RowsChanged::added);
    }

    void on_items_removed(t_size playlist, const bit_array&, t_size, t_size) override {
        structureMoved(playlist, RowsChanged::removed);
    }

    void on_items_reordered(t_size playlist, const t_size*, t_size) override {
        structureMoved(playlist, RowsChanged::reordered);
    }

    void on_items_replaced(t_size playlist, const bit_array&,
                            const pfc::list_base_const_t<t_on_items_replaced_entry>&) override {
        structureMoved(playlist, RowsChanged::replaced);
    }

    void on_items_modified(t_size playlist, const bit_array& mask) override {
        versions_.contentChanged(playlistId(playlist), markedPositions(playlist, mask));
        publishMarks();
    }

    void on_playlist_created(t_size, const char*, t_size) override { publishMarks(); }
    void on_playlists_reorder(const t_size*, t_size) override { publishMarks(); }

    // Read as the last callback at which a marked index still resolves to a GUID, which the SDK
    // does not document either way: ARCHITECTURE.md, *Facts about the player*.
    void on_playlists_removing(const bit_array& mask, t_size oldCount, t_size) override {
        for (t_size at = mask.find_first(true, 0, oldCount); at < oldCount;
             at = mask.find_next(true, at, oldCount)) {
            versions_.forget(playlistId(at));
        }
    }

    void on_playlists_removed(const bit_array&, t_size, t_size) override { publishMarks(); }
    void on_playlist_renamed(t_size, const char*, t_size) override { publishMarks(); }

    void publishMarks() {
        if (publishQueued_)
            return;

        publishQueued_ = true;
        mainThread_.enqueue(
            [this] {
                publishQueued_ = false;
                store_.playlistsChanged(everyMark(versions_));
            },
            [] {});
    }

    void structureMoved(t_size playlist, RowsChanged how) {
        versions_.rowsChanged(playlistId(playlist), how);
        publishMarks();
    }

    MainThreadQueue& mainThread_;
    PlaylistVersions& versions_;
    PlayerStateStore& store_;
    bool publishQueued_ = false;
};

PlaylistWatch::PlaylistWatch(MainThreadQueue& mainThread, PlaylistVersions& versions,
                              PlayerStateStore& store)
    : callback_(std::make_unique<Callback>(mainThread, versions, store)) {
    store.playlistsChanged(everyMark(versions));
}

PlaylistWatch::~PlaylistWatch() = default;

PlaylistLister makePlaylistLister(MainThreadQueue& mainThread, const PlaylistVersions& versions) {
    return [&mainThread, &versions] {
        return askPlayer<PlaylistsResult>(
            mainThread, "listing playlists",
            [&versions](const AnswerPtr<PlaylistsResult>& answer) {
                answer->set(PlaylistsResult{PlaylistOutcome::done, everyPlaylist(versions)});
            },
            PlaylistsResult{PlaylistOutcome::timedOut, {}},
            PlaylistsResult{PlaylistOutcome::playerRefused, {}});
    };
}

PlaylistRowReader makePlaylistRowReader(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions) {
    const auto libraryManager = library_manager::get();

    return [&mainThread, &versions, libraryManager](
               const std::string& playlistId, size_t offset, size_t count,
               const std::vector<std::string>& columns) {
        const auto page = askPlayer<CopiedPage>(
            mainThread, "reading a page of a playlist",
            [playlistId, offset, count, columns, &versions](const AnswerPtr<CopiedPage>& answer) {
                beginReadRows(playlistId, offset, count, columns, versions, answer);
            },
            pageFailure(PlaylistOutcome::timedOut), pageFailure(PlaylistOutcome::playerRefused));

        PlaylistRowsRead read;
        read.outcome = page.outcome;
        read.structure = page.structure;
        read.revision = page.revision;
        read.totalCount = page.totalCount;

        if (read.outcome != PlaylistOutcome::done)
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
        const auto copied = askPlayer<CopiedChanges>(
            mainThread, "reading a playlist's changed rows",
            [playlistId, structure, since, columns,
             &versions](const AnswerPtr<CopiedChanges>& answer) {
                beginReadChangedRows(playlistId, structure, since, columns, versions, answer);
            },
            changesFailure(PlaylistOutcome::timedOut),
            changesFailure(PlaylistOutcome::playerRefused));

        PlaylistChangesRead read;
        read.outcome = copied.outcome;
        read.catchUp = copied.catchUp;
        read.revision = copied.revision;

        if (read.outcome != PlaylistOutcome::done || read.catchUp != DeltaOutcome::ok)
            return read;

        read.rows.reserve(copied.positions.size());
        for (size_t at = 0; at < copied.positions.size(); ++at) {
            read.rows.push_back({copied.positions[at],
                                 formattedRow(copied.handles[at], copied.scripts, libraryManager)});
        }

        return read;
    };
}

PlaylistRowPlayer makePlaylistRowPlayer(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& playlistId, uint32_t index) {
        return askPlayer<PlaylistOutcome>(
            mainThread, "playing a playlist row",
            [playlistId, index](const AnswerPtr<PlaylistOutcome>& answer) {
                answer->set(beginPlayRow(playlistId, index));
            },
            PlaylistOutcome::timedOut, PlaylistOutcome::playerRefused);
    };
}

AutoPlaylistCreator makeAutoPlaylistCreator(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions,
                                            int maxAutoPlaylists) {
    return [&mainThread, &versions, maxAutoPlaylists](const AutoPlaylistSpec& spec) {
        if (maxAutoPlaylists <= 0)
            return playlistFailure(PlaylistOutcome::unavailable);

        return askPlayer<PlaylistResult>(
            mainThread, "creating an autoplaylist",
            [spec, &versions, maxAutoPlaylists](const AnswerPtr<PlaylistResult>& answer) {
                beginCreate(spec, versions, maxAutoPlaylists, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

AutoPlaylistUpdater makeAutoPlaylistUpdater(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions) {
    return [&mainThread, &versions](const std::string& id, const AutoPlaylistSpec& spec) {
        return askPlayer<PlaylistResult>(
            mainThread, "updating an autoplaylist",
            [id, spec, &versions](const AnswerPtr<PlaylistResult>& answer) {
                beginUpdate(id, spec, versions, answer);
            },
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

OwnPlaylistResolver makeOwnPlaylistResolver(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions) {
    return [&mainThread, &versions](OwnPlaylistRole role, const std::string& title) {
        return askPlayer<PlaylistResult>(
            mainThread, "resolving one of the component's own playlists",
            [role, title, &versions](const AnswerPtr<PlaylistResult>& answer) {
                beginOwnPlaylist(role, title, versions, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

OwnPlaylistEmptier makeOwnPlaylistEmptier(MainThreadQueue& mainThread,
                                          const PlaylistVersions& versions) {
    return [&mainThread, &versions](OwnPlaylistRole role) {
        return askPlayer<PlaylistResult>(
            mainThread, "emptying one of the component's own playlists",
            [role, &versions](const AnswerPtr<PlaylistResult>& answer) {
                beginEmptyOwnPlaylist(role, versions, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistCreator makePlaylistCreator(MainThreadQueue& mainThread, const PlaylistVersions& versions,
                                    OrdinalResolver resolveOrdinals) {
    return [&mainThread, &versions, resolveOrdinals](const std::string& title,
                                                     const NewPlaylistRows& rows) {
        return askPlayer<PlaylistResult>(
            mainThread, "creating a playlist",
            [title, rows, &versions, resolveOrdinals](const AnswerPtr<PlaylistResult>& answer) {
                beginCreatePlaylist(title, rows, versions, resolveOrdinals, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistRenamer makePlaylistRenamer(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id, const std::string& title) {
        return askPlayer<PlaylistResult>(
            mainThread, "renaming a playlist",
            [id, title](const AnswerPtr<PlaylistResult>& answer) {
                beginRenamePlaylist(id, title, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistRemover makePlaylistRemover(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id) {
        return askPlayer<PlaylistResult>(
            mainThread, "removing a playlist",
            [id](const AnswerPtr<PlaylistResult>& answer) { beginRemovePlaylist(id, answer); },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistMover makePlaylistMover(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id, uint32_t index) {
        return askPlayer<PlaylistResult>(
            mainThread, "moving a playlist",
            [id, index](const AnswerPtr<PlaylistResult>& answer) {
                beginMovePlaylist(id, index, answer);
            },
            playlistFailure(PlaylistOutcome::timedOut),
            playlistFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistRowCopier makePlaylistRowCopier(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions) {
    return [&mainThread, &versions](const std::string& playlistId,
                                    const std::string& sourcePlaylistId,
                                    const std::vector<uint32_t>& positions) {
        return askPlayer<RowsEdited>(
            mainThread, "copying rows into a playlist",
            [playlistId, sourcePlaylistId, positions,
             &versions](const AnswerPtr<RowsEdited>& answer) {
                beginCopyRows(playlistId, sourcePlaylistId, positions, versions, answer);
            },
            rowsEditFailure(PlaylistOutcome::timedOut),
            rowsEditFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistRowRemover makePlaylistRowRemover(MainThreadQueue& mainThread,
                                          const PlaylistVersions& versions) {
    return [&mainThread, &versions](const std::string& playlistId, uint64_t structure,
                                    const std::vector<uint32_t>& positions) {
        return askPlayer<RowsEdited>(
            mainThread, "removing rows from a playlist",
            [playlistId, structure, positions, &versions](const AnswerPtr<RowsEdited>& answer) {
                beginRemoveRows(playlistId, structure, positions, versions, answer);
            },
            rowsEditFailure(PlaylistOutcome::timedOut),
            rowsEditFailure(PlaylistOutcome::playerRefused));
    };
}

PlaylistFiller makePlaylistFiller(MainThreadQueue& mainThread, OrdinalResolver resolveOrdinals) {
    return [&mainThread, resolveOrdinals](const std::string& playlistId, const std::string& title,
                                          uint64_t structure,
                                          const std::vector<uint32_t>& ordinals, bool replace) {
        return askPlayer<FillResult>(
            mainThread, "filling a playlist",
            [playlistId, title, structure, ordinals, replace,
             resolveOrdinals](const AnswerPtr<FillResult>& answer) {
                beginFill(playlistId, title, structure, ordinals, replace, resolveOrdinals,
                          answer);
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
