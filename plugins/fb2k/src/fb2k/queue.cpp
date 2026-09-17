#include "fb2k/PCH.h"

#include "fb2k/queue.h"

#include "fb2k/ask_player.h"
#include "fb2k/playlists.h"
#include "fb2k/strings.h"

#include <cstdint>
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

}  // namespace jean
