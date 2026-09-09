#include "fb2k/PCH.h"

#include "fb2k/tag_writer.h"

#include "core/log.h"
#include "fb2k/ask_player.h"
#include "fb2k/playlists.h"

#include <algorithm>
#include <map>

namespace jean {

namespace {

pfc::string8 canonicalPath(const std::string& path) {
    pfc::string8 canonical;
    filesystem::g_get_canonical_path(path.c_str(), canonical);
    return canonical;
}

bool inAnyPlaylist(const metadb_handle_ptr& track) {
    auto playlists = playlist_manager::get();
    const auto indices = playlistIndices();

    return std::any_of(indices.begin(), indices.end(), [&](size_t index) {
        metadb_handle_list items;
        playlists->playlist_get_all_items(index, items);
        return items.find_item(track) != pfc::infinite_size;
    });
}

bool knownToPlayer(const metadb_handle_ptr& track) {
    return library_manager::get()->is_item_in_library(track) || inAnyPlaylist(track);
}

service_ptr_t<file_info_filter> makeFilter(std::map<std::string, std::string> fields) {
    return file_info_filter::create([fields](trackRef, t_filestats, file_info& info) {
        std::for_each(fields.begin(), fields.end(), [&info](const auto& field) {
            if (field.second.empty())
                info.meta_remove_field(field.first.c_str());
            else
                info.meta_set(field.first.c_str(), field.second.c_str());
        });

        return true;
    });
}

// Main thread only.
void beginWrite(const TagWrite& write, const AnswerPtr<TagWriteOutcome>& answer) {
    const auto track =
        metadb::get()->handle_create(canonicalPath(write.track.path), write.track.subsong);

    if (!knownToPlayer(track)) {
        logError("refusing to write tags to a track foobar2000 does not know: " + write.track.path);
        answer->set(TagWriteOutcome::trackNotKnown);
        return;
    }

    metadb_handle_list one;
    one.add_item(track);

    const uint32_t flags = metadb_io_v2::op_flag_silent | metadb_io_v2::op_flag_no_errors;

    metadb_io_v2::get()->update_info_async(one, makeFilter(write.fields), fb2k::hwnd_t{}, flags,
                                           fb2k::makeCompletionNotify([answer](unsigned status) {
                                               answer->set(status == metadb_io::update_info_success
                                                               ? TagWriteOutcome::written
                                                               : TagWriteOutcome::writeFailed);
                                           }));
}

}  // namespace

TagWriter makeTagWriter(MainThreadQueue& mainThread) {
    return [&mainThread](const TagWrite& write) {
        return askPlayer<TagWriteOutcome>(
            mainThread, "a tag write",
            [write](const AnswerPtr<TagWriteOutcome>& answer) { beginWrite(write, answer); },
            TagWriteOutcome::timedOut, TagWriteOutcome::writeFailed);
    };
}

}  // namespace jean
