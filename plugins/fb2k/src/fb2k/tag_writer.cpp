#include "fb2k/PCH.h"

#include "fb2k/tag_writer.h"

#include "fb2k/ask_player.h"
#include "fb2k/playlists.h"

#include <algorithm>
#include <functional>
#include <map>
#include <string>

namespace jean {

namespace {

using TagFields = std::map<std::string, std::string>;

service_ptr_t<file_info_filter> makeFilter(TagFields fields) {
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
void beginWrite(const metadb_handle_ptr& track, const TagFields& fields,
                const AnswerPtr<TagWriteOutcome>& answer) {
    metadb_handle_list one;
    one.add_item(track);

    const uint32_t flags = metadb_io_v2::op_flag_silent | metadb_io_v2::op_flag_no_errors;

    metadb_io_v2::get()->update_info_async(one, makeFilter(fields), fb2k::hwnd_t{}, flags,
                                           fb2k::makeCompletionNotify([answer](unsigned status) {
                                               answer->set(status == metadb_io::update_info_success
                                                               ? TagWriteOutcome::written
                                                               : TagWriteOutcome::writeFailed);
                                           }));
}

// Main thread only.
void beginWriteToRow(const PlaylistTrackRef& row, const TagFields& fields,
                     const PlaylistVersions& versions, const AnswerPtr<TagWriteOutcome>& answer) {
    const auto playlist = findPlaylist(row.playlistId);
    if (playlist == pfc::infinite_size) {
        answer->set(TagWriteOutcome::trackNotKnown);
        return;
    }

    if (versions.of(row.playlistId).structure != row.structure) {
        answer->set(TagWriteOutcome::rowsMoved);
        return;
    }

    const auto manager = playlist_manager::get();
    if (row.index >= manager->playlist_get_item_count(playlist)) {
        answer->set(TagWriteOutcome::trackNotKnown);
        return;
    }

    metadb_handle_ptr track;
    if (!manager->playlist_get_item_handle(track, playlist, row.index)) {
        answer->set(TagWriteOutcome::writeFailed);
        return;
    }

    beginWrite(track, fields, answer);
}

TagWriteOutcome askToWrite(MainThreadQueue& mainThread,
                           std::function<void(const AnswerPtr<TagWriteOutcome>&)> work) {
    return askPlayer<TagWriteOutcome>(mainThread, "a tag write", std::move(work),
                                      TagWriteOutcome::timedOut, TagWriteOutcome::writeFailed);
}

TagWriteOutcome writeTo(MainThreadQueue& mainThread, const metadb_handle_ptr& track,
                        const TagFields& fields) {
    return askToWrite(mainThread, [track, fields](const AnswerPtr<TagWriteOutcome>& answer) {
        beginWrite(track, fields, answer);
    });
}

TagWriteOutcome writeToLibraryTrack(MainThreadQueue& mainThread,
                                    const LibraryTrackResolver& resolve,
                                    const LibraryTrackRef& address, const TagFields& fields) {
    if (!resolve)
        return TagWriteOutcome::trackNotKnown;

    const LibraryTrackResolution at = resolve(address.track, address.subsong);
    if (at.heldTwice)
        return TagWriteOutcome::ambiguousAddress;

    if (at.handle.is_empty())
        return TagWriteOutcome::trackNotKnown;

    return writeTo(mainThread, at.handle, fields);
}

TagWriteOutcome writeToOrdinal(MainThreadQueue& mainThread, const OrdinalResolver& resolve,
                               const OrdinalTrackRef& address, const TagFields& fields) {
    if (!resolve)
        return TagWriteOutcome::trackNotKnown;

    const OrdinalResolution at = resolve(address.structure, {address.ordinal});
    if (!at.structureMatched)
        return TagWriteOutcome::libraryRebuilt;

    if (at.items.get_count() != 1)
        return TagWriteOutcome::trackNotKnown;

    return writeTo(mainThread, at.items[0], fields);
}

}  // namespace

TagWriter makeTagWriter(MainThreadQueue& mainThread, LibraryTrackResolver resolveLibraryTrack,
                        OrdinalResolver resolveOrdinal, const PlaylistVersions& versions) {
    return [&mainThread, resolveLibraryTrack, resolveOrdinal, &versions](const TagWrite& write) {
        if (write.track.playlist) {
            return askToWrite(mainThread, [row = *write.track.playlist, fields = write.fields,
                                           &versions](const AnswerPtr<TagWriteOutcome>& answer) {
                beginWriteToRow(row, fields, versions, answer);
            });
        }

        if (write.track.ordinal)
            return writeToOrdinal(mainThread, resolveOrdinal, *write.track.ordinal, write.fields);

        if (write.track.library)
            return writeToLibraryTrack(mainThread, resolveLibraryTrack, *write.track.library,
                                       write.fields);

        return TagWriteOutcome::trackNotKnown;
    };
}

}  // namespace jean
