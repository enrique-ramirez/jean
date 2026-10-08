#include "fb2k/PCH.h"

#include "fb2k/playlist_edits.h"

#include "core/ask_player.h"
#include "core/log.h"
#include "core/refusal_order.h"
#include "fb2k/playlist_properties.h"
#include "fb2k/playlists.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <numeric>
#include <optional>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

namespace jean {

namespace {

// No foobar2000 lock bit covers a playlist's place in the list: playlist_manager::reorder moves
// a playlist regardless of its lock.
constexpr uint32_t kNoLockCoversMoving = 0;

// What an edit of a user's playlist checks first: that it exists, that it is not one of this
// component's own, and whether its lock refuses `lockFilter`.
PlaylistEditFacts userPlaylistFacts(size_t index, uint32_t lockFilter) {
    PlaylistEditFacts facts;
    facts.noSuchPlaylist = index == pfc::infinite_size;
    if (facts.noSuchPlaylist)
        return facts;

    facts.ownPlaylist = roleOf(index).has_value();
    facts.locked = lockRefuses(index, lockFilter);
    return facts;
}

bool anyPastEnd(const std::vector<uint32_t>& positions, size_t rowCount) {
    return std::any_of(positions.begin(), positions.end(),
                       [rowCount](uint32_t position) { return position >= rowCount; });
}

// Removing items rather than deleting and recreating the playlist keeps its id, and any role it
// carries, stable. foobar2000 itself tolerates a deleted playlist the play queue still points
// into; see ARCHITECTURE.md, *Facts about the player*.
void removeEveryItem(size_t index) {
    playlist_manager_v5::get()->playlist_remove_items(index, bit_array_true());
}

std::vector<size_t> positionsFrom(size_t base, size_t count) {
    std::vector<size_t> positions(count);
    std::iota(positions.begin(), positions.end(), base);
    return positions;
}

// foobar2000's metadb keeps one metadb_handle per playable_location, a path and a
// subsong, so two rows hold the same track exactly where their handles are the same object.
std::vector<bool> alreadyHeld(size_t index, const metadb_handle_list& items,
                              Duplicates duplicates) {
    std::vector<bool> held(items.get_count(), false);
    if (duplicates == Duplicates::added)
        return held;

    metadb_handle_list rows;
    playlist_manager::get()->playlist_get_all_items(index, rows);

    std::unordered_set<const metadb_handle*> tracks;
    tracks.reserve(rows.get_count());
    for (size_t at = 0, count = rows.get_count(); at < count; ++at)
        tracks.insert(rows[at].get_ptr());

    for (size_t at = 0; at < held.size(); ++at)
        held[at] = tracks.contains(items[at].get_ptr());

    return held;
}

metadb_handle_list itemsAt(const metadb_handle_list& items, const std::vector<size_t>& indices) {
    metadb_handle_list chosen;
    for (const size_t at : indices)
        chosen.add_item(items[at]);
    return chosen;
}

std::vector<size_t> appendItems(size_t index, const metadb_handle_list& items) {
    const auto manager = playlist_manager_v5::get();
    const auto base = manager->playlist_get_item_count(index);

    if (items.get_count() != 0)
        manager->playlist_insert_items(index, base, items, bit_array_false());

    return positionsFrom(base, items.get_count());
}

struct CopiedRows {
    PlayerOutcome outcome = PlayerOutcome::done;
    metadb_handle_list items;
};

// No role check: this only ever reads, and both a copy's source and a create's source route
// through here, so the scratch has to stay reachable by this call for *Add to playlist* and
// *Save as playlist* to keep working over a set Jean played through it.
CopiedRows rowsOfPlaylist(const std::string& playlistId, const std::vector<uint32_t>& positions) {
    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size)
        return failureOf<CopiedRows>(PlayerOutcome::noSuchPlaylist);

    const auto manager = playlist_manager::get();
    const auto rowCount = manager->playlist_get_item_count(index);

    CopiedRows copied;
    for (const uint32_t position : positions) {
        if (position >= rowCount)
            return failureOf<CopiedRows>(PlayerOutcome::positionPastEnd);

        metadb_handle_ptr handle;
        if (!manager->playlist_get_item_handle(handle, index, position))
            return failureOf<CopiedRows>(PlayerOutcome::playerRefused);

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
        return failureOf<CopiedRows>(PlayerOutcome::structureMoved);

    CopiedRows gathered;
    gathered.items = resolved.items;
    return gathered;
}

// One job on purpose: a create and a fill taking one each would leave a window in which a client
// reads a playlist nobody asked for, holding nothing.
PlaylistResult createOnMainThread(const std::string& title, const NewPlaylistRows& rows,
                                  const PlaylistVersions& versions,
                                  const OrdinalResolver& resolveOrdinals) {
    const auto gathered = rowsFor(rows, resolveOrdinals);
    if (gathered.outcome != PlayerOutcome::done)
        return playlistFailure(gathered.outcome);

    const auto manager = playlist_manager_v5::get();
    const auto index = manager->create_playlist(title.c_str(), title.size(), pfc::infinite_size);

    if (index == pfc::infinite_size)
        return playlistFailure(PlayerOutcome::playerRefused);

    manager->playlist_insert_items(index, 0, gathered.items, bit_array_false());

    logInfo("created playlist '" + title + "'");
    return PlaylistResult{PlayerOutcome::done, {}, annotate(index, versions)};
}

PlaylistResult renameOnMainThread(const std::string& id, const std::string& title) {
    const auto index = findPlaylist(id);

    const auto refusal =
        playlistEditRefusal(userPlaylistFacts(index, playlist_lock::filter_rename));
    if (refusal != PlayerOutcome::done)
        return playlistFailure(refusal);

    if (!playlist_manager::get()->playlist_rename(index, title.c_str(), title.size()))
        return playlistFailure(PlayerOutcome::playerRefused);

    return PlaylistResult{};
}

// The play queue is left alone on purpose. What foobar2000 does with a queued entry whose whole
// playlist is gone is ARCHITECTURE.md, *Facts about the player*.
PlaylistResult removeOnMainThread(const std::string& id) {
    const auto index = findPlaylist(id);

    const auto refusal =
        playlistEditRefusal(userPlaylistFacts(index, playlist_lock::filter_remove_playlist));
    if (refusal != PlayerOutcome::done)
        return playlistFailure(refusal);

    return removePlaylistAt(index, "playlist");
}

// playlist_manager::reorder takes a whole permutation named by destination, new[n] =
// old[order[n]] (pfc::guess_reorder_pattern: "to[n] = from[out[n]]"), and accepts its mirror
// image without complaint, landing every entry one slot from where it was asked for.
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

PlaylistResult moveOnMainThread(const std::string& id, uint32_t index) {
    const auto from = findPlaylist(id);
    const auto manager = playlist_manager::get();
    const auto count = manager->get_playlist_count();

    auto facts = userPlaylistFacts(from, kNoLockCoversMoving);
    facts.positionPastEnd = index >= count;

    if (const auto refusal = playlistEditRefusal(facts); refusal != PlayerOutcome::done)
        return playlistFailure(refusal);

    const auto order = listOrderMoving(count, from, index);
    if (!manager->reorder(order.data(), order.size()))
        return playlistFailure(PlayerOutcome::playerRefused);

    return PlaylistResult{};
}

// The target alone is checked for a role. A source is read rather than changed, so *Add to
// playlist* over results Jean played through the scratch keeps working.
RowsEdited copyRowsOnMainThread(const std::string& playlistId, const std::string& sourcePlaylistId,
                                const std::vector<uint32_t>& positions, Duplicates duplicates,
                                const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);

    const auto refusal = playlistEditRefusal(userPlaylistFacts(index, playlist_lock::filter_add));
    if (refusal != PlayerOutcome::done)
        return failureOf<RowsEdited>(refusal);

    const auto gathered = rowsOfPlaylist(sourcePlaylistId, positions);
    if (gathered.outcome != PlayerOutcome::done)
        return failureOf<RowsEdited>(gathered.outcome);

    auto split = splitDuplicates(positions, alreadyHeld(index, gathered.items, duplicates));

    RowsEdited copied;
    copied.positions = appendItems(index, itemsAt(gathered.items, split.inserted));
    copied.structure = versions.of(playlistId).structure;
    copied.skipped = std::move(split.skipped);
    return copied;
}

RowsEdited removeRowsOnMainThread(const std::string& playlistId, uint64_t structure,
                                  const std::vector<uint32_t>& positions,
                                  const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    const auto manager = playlist_manager_v5::get();

    auto facts = userPlaylistFacts(index, playlist_lock::filter_remove);
    facts.rowsMoved = versions.of(playlistId).structure != structure;
    if (!facts.noSuchPlaylist)
        facts.positionPastEnd = anyPastEnd(positions, manager->playlist_get_item_count(index));

    if (const auto refusal = playlistEditRefusal(facts); refusal != PlayerOutcome::done)
        return failureOf<RowsEdited>(refusal);

    bit_array_bittable mask(manager->playlist_get_item_count(index));
    for (const uint32_t position : positions)
        mask.set(position, true);

    manager->playlist_remove_items(index, mask);

    return RowsEdited{PlayerOutcome::done, versions.of(playlistId).structure, {}, {}};
}

RowsEdited moveRowsOnMainThread(const std::string& playlistId, uint64_t structure,
                                const std::vector<uint32_t>& positions, uint32_t to,
                                const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    const auto manager = playlist_manager::get();

    auto facts = userPlaylistFacts(index, playlist_lock::filter_reorder);
    facts.rowsMoved = versions.of(playlistId).structure != structure;

    std::optional<std::vector<uint32_t>> order;
    if (!facts.noSuchPlaylist) {
        order = moveOrder(manager->playlist_get_item_count(index), positions, to);
        facts.positionPastEnd = !order.has_value();
    }

    if (const auto refusal = playlistEditRefusal(facts); refusal != PlayerOutcome::done)
        return failureOf<RowsEdited>(refusal);

    if (!order)
        return failureOf<RowsEdited>(PlayerOutcome::positionPastEnd);

    const std::vector<t_size> wide(order->begin(), order->end());
    if (!manager->playlist_reorder_items(index, wide.data(), wide.size()))
        return failureOf<RowsEdited>(PlayerOutcome::playerRefused);

    return RowsEdited{PlayerOutcome::done, versions.of(playlistId).structure, {}, {}};
}

SortedRows sortRowsOnMainThread(const std::string& playlistId, uint64_t structure,
                                const std::string& pattern, const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    const auto manager = playlist_manager::get();

    auto facts = userPlaylistFacts(index, playlist_lock::filter_reorder);
    facts.rowsMoved = versions.of(playlistId).structure != structure;

    if (const auto refusal = playlistEditRefusal(facts); refusal != PlayerOutcome::done)
        return failureOf<SortedRows>(refusal);

    metadb_handle_list items;
    manager->playlist_get_all_items(index, items);

    service_ptr_t<titleformat_object> script;
    // compile_safe_ex never fails: the SDK formats a bad pattern as its own error text.
    titleformat_compiler::get()->compile_safe_ex(script, pattern.c_str(), "");

    std::vector<t_size> order(items.get_count());
    if (!order.empty()) {
        // The SDK's sort_by_format_get_order is stable, and fills order[new] with the old position
        // of the row that belongs at new, the shape playlist_reorder_items takes.
        items.sort_by_format_get_order(order.data(), script, nullptr);
        if (!manager->playlist_reorder_items(index, order.data(), order.size()))
            return failureOf<SortedRows>(PlayerOutcome::playerRefused);
    }

    return SortedRows{PlayerOutcome::done, versions.of(playlistId).structure,
                      std::vector<uint32_t>(order.begin(), order.end())};
}

// No role check: a fill is how this component's own scratch playlist gets its rows.
FillResult fillOnMainThread(const std::string& playlistId, const std::string& title,
                            uint64_t structure, const std::vector<uint32_t>& ordinals,
                            ExistingRows existing, Duplicates duplicates,
                            const OrdinalResolver& resolveOrdinals,
                            const PlaylistVersions& versions) {
    const auto index = findPlaylist(playlistId);
    const auto resolved = resolveOrdinals(structure, ordinals);

    PlaylistEditFacts facts;
    facts.noSuchPlaylist = index == pfc::infinite_size;
    facts.locked = !facts.noSuchPlaylist && lockRefuses(index, playlist_lock::filter_add);
    facts.libraryMoved = !resolved.structureMatched;

    if (const auto refusal = playlistEditRefusal(facts); refusal != PlayerOutcome::done)
        return failureOf<FillResult>(refusal);

    if (!title.empty())
        playlist_manager::get()->playlist_rename(index, title.c_str(), title.size());

    auto split = splitDuplicates(ordinals, alreadyHeld(index, resolved.items, duplicates));

    if (existing == ExistingRows::replaced)
        removeEveryItem(index);

    FillResult filled;
    filled.positions = appendItems(index, itemsAt(resolved.items, split.inserted));
    filled.structure = versions.of(playlistId).structure;
    filled.skipped = std::move(split.skipped);
    return filled;
}

PlaylistResult resolveOwnOnMainThread(OwnPlaylistRole role, const std::string& title,
                                      const PlaylistVersions& versions) {
    auto index = findOwnPlaylist(role);

    if (index == pfc::infinite_size) {
        const auto manager = playlist_manager_v5::get();
        index = manager->create_playlist(title.c_str(), title.size(), pfc::infinite_size);

        if (index == pfc::infinite_size)
            return playlistFailure(PlayerOutcome::playerRefused);

        markRole(index, role);
        logInfo("created own playlist '" + title + "'");
    }

    return PlaylistResult{PlayerOutcome::done, {}, annotate(index, versions)};
}

// A role with no playlist yet has nothing to empty, so this reports success without making one:
// creating a playlist only to answer a request for less music in it would be odd.
PlaylistResult emptyOwnOnMainThread(OwnPlaylistRole role, const PlaylistVersions& versions) {
    const auto index = findOwnPlaylist(role);
    if (index == pfc::infinite_size)
        return PlaylistResult{};

    removeEveryItem(index);
    return PlaylistResult{PlayerOutcome::done, {}, annotate(index, versions)};
}

}  // namespace

PlaylistCreator makePlaylistCreator(MainThreadQueue& mainThread, const PlaylistVersions& versions,
                                    OrdinalResolver resolveOrdinals) {
    return [&mainThread, &versions, resolveOrdinals = std::move(resolveOrdinals)](
               const std::string& title, const NewPlaylistRows& rows) {
        return askForOutcome<PlaylistResult>(
            mainThread, "creating a playlist", [title, rows, &versions, resolveOrdinals] {
                return createOnMainThread(title, rows, versions, resolveOrdinals);
            });
    };
}

PlaylistRenamer makePlaylistRenamer(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id, const std::string& title) {
        return askForOutcome<PlaylistResult>(mainThread, "renaming a playlist",
                                             [id, title] { return renameOnMainThread(id, title); });
    };
}

PlaylistRemover makePlaylistRemover(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id) {
        return askForOutcome<PlaylistResult>(mainThread, "removing a playlist",
                                             [id] { return removeOnMainThread(id); });
    };
}

PlaylistMover makePlaylistMover(MainThreadQueue& mainThread) {
    return [&mainThread](const std::string& id, uint32_t index) {
        return askForOutcome<PlaylistResult>(mainThread, "moving a playlist",
                                             [id, index] { return moveOnMainThread(id, index); });
    };
}

PlaylistRowCopier makePlaylistRowCopier(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions) {
    return
        [&mainThread, &versions](const std::string& playlistId, const std::string& sourcePlaylistId,
                                 const std::vector<uint32_t>& positions, Duplicates duplicates) {
            return askForOutcome<RowsEdited>(
                mainThread, "copying rows into a playlist",
                [playlistId, sourcePlaylistId, positions, duplicates, &versions] {
                    return copyRowsOnMainThread(playlistId, sourcePlaylistId, positions, duplicates,
                                                versions);
                });
        };
}

PlaylistRowRemover makePlaylistRowRemover(MainThreadQueue& mainThread,
                                          const PlaylistVersions& versions) {
    return [&mainThread, &versions](const std::string& playlistId, uint64_t structure,
                                    const std::vector<uint32_t>& positions) {
        return askForOutcome<RowsEdited>(mainThread, "removing rows from a playlist",
                                         [playlistId, structure, positions, &versions] {
                                             return removeRowsOnMainThread(playlistId, structure,
                                                                           positions, versions);
                                         });
    };
}

PlaylistRowMover makePlaylistRowMover(MainThreadQueue& mainThread,
                                      const PlaylistVersions& versions) {
    return [&mainThread, &versions](const std::string& playlistId, uint64_t structure,
                                    const std::vector<uint32_t>& positions, uint32_t to) {
        return askForOutcome<RowsEdited>(mainThread, "moving rows in a playlist",
                                         [playlistId, structure, positions, to, &versions] {
                                             return moveRowsOnMainThread(playlistId, structure,
                                                                         positions, to, versions);
                                         });
    };
}

PlaylistRowSorter makePlaylistRowSorter(MainThreadQueue& mainThread,
                                        const PlaylistVersions& versions) {
    return [&mainThread, &versions](const std::string& playlistId, uint64_t structure,
                                    const std::string& pattern) {
        return askForOutcome<SortedRows>(
            mainThread, "sorting a playlist", [playlistId, structure, pattern, &versions] {
                return sortRowsOnMainThread(playlistId, structure, pattern, versions);
            });
    };
}

PlaylistFiller makePlaylistFiller(MainThreadQueue& mainThread, OrdinalResolver resolveOrdinals,
                                  const PlaylistVersions& versions) {
    return [&mainThread, resolveOrdinals = std::move(resolveOrdinals), &versions](
               const std::string& playlistId, const std::string& title, uint64_t structure,
               const std::vector<uint32_t>& ordinals, ExistingRows existing,
               Duplicates duplicates) {
        return askForOutcome<FillResult>(mainThread, "filling a playlist",
                                         [playlistId, title, structure, ordinals, existing,
                                          duplicates, resolveOrdinals, &versions] {
                                             return fillOnMainThread(playlistId, title, structure,
                                                                     ordinals, existing, duplicates,
                                                                     resolveOrdinals, versions);
                                         });
    };
}

OwnPlaylistResolver makeOwnPlaylistResolver(MainThreadQueue& mainThread,
                                            const PlaylistVersions& versions) {
    return [&mainThread, &versions](OwnPlaylistRole role, const std::string& title) {
        return askForOutcome<PlaylistResult>(
            mainThread, "resolving one of the component's own playlists",
            [role, title, &versions] { return resolveOwnOnMainThread(role, title, versions); });
    };
}

OwnPlaylistEmptier makeOwnPlaylistEmptier(MainThreadQueue& mainThread,
                                          const PlaylistVersions& versions) {
    return [&mainThread, &versions](OwnPlaylistRole role) {
        return askForOutcome<PlaylistResult>(
            mainThread, "emptying one of the component's own playlists",
            [role, &versions] { return emptyOwnOnMainThread(role, versions); });
    };
}

}  // namespace jean
