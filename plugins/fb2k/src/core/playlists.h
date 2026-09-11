#pragma once

#include <optional>
#include <string>
#include <vector>

// Autoplaylists, and the one question about playlists that beefweb cannot answer. Pure:
// a request is understood and refused here, and the player is involved in fb2k/playlists.h.
//
// This does not list playlists. beefweb does that, and a second listing would be a second
// source of truth about titles, item counts and order.
namespace jean {

// `query` and `sort` are foobar2000's own syntax, passed through untouched: only the
// player can say whether a query parses.
struct AutoPlaylistSpec {
    // foobar2000 permits duplicate titles and lets the user rename anything, so nothing
    // here treats a title as identity.
    std::string title;

    std::string key;

    std::string query;
    std::string sort;
    bool forceSort = false;
};

struct PlaylistAnnotation {
    // foobar2000's playlist GUID. Stable across renames, reordering and restarts, and
    // never reused.
    std::string id;

    std::string beefwebId;

    int index = 0;

    // A snapshot from another request: for checking a join against, not for display.
    std::string title;

    bool isAutoPlaylist = false;

    std::optional<AutoPlaylistSpec> managed;
};

enum class PlaylistRefusal {
    none,
    malformedBody,
    badTitle,
    badKey,
    badQuery,
    badSort,
    badId,
    badOrdinals,
    tooFast,
};

struct AutoPlaylistRequest {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string detail;
    AutoPlaylistSpec spec;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

enum class PlaylistOutcome {
    done,
    // An outcome rather than a refusal because only foobar2000 can parse a query.
    queryInvalid,
    noSuchPlaylist,
    notOurs,
    keyInUse,
    tooMany,
    playerRefused,
    timedOut,
    unavailable,
};

struct PlaylistResult {
    PlaylistOutcome outcome = PlaylistOutcome::done;

    // Set for queryInvalid: foobar2000's own message, which describes only text the
    // client sent and so is safe to relay.
    std::string detail;

    PlaylistAnnotation playlist;
};

PlaylistResult playlistFailure(PlaylistOutcome outcome, std::string detail = {});

struct PlaylistsResult {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    std::vector<PlaylistAnnotation> playlists;
};

// Trying a query without creating anything. An unparseable query is an ordinary answer
// here, because this route is called while somebody is still typing; creating with the
// same query is a 400.
struct PreviewResult {
    PlaylistOutcome outcome = PlaylistOutcome::done;
    bool valid = false;
    std::string error;
    int matches = 0;

    // Autoplaylists filter the Media Library and nothing else, and plenty of installs have
    // none configured, so a library that isn't there and a query that matches nothing are
    // worth telling apart.
    bool libraryEnabled = false;
};

PreviewResult previewFailure(PlaylistOutcome outcome);

// Creating requires a title; updating leaves the name alone when none is given, so changing
// a query cannot silently rename a playlist back to a stale title.
enum class Need { required, optional };

// Never throws: a malformed body is routine for the HTTP handler that calls these.
AutoPlaylistRequest parseAutoPlaylist(const std::string& body, Need title);
AutoPlaylistRequest parseQueryPreview(const std::string& body);

// The 8-4-4-4-12 form of a foobar2000 playlist GUID, lower case. Checked here because
// pfc::GUID_from_text reads unknown characters as zero and never reports failure, so
// garbage would become a well-formed GUID.
bool isPlaylistId(const std::string& id);

// beefweb's own ids are "p" and a number; anything else was written by something other
// than the beefweb this reads, and is reported absent rather than passed on.
bool looksLikeBeefwebId(const std::string& id);

bool keyTaken(const std::vector<PlaylistAnnotation>& playlists, const std::string& key,
              const std::string& exceptId);

PlaylistResult roomForAnotherAutoPlaylist(const std::vector<PlaylistAnnotation>& playlists,
                                          int maxAutoPlaylists);

// The title is not stored here: foobar2000 owns it, and a copy here could only go stale.
std::string serialiseAutoPlaylist(const AutoPlaylistSpec& spec);

// Tolerant like the config parser: a record written by a future version of this component
// must not stop this one reading the parts it still understands.
AutoPlaylistSpec parseStoredAutoPlaylist(const std::string& stored);

std::string describe(PlaylistRefusal refusal);
std::string describe(PlaylistOutcome outcome);

}  // namespace jean
