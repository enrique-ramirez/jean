#pragma once

#include <foobar2000/SDK/foobar2000.h>

#include <optional>
#include <string>

// What this component publishes about a track it holds a handle to: the two spellings of its
// path, and the scripts that name it.
namespace jean {

// The path as a client is shown it, through filesystem::g_get_display_path; see ARCHITECTURE.md,
// *Track identity*. Empty for an invalid handle.
std::string displayPathOf(const metadb_handle_ptr& track);

// The library-relative, forward-slashed path GET /api/artwork?track= takes, or nothing where the
// media library does not hold the track. `libraryManager` is resolved on the main thread, since
// fb2k::std_api_get off it is undocumented; get_relative_path itself is any-thread.
std::optional<std::string> libraryPathOf(const metadb_handle_ptr& track,
                                         const library_manager::ptr& libraryManager);

// foobar2000 answers the filename for a track with no title tag: "If 'title' metadata field is
// missing, file name is used instead." The playing track's name keeps that fallback, and a queue
// entry drops it.
constexpr char kTitleOrFilenameScript[] = "%title%";
constexpr char kTitleOrNothingScript[] = "[%title%]";

// Where none of the fields resolves, foobar2000 answers the literal text "?" rather than an empty
// string; bracketing discards it, so an untagged track reads as having no artist rather than one
// named "?". %artist% checks artist, album artist, composer and performer in that order, and
// %album artist% is a field of its own rather than filled in from %artist%.
constexpr char kArtistScript[] = "[%artist%]";
constexpr char kAlbumScript[] = "[%album%]";
constexpr char kAlbumArtistScript[] = "[%album artist%]";

struct NameScripts {
    titleformat_object::ptr title;
    titleformat_object::ptr artist;
    titleformat_object::ptr album;
    titleformat_object::ptr albumArtist;
};

// Main thread, once, for the reason ARCHITECTURE.md, *Facts about the player*, gives for
// compiling a shared titleformat_object there.
NameScripts compiledNameScripts(const char* titleScript);

}  // namespace jean
