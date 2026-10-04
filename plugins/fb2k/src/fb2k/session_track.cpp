#include "fb2k/PCH.h"

#include "fb2k/session_track.h"

#include "core/ask_player.h"
#include "core/library.h"
#include "fb2k/columns.h"
#include "fb2k/tracks.h"

#include <string>
#include <vector>

namespace jean {

namespace {

struct CompiledColumns {
    PlayerOutcome outcome = PlayerOutcome::done;
    std::vector<titleformat_object::ptr> scripts;
};

// The track's own tags rather than playback_format_title_ex, which formats foobar2000's playing
// track: a detached session's track is not the one the player has loaded. foobar2000 holds no
// info for a file it has not read yet, one outside the library or one just rescanned, so that
// read answers no names rather than four empty ones the session would keep all turn.
bool nameFrom(const metadb_handle_ptr& handle, const NameScripts& scripts, SessionTrackRead& read) {
    metadb_info_container::ptr info;
    if (!handle->get_info_ref(info))
        return false;

    const file_info& tags = info->info();
    read.title = formattedField(handle, tags, scripts.title);
    read.artist = formattedField(handle, tags, scripts.artist);
    read.album = formattedField(handle, tags, scripts.album);
    read.albumArtist = formattedField(handle, tags, scripts.albumArtist);
    read.duration = tags.get_length();
    return true;
}

}  // namespace

SessionTrackReader makeSessionTrackReader(MainThreadQueue& mainThread) {
    const auto scripts = compiledNameScripts(kTitleOrFilenameScript);
    const auto compiler = titleformat_compiler::get();

    return [&mainThread, scripts, compiler](const SessionTrack& track,
                                            const std::vector<std::string>& columns) {
        const metadb_handle_ptr handle = handleOf(track);

        SessionTrackRead read;
        read.named = false;
        read.columns.assign(columns.size(), kUnresolved);

        if (!columns.empty()) {
            const auto compiled = askForOutcome<CompiledColumns>(
                mainThread, "compiling a session track's columns", [compiler, columns] {
                    return CompiledColumns{PlayerOutcome::done, compiledColumns(compiler, columns)};
                });

            if (compiled.outcome != PlayerOutcome::done)
                return failureOf<SessionTrackRead>(compiled.outcome);

            if (handle.is_valid())
                read.columns = formattedColumns(handle, compiled.scripts);
        }

        if (handle.is_valid())
            read.named = nameFrom(handle, scripts, read);

        return read;
    };
}

SessionArtworkReader makeSessionArtworkReader(const AlbumArt& art) {
    return [&art](const SessionTrack& track) {
        const metadb_handle_ptr handle = handleOf(track);
        return handle.is_valid() ? art.of(handle) : ArtworkSource{};
    };
}

}  // namespace jean
