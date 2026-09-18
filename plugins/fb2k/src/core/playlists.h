#pragma once

#include "core/json.h"
#include "core/library.h"
#include "core/player_state.h"

#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

// Playlists and autoplaylists. Pure: a request is understood and refused here, and the
// player is involved in fb2k/playlists.h.
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

// One of the component's own playlists. Closed to this one so a request can never address
// a second of its own invention, and so nothing resolves one by matching a title.
enum class OwnPlaylistRole { scratch };

// The name a role answers to. It is also the marker fb2k/playlists.cpp writes on the
// playlist, which foobar2000 keeps across restarts, so changing a name here loses every
// playlist already carrying the old one.
std::string roleName(OwnPlaylistRole role);

struct PlaylistAnnotation {
    // foobar2000's playlist GUID. Stable across renames, reordering and restarts, and
    // never reused.
    std::string id;

    std::string beefwebId;

    int index = 0;

    std::string title;

    size_t itemCount = 0;

    bool isAutoPlaylist = false;

    std::optional<OwnPlaylistRole> role;

    uint64_t structure = 0;
    uint64_t revision = 0;

    std::optional<AutoPlaylistSpec> managed;
};

// ARCHITECTURE.md, *Two generations*, is the split these copy, one playlist at a time.
struct PlaylistVersion {
    uint64_t structure = 0;
    uint64_t revision = 0;
};

enum class RowsChanged { added, removed, reordered, replaced };

// The fields fb2k/playlists.h's ChangedPositions carries, in the order it copies them.
struct ChangedSince {
    DeltaOutcome catchUp = DeltaOutcome::ok;
    uint64_t revision = 0;
    std::vector<uint32_t> positions;
};

// Same figure as core/library.h's kRetainedRevisions, ARCHITECTURE.md *Two generations* is
// why. Named separately because this window is kept per playlist rather than once per
// install, so what it costs is multiplied by however many playlists have seen a change.
constexpr size_t kRetainedPlaylistRevisions = kRetainedRevisions;

class PlaylistVersions {
public:
    explicit PlaylistVersions(size_t retainedRevisions = kRetainedPlaylistRevisions);

    void rowsChanged(const std::string& playlistId, RowsChanged how);

    void contentChanged(const std::string& playlistId, const std::vector<uint32_t>& positions);

    // Where the player says it is playing, or nothing. A play count reaches no callback on any
    // install, so the row a track leaves is recorded on the way out whatever the player
    // announced: ARCHITECTURE.md, *Facts about the player*.
    void playingRowChanged(const std::optional<PlayingLocation>& nowPlaying);

    PlaylistVersion of(const std::string& playlistId) const;

    ChangedSince changedSince(const std::string& playlistId, uint64_t structure,
                              uint64_t since) const;

private:
    struct Retained {
        uint64_t revision = 0;
        std::vector<uint32_t> positions;
    };

    struct Tracked {
        explicit Tracked(uint64_t startOfRun)
            : version{startOfRun, startOfRun}, structureBegan(startOfRun) {}

        PlaylistVersion version;
        uint64_t structureBegan;
        std::deque<Retained> retained;
    };

    // foobar2000 raises the callbacks that write this deque on its main thread, which may
    // never block.
    static std::vector<uint32_t> positionsAfterLocked(const std::deque<Retained>& retained,
                                                      uint64_t since);

    Tracked& trackedLocked(const std::string& playlistId);
    void recordChangeLocked(const std::string& playlistId, std::vector<uint32_t> positions);

    const size_t retainedRevisions_;
    const Tracked untouched_;

    mutable std::mutex mutex_;
    std::unordered_map<std::string, Tracked> playlists_;
    std::optional<PlayingLocation> playingRow_;
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
    positionPastEnd,
    notOurs,
    keyInUse,
    tooMany,
    // Means what GET /api/library/changes already means by 409: export again, then ask again.
    structureMoved,
    // The revision a move, a remove or a positioned queue named is not the queue's current
    // one, checked at the route and answered again from inside the job for the same reason
    // structureMoved is: a change can land between the two. Distinct from structureMoved so a
    // client with both remedies at hand -- re-read the queue, or export the library again --
    // knows which one applies.
    queueMoved,
    rowsMoved,
    rowsRevisionTooOld,
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
// the title a fill hands to the component's own scratch playlist. One number, so the two
// routes that both accept a title cannot drift apart on how long one may be.
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
