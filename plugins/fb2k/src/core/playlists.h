#pragma once

#include "core/json.h"
#include "core/player_state.h"

#include <functional>
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

// One of the component's own playlists. Closed to these two so a request can never address
// a third of its own invention, and so nothing resolves one by matching a title.
enum class OwnPlaylistRole { scratch, queue };

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
    positionPastEnd,
    notOurs,
    keyInUse,
    tooMany,
    // Means what GET /api/library/changes already means by 409: export again, then ask again.
    structureMoved,
    playerRefused,
    timedOut,
    unavailable,
    // The read-only-playlists setting, checked at the route before the player is asked
    // anything. Distinct from notOurs, the structural refusal ourPlaylist() answers whatever
    // the setting says.
    writesDisabled,
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

// A limit every title on a playlist this component names shares: the autoplaylist's own and
// the title a fill hands to one of the component's own two. One number, so the two routes
// that both accept a title cannot drift apart on how long one may be.
constexpr size_t kMaxTitle = 256;

// Whether `key`'s text field is present, printable and within `limit`, folding the presence
// check `need` asks for into the one result. Shared by every route that reads a title, a key
// or a query, so what makes one of those acceptable is answered once rather than once per
// caller.
struct TextField {
    std::string why;
    std::string value;

    bool ok() const { return why.empty(); }
};

TextField readText(const nlohmann::json& root, const char* key, size_t limit, Need need);

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

// nullopt once the entry's row or whole playlist is gone, never the infinite index left in
// its place, for the reason ARCHITECTURE.md, *Facts about the player*, gives.
std::optional<PlayingLocation> queuedLocation(
    size_t playlist, size_t item, const std::function<std::string(size_t)>& playlistIdAt);

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
