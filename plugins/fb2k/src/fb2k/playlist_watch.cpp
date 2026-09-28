#include "fb2k/PCH.h"

#include "fb2k/playlist_watch.h"

#include "fb2k/playlists.h"

#include <algorithm>
#include <cstdint>
#include <iterator>
#include <string>
#include <vector>

namespace jean {

namespace {

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

}  // namespace

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
          mainThread_(mainThread),
          versions_(versions),
          store_(store) {}

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

}  // namespace jean
