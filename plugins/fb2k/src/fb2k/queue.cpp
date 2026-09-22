#include "fb2k/PCH.h"

#include "fb2k/queue.h"

#include "fb2k/ask_player.h"
#include "fb2k/library.h"
#include "fb2k/playlists.h"
#include "fb2k/strings.h"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace jean {

namespace {

// Bracketed so a track missing the tag reads as no value: unbracketed, %title% falls back to
// the filename and %artist% resolves to the literal text "?".
constexpr char kTitleScript[] = "[%title%]";
constexpr char kArtistScript[] = "[%artist%]";
constexpr char kAlbumScript[] = "[%album%]";
constexpr char kAlbumArtistScript[] = "[%album artist%]";

struct Scripts {
    titleformat_object::ptr title;
    titleformat_object::ptr artist;
    titleformat_object::ptr album;
    titleformat_object::ptr albumArtist;
};

Scripts compileScripts() {
    const auto compiler = titleformat_compiler::get();

    Scripts scripts;
    compiler->compile_safe_ex(scripts.title, kTitleScript, "");
    compiler->compile_safe_ex(scripts.artist, kArtistScript, "");
    compiler->compile_safe_ex(scripts.album, kAlbumScript, "");
    compiler->compile_safe_ex(scripts.albumArtist, kAlbumArtistScript, "");
    return scripts;
}

// Copied on the main thread, alongside playlist_manager: every one of its methods is main
// thread only. Formatting the tags happens off it, once this is back on an HTTP worker.
struct CopiedQueueItem {
    metadb_handle_ptr handle;
    std::optional<PlayingLocation> location;
};

struct CopiedQueue {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    uint64_t revision = 0;
    std::vector<CopiedQueueItem> items;
};

CopiedQueue copyQueue(PlayerStateStore& store) {
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

QueuedTrack formatted(const CopiedQueueItem& item, const Scripts& scripts,
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

    pfc::string8 relative;
    if (libraryManager->get_relative_path(item.handle, relative))
        track.libraryPath = forwardSlashed(toStd(relative));

    return track;
}

// See ARCHITECTURE.md, *Threads, and what may block*, for the race this closes only half of.
bool queueHasMoved(PlayerStateStore& store, uint64_t revision) {
    return store.read().queueRevision != revision;
}

// See ARCHITECTURE.md, *Facts about the player*, for why a dead entry is re-added by handle
// rather than by position.
void readdEntries(playlist_manager_v5::ptr manager,
                  const pfc::list_t<t_playback_queue_item>& entries) {
    for (t_size item = 0; item < entries.get_count(); ++item) {
        const auto& entry = entries[item];
        if (queuedLocationOf(entry))
            manager->queue_add_item_playlist(entry.m_playlist, entry.m_item);
        else
            manager->queue_add_item(entry.m_handle);
    }
}

// See ARCHITECTURE.md, *Facts about the player*, for why an `at` drains the queue and
// replays the tail.
void queueAt(playlist_manager_v5::ptr manager, std::optional<QueuePosition> at,
             const std::function<void(playlist_manager_v5::ptr)>& addNewEntries) {
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

PlaylistOutcome beginQueueRows(const std::string& playlistId,
                               const std::vector<uint32_t>& positions,
                               std::optional<QueuePosition> at, PlayerStateStore& store) {
    if (at && queueHasMoved(store, at->revision))
        return PlaylistOutcome::queueMoved;

    const auto index = findPlaylist(playlistId);
    if (index == pfc::infinite_size)
        return PlaylistOutcome::noSuchPlaylist;

    auto manager = playlist_manager_v5::get();

    const auto rowCount = manager->playlist_get_item_count(index);
    const bool rowPastEnd =
        std::any_of(positions.begin(), positions.end(),
                    [rowCount](uint32_t position) { return position >= rowCount; });
    if (rowPastEnd)
        return PlaylistOutcome::positionPastEnd;

    const auto queueCount = manager->queue_get_count();
    if (at && at->index > queueCount)
        return PlaylistOutcome::positionPastEnd;

    queueAt(manager, at, [&positions, index](playlist_manager_v5::ptr manager) {
        for (const auto position : positions)
            manager->queue_add_item_playlist(index, position);
    });

    return PlaylistOutcome::done;
}

// See beginFill: resolution and the structure check run together, in the one lock, so a
// rebuild landing between the route's own check and this job cannot be read as a match.
PlaylistOutcome beginQueueTracks(uint64_t structure, const std::vector<uint32_t>& ordinals,
                                 std::optional<QueuePosition> at,
                                 const OrdinalResolver& resolveOrdinals, PlayerStateStore& store) {
    if (at && queueHasMoved(store, at->revision))
        return PlaylistOutcome::queueMoved;

    const auto resolved = resolveOrdinals(structure, ordinals);
    if (!resolved.structureMatched)
        return PlaylistOutcome::structureMoved;

    auto manager = playlist_manager_v5::get();

    const auto queueCount = manager->queue_get_count();
    if (at && at->index > queueCount)
        return PlaylistOutcome::positionPastEnd;

    queueAt(manager, at, [&resolved](playlist_manager_v5::ptr manager) {
        for (t_size item = 0; item < resolved.items.get_count(); ++item)
            manager->queue_add_item(resolved.items[item]);
    });

    return PlaylistOutcome::done;
}

// `to` is the entry's index once `from` has been taken out, so both name a position in the
// same, unchanged-length queue. Rebuilding from `min(from, to)` rather than just the affected
// span reuses queueAt's own re-add loop instead of a second one for the shorter range.
PlaylistOutcome beginMoveQueueEntry(uint32_t from, uint32_t to, uint64_t revision,
                                    PlayerStateStore& store) {
    if (queueHasMoved(store, revision))
        return PlaylistOutcome::queueMoved;

    auto manager = playlist_manager_v5::get();

    pfc::list_t<t_playback_queue_item> contents;
    manager->queue_get_contents(contents);

    const auto count = contents.get_count();
    if (from >= count || to >= count)
        return PlaylistOutcome::positionPastEnd;

    const auto entry = contents.remove_by_idx(from);
    contents.insert_item(entry, to);

    const t_size start = std::min<t_size>(from, to);
    pfc::list_t<t_playback_queue_item> tail;
    for (t_size item = start; item < contents.get_count(); ++item)
        tail.add_item(contents[item]);

    manager->queue_remove_mask(bit_array_range(start, tail.get_count(), true));
    readdEntries(manager, tail);

    return PlaylistOutcome::done;
}

PlaylistOutcome beginRemoveQueueEntry(uint32_t index, uint64_t revision, PlayerStateStore& store) {
    if (queueHasMoved(store, revision))
        return PlaylistOutcome::queueMoved;

    auto manager = playlist_manager_v5::get();
    if (index >= manager->queue_get_count())
        return PlaylistOutcome::positionPastEnd;

    manager->queue_remove_mask(bit_array_one(index));
    return PlaylistOutcome::done;
}

PlaylistOutcome beginClearQueue() {
    playlist_manager_v5::get()->queue_flush();
    return PlaylistOutcome::done;
}

}  // namespace

QueueReader makeQueueReader(MainThreadQueue& mainThread, PlayerStateStore& store) {
    const auto scripts = compileScripts();
    const auto libraryManager = library_manager::get();

    return [&mainThread, &store, scripts, libraryManager] {
        const auto copied = askPlayer<CopiedQueue>(
            mainThread, "reading the queue",
            [&store](const AnswerPtr<CopiedQueue>& answer) { answer->set(copyQueue(store)); },
            CopiedQueue{PlaylistOutcome::timedOut, {}, {}},
            CopiedQueue{PlaylistOutcome::playerRefused, {}, {}});

        QueueRead read;
        read.outcome = copied.outcome;
        read.revision = copied.revision;

        if (read.outcome == PlaylistOutcome::done) {
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
            return askPlayer<PlaylistOutcome>(
                mainThread, "queueing playlist rows",
                [playlistId, positions, at, &store](const AnswerPtr<PlaylistOutcome>& answer) {
                    answer->set(beginQueueRows(playlistId, positions, at, store));
                },
                PlaylistOutcome::timedOut, PlaylistOutcome::playerRefused);
        };
}

LibraryTrackQueuer makeLibraryTrackQueuer(MainThreadQueue& mainThread,
                                          OrdinalResolver resolveOrdinals,
                                          PlayerStateStore& store) {
    return [&mainThread, resolveOrdinals, &store](uint64_t structure,
                                                  const std::vector<uint32_t>& ordinals,
                                                  std::optional<QueuePosition> at) {
        return askPlayer<PlaylistOutcome>(
            mainThread, "queueing library tracks",
            [structure, ordinals, at, resolveOrdinals,
             &store](const AnswerPtr<PlaylistOutcome>& answer) {
                answer->set(beginQueueTracks(structure, ordinals, at, resolveOrdinals, store));
            },
            PlaylistOutcome::timedOut, PlaylistOutcome::playerRefused);
    };
}

MoveQueueEntry makeMoveQueueEntry(MainThreadQueue& mainThread, PlayerStateStore& store) {
    return [&mainThread, &store](uint32_t from, uint32_t to, uint64_t revision) {
        return askPlayer<PlaylistOutcome>(
            mainThread, "moving a queue entry",
            [from, to, revision, &store](const AnswerPtr<PlaylistOutcome>& answer) {
                answer->set(beginMoveQueueEntry(from, to, revision, store));
            },
            PlaylistOutcome::timedOut, PlaylistOutcome::playerRefused);
    };
}

RemoveQueueEntry makeRemoveQueueEntry(MainThreadQueue& mainThread, PlayerStateStore& store) {
    return [&mainThread, &store](uint32_t index, uint64_t revision) {
        return askPlayer<PlaylistOutcome>(
            mainThread, "removing a queue entry",
            [index, revision, &store](const AnswerPtr<PlaylistOutcome>& answer) {
                answer->set(beginRemoveQueueEntry(index, revision, store));
            },
            PlaylistOutcome::timedOut, PlaylistOutcome::playerRefused);
    };
}

ClearQueue makeClearQueue(MainThreadQueue& mainThread) {
    return [&mainThread] {
        return askPlayer<PlaylistOutcome>(
            mainThread, "clearing the queue",
            [](const AnswerPtr<PlaylistOutcome>& answer) { answer->set(beginClearQueue()); },
            PlaylistOutcome::timedOut, PlaylistOutcome::playerRefused);
    };
}

}  // namespace jean
