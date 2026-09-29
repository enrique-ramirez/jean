#include "fb2k/PCH.h"

#include "fb2k/queue.h"

#include "core/ask_player.h"
#include "core/refusal_order.h"
#include "fb2k/library.h"
#include "fb2k/playlists.h"
#include "fb2k/strings.h"
#include "fb2k/tracks.h"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace jean {

namespace {

// Copied on the main thread, alongside playlist_manager: every one of its methods is main
// thread only. Formatting the tags happens off it, once this is back on an HTTP worker.
struct CopiedQueueItem {
    metadb_handle_ptr handle;
    std::optional<PlayingLocation> location;
};

struct CopiedQueue {
    PlayerOutcome outcome = PlayerOutcome::done;
    uint64_t revision = 0;
    std::vector<CopiedQueueItem> items;
};

CopiedQueue copyQueue(const PlayerStateStore& store) {
    pfc::list_t<t_playback_queue_item> items;
    playlist_manager::get()->queue_get_contents(items);

    CopiedQueue copied;
    copied.revision = store.read().queueRevision;

    copied.items.reserve(items.get_count());
    for (t_size at = 0; at < items.get_count(); ++at)
        copied.items.push_back({items[at].m_handle, queuedLocationOf(items[at])});

    return copied;
}

std::string formattedField(const metadb_handle_ptr& handle, const file_info& info,
                           const titleformat_object::ptr& script) {
    pfc::string8 out;
    handle->format_title_from_external_info(info, nullptr, out, script, nullptr);
    return toStd(out);
}

QueuedTrack formatted(const CopiedQueueItem& item, const NameScripts& scripts,
                      const library_manager::ptr& libraryManager) {
    QueuedTrack track;
    track.location = item.location;

    if (!item.handle.is_valid())
        return track;

    metadb_info_container::ptr info;
    if (item.handle->get_info_ref(info)) {
        track.title = formattedField(item.handle, info->info(), scripts.title);
        track.artist = formattedField(item.handle, info->info(), scripts.artist);
        track.album = formattedField(item.handle, info->info(), scripts.album);
        track.albumArtist = formattedField(item.handle, info->info(), scripts.albumArtist);
        track.duration = info->info().get_length();
    }

    track.libraryPath = libraryPathOf(item.handle, libraryManager);
    return track;
}

QueueEntry queueEntryOf(const t_playback_queue_item& item) {
    QueueEntry entry;
    entry.path = displayPathOf(item.m_handle);
    entry.subsong = item.m_handle.is_valid() ? item.m_handle->get_subsong_index() : 0;
    entry.location = queuedLocationOf(item);
    return entry;
}

bool queueHasMoved(PlayerStateStore& store, uint64_t revision) {
    store.queueChanged(currentQueue());
    return store.read().queueRevision != revision;
}

// A dead entry is re-added by handle rather than by position, the choice foo_queuecontents
// (github.com/ssalonen/foo_queuecontents) makes for the entries it treats as dead.
void readdEntries(const playlist_manager_v5::ptr& manager,
                  const pfc::list_t<t_playback_queue_item>& entries) {
    for (t_size item = 0; item < entries.get_count(); ++item) {
        const auto& entry = entries[item];
        if (queuedLocationOf(entry))
            manager->queue_add_item_playlist(entry.m_playlist, entry.m_item);
        else
            manager->queue_add_item(entry.m_handle);
    }
}

// The foobar2000 SDK has no queue insert: queue_add_item and queue_add_item_playlist only
// append. So an `at` drains the queue from there, appends, and replays the tail.
void queueAt(const playlist_manager_v5::ptr& manager, std::optional<QueuePosition> at,
             const std::function<void(const playlist_manager_v5::ptr&)>& addNewEntries) {
    pfc::list_t<t_playback_queue_item> tail;
    if (at) {
        const auto queueCount = manager->queue_get_count();
        if (at->index < queueCount) {
            pfc::list_t<t_playback_queue_item> contents;
            manager->queue_get_contents(contents);

            for (t_size item = at->index; item < contents.get_count(); ++item)
                tail.add_item(contents[item]);

            manager->queue_remove_mask(bit_array_range(at->index, tail.get_count(), true));
        }
    }

    addNewEntries(manager);

    readdEntries(manager, tail);
}

PlayerOutcome queueRowsOnMainThread(const std::string& playlistId,
                                    const std::vector<uint32_t>& positions,
                                    std::optional<QueuePosition> at, PlayerStateStore& store) {
    const auto manager = playlist_manager_v5::get();
    const auto index = findPlaylist(playlistId);

    QueueEditFacts facts;
    facts.queueMoved = at && queueHasMoved(store, at->revision);
    facts.noSuchPlaylist = index == pfc::infinite_size;
    if (!facts.noSuchPlaylist) {
        const auto rowCount = manager->playlist_get_item_count(index);
        facts.positionPastEnd =
            std::any_of(positions.begin(), positions.end(),
                        [rowCount](uint32_t position) { return position >= rowCount; }) ||
            (at && at->index > manager->queue_get_count());
    }

    if (const auto refusal = queueEditRefusal(facts); refusal != PlayerOutcome::done)
        return refusal;

    queueAt(manager, at, [&positions, index](const playlist_manager_v5::ptr& manager) {
        for (const auto position : positions)
            manager->queue_add_item_playlist(index, position);
    });

    return PlayerOutcome::done;
}

PlayerOutcome queueTracksOnMainThread(uint64_t structure, const std::vector<uint32_t>& ordinals,
                                      std::optional<QueuePosition> at,
                                      const OrdinalResolver& resolveOrdinals,
                                      PlayerStateStore& store) {
    const auto manager = playlist_manager_v5::get();
    const auto resolved = resolveOrdinals(structure, ordinals);

    QueueEditFacts facts;
    facts.queueMoved = at && queueHasMoved(store, at->revision);
    facts.libraryMoved = !resolved.structureMatched;
    facts.positionPastEnd = at && at->index > manager->queue_get_count();

    if (const auto refusal = queueEditRefusal(facts); refusal != PlayerOutcome::done)
        return refusal;

    queueAt(manager, at, [&resolved](const playlist_manager_v5::ptr& manager) {
        for (t_size item = 0; item < resolved.items.get_count(); ++item)
            manager->queue_add_item(resolved.items[item]);
    });

    return PlayerOutcome::done;
}

// `to` is the entry's index once `from` has been taken out, so both name a position in the
// same, unchanged-length queue. Rebuilding from `min(from, to)` rather than just the affected
// span reuses queueAt's own re-add loop instead of a second one for the shorter range.
PlayerOutcome moveEntryOnMainThread(uint32_t from, uint32_t to, uint64_t revision,
                                    PlayerStateStore& store) {
    const auto manager = playlist_manager_v5::get();

    pfc::list_t<t_playback_queue_item> contents;
    manager->queue_get_contents(contents);
    const auto count = contents.get_count();

    QueueEditFacts facts;
    facts.queueMoved = queueHasMoved(store, revision);
    facts.positionPastEnd = from >= count || to >= count;

    if (const auto refusal = queueEditRefusal(facts); refusal != PlayerOutcome::done)
        return refusal;

    const auto entry = contents.remove_by_idx(from);
    contents.insert_item(entry, to);

    const t_size start = std::min<t_size>(from, to);
    pfc::list_t<t_playback_queue_item> tail;
    for (t_size item = start; item < contents.get_count(); ++item)
        tail.add_item(contents[item]);

    manager->queue_remove_mask(bit_array_range(start, tail.get_count(), true));
    readdEntries(manager, tail);

    return PlayerOutcome::done;
}

PlayerOutcome removeEntryOnMainThread(uint32_t index, uint64_t revision, PlayerStateStore& store) {
    const auto manager = playlist_manager_v5::get();

    QueueEditFacts facts;
    facts.queueMoved = queueHasMoved(store, revision);
    facts.positionPastEnd = index >= manager->queue_get_count();

    if (const auto refusal = queueEditRefusal(facts); refusal != PlayerOutcome::done)
        return refusal;

    manager->queue_remove_mask(bit_array_one(index));
    return PlayerOutcome::done;
}

}  // namespace

std::vector<QueueEntry> currentQueue() {
    pfc::list_t<t_playback_queue_item> items;
    playlist_manager::get()->queue_get_contents(items);

    std::vector<QueueEntry> entries;
    entries.reserve(items.get_count());
    for (t_size at = 0; at < items.get_count(); ++at)
        entries.push_back(queueEntryOf(items[at]));

    return entries;
}

QueueReader makeQueueReader(MainThreadQueue& mainThread, PlayerStateStore& store) {
    const auto scripts = compiledNameScripts(kTitleOrNothingScript);
    const auto libraryManager = library_manager::get();

    return [&mainThread, &store, scripts, libraryManager] {
        const auto copied = askForOutcome<CopiedQueue>(mainThread, "reading the queue",
                                                       [&store] { return copyQueue(store); });

        QueueRead read;
        read.outcome = copied.outcome;
        read.revision = copied.revision;

        if (read.outcome == PlayerOutcome::done) {
            read.entries.reserve(copied.items.size());
            for (const auto& item : copied.items)
                read.entries.push_back(formatted(item, scripts, libraryManager));
        }

        return read;
    };
}

PlaylistRowQueuer makePlaylistRowQueuer(MainThreadQueue& mainThread, PlayerStateStore& store) {
    return
        [&mainThread, &store](const std::string& playlistId, const std::vector<uint32_t>& positions,
                              std::optional<QueuePosition> at) {
            return askForOutcome<PlayerOutcome>(
                mainThread, "queueing playlist rows", [playlistId, positions, at, &store] {
                    return queueRowsOnMainThread(playlistId, positions, at, store);
                });
        };
}

LibraryTrackQueuer makeLibraryTrackQueuer(MainThreadQueue& mainThread,
                                          OrdinalResolver resolveOrdinals,
                                          PlayerStateStore& store) {
    return [&mainThread, resolveOrdinals = std::move(resolveOrdinals), &store](
               uint64_t structure, const std::vector<uint32_t>& ordinals,
               std::optional<QueuePosition> at) {
        return askForOutcome<PlayerOutcome>(
            mainThread, "queueing library tracks",
            [structure, ordinals, at, resolveOrdinals, &store] {
                return queueTracksOnMainThread(structure, ordinals, at, resolveOrdinals, store);
            });
    };
}

MoveQueueEntry makeMoveQueueEntry(MainThreadQueue& mainThread, PlayerStateStore& store) {
    return [&mainThread, &store](uint32_t from, uint32_t to, uint64_t revision) {
        return askForOutcome<PlayerOutcome>(
            mainThread, "moving a queue entry", [from, to, revision, &store] {
                return moveEntryOnMainThread(from, to, revision, store);
            });
    };
}

RemoveQueueEntry makeRemoveQueueEntry(MainThreadQueue& mainThread, PlayerStateStore& store) {
    return [&mainThread, &store](uint32_t index, uint64_t revision) {
        return askForOutcome<PlayerOutcome>(
            mainThread, "removing a queue entry",
            [index, revision, &store] { return removeEntryOnMainThread(index, revision, store); });
    };
}

ClearQueue makeClearQueue(MainThreadQueue& mainThread) {
    return [&mainThread] {
        return askForOutcome<PlayerOutcome>(mainThread, "clearing the queue", [] {
            playlist_manager_v5::get()->queue_flush();
            return PlayerOutcome::done;
        });
    };
}

}  // namespace jean
