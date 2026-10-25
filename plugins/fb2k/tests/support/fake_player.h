#pragma once

#include "core/documents.h"
#include "core/library.h"
#include "core/player.h"
#include "core/player_outcome.h"
#include "core/player_state.h"
#include "core/playlists.h"

#include <cstddef>
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace jean::testing {

// A row as a playlist holds it: what each title-formatting column resolves to, where the media
// library holds the track, and which track inside its file it is. A column the row has no field
// for resolves to kUnresolved, as foobar2000 answers a field a track does not carry.
struct FakeRow {
    std::map<std::string, std::string> fields;
    std::optional<std::string> libraryPath;
    uint32_t subsong = 0;
};

FakeRow titled(const std::string& title);

std::vector<FakeRow> titledRows(const std::vector<std::string>& titles);

FakeRow libraryTrack(uint32_t ordinal);

// Each call the Player seam offers that the fake answers.
enum class Call {
    listPlaylists,
    readRole,
    readRows,
    readChangedRows,
    readTracks,
    createPlaylist,
    renamePlaylist,
    removePlaylist,
    movePlaylist,
    copyRows,
    removeRows,
    moveRows,
    sortRows,
    fill,
    resolveOwn,
    emptyOwn,
    createAutoPlaylist,
    updateAutoPlaylist,
    removeAutoPlaylist,
    previewQuery,
    readQueue,
    queueRows,
    queueTracks,
    moveQueueEntry,
    removeQueueEntry,
    clearQueue,
    playRow,
};

// One foobar2000 in memory: its playlists in the player's own order, each holding rows, and its
// play queue. Every call through player() is judged the way src/fb2k/ judges it, with the facts
// weighed by core/refusal_order, and answered from and applied to this state, so a test reads
// an edit back through the routes a client would read it through. Every call is counted whether
// or not it was refused, which is how a test says a request never reached the player.
//
// Thread-safe: the server calls in from its own threads while the test reads the state back.
class FakePlayer {
public:
    // Ordinals resolve against `library`, and a fill, a create or a queued set naming any other
    // structure is refused as foobar2000's resolver refuses it. Where `store` is given, the queue
    // revision is the store's and every change to the queue is announced to it, as
    // fb2k/playback_watch.cpp announces one; otherwise the fake counts its own. Both must
    // outlive the fake, and the fake must outlive every server handed player().
    explicit FakePlayer(Library* library = nullptr, PlayerStateStore* store = nullptr);

    FakePlayer(const FakePlayer&) = delete;
    FakePlayer& operator=(const FakePlayer&) = delete;

    // servingPlayer()'s report, with the playlist, autoplaylist, queue and play-row calls bound
    // to this fake. Every other call stays null.
    Player player();

    // A playlist at the end of the list. Its index and item count are read off where it sits and
    // what it holds rather than off `entry`.
    void add(PlaylistAnnotation entry, std::vector<FakeRow> rows = {});

    void queue(std::vector<QueuedTrack> entries);

    // Replaces the rows at these positions and moves the playlist's content revision once, which
    // is what a retag at the player does. GET /playlists/{id}/items/changes answers them from then
    // on.
    void retag(const std::string& id, const std::map<uint32_t, FakeRow>& rows);

    // The oldest revision a delta may still be asked from. Before it, the playlist's history is
    // gone and a delta is refused as too old.
    void retainRevisionsFrom(const std::string& id, uint64_t revision);

    // foobar2000 is the only thing that can parse a query, so what a preview answers is whatever
    // the test says. A query nobody set is valid and matches nothing.
    void answerPreview(const std::string& query, PreviewResult answer);

    // From now on every `call` answers `outcome` and changes nothing. A refused call that adds
    // rows still answers the positions they would have taken: foobar2000 takes an insert into a
    // locked playlist and drops it without failing anything, so a position worked out ahead of
    // an insert is no evidence that a row landed.
    void refuse(Call call, PlayerOutcome outcome);

    // A playlist_lock on `id`: renaming it, removing it through either delete route, adding rows,
    // removing rows and reordering them are refused. Moving a playlist within the list is announced
    // to a lock rather than filtered.
    void lock(const std::string& id);

    // Somebody closing the playlist's tab in foobar2000, which nothing in core/ is told about.
    void removeAtThePlayer(const std::string& id);

    // Somebody at the player queues a track after each queue edit reaches the player and before
    // it is judged: the change that can land between a route's revision check and its job.
    void changeTheQueueBeforeEachEdit();

    // The media library rebuilds after each call that resolves ordinals reaches the player and
    // before it resolves them: the change that can land between a route's structure check and
    // its job. Needs a library.
    void rebuildTheLibraryBeforeEachJob();

    std::vector<PlaylistAnnotation> playlists() const;
    std::optional<PlaylistAnnotation> playlist(const std::string& id) const;
    std::vector<FakeRow> rowsOf(const std::string& id) const;

    // Each row's %title%, which is how most cases read a playlist back.
    std::vector<std::string> titlesOf(const std::string& id) const;

    std::vector<QueuedTrack> queued() const;
    std::optional<PlayingLocation> playing() const;

    int count(Call call) const;

    // Every call asking the player to change a playlist, the queue or what is playing, refused or
    // not.
    int writes() const;

    // Every call the fake answered.
    int total() const;

    // The playlist each `call` named, in the order they arrived.
    std::vector<std::string> askedAbout(Call call) const;

    std::vector<bool> previewsAskingRows() const;

    // The id the fake gives the `nth` playlist it makes, counting from zero across a create, an
    // autoplaylist and a role remade.
    static std::string madeId(size_t nth);

    // Both counters of a playlist the fake makes: not zero and the same for both, which is what
    // PlaylistVersions answers for a playlist it has never seen, so a route pinning either
    // counter to a constant of its own is caught.
    static constexpr uint64_t kMadeVersion = 9204739866101318881ULL;

private:
    struct Held {
        PlaylistAnnotation entry;
        std::vector<FakeRow> rows;
        bool locked = false;
        uint64_t oldestRetained = 0;

        // The content revision each row last changed at.
        std::map<uint32_t, uint64_t> changedAt;
    };

    struct Asked {
        Call call;
        std::string playlistId;
    };

    std::vector<Held>::iterator find(const std::string& id);
    std::vector<Held>::const_iterator find(const std::string& id) const;
    PlaylistAnnotation annotate(size_t position) const;
    std::vector<PlaylistAnnotation> listing() const;

    void ask(Call call, const std::string& playlistId = {});
    std::optional<PlayerOutcome> refusal(Call call) const;

    bool libraryAt(uint64_t structure);
    Held& make(const std::string& title);
    static void landed(Held& held);

    static void reordered(Held& held, const std::vector<uint32_t>& order);

    uint64_t queueRevision() const;
    void queueChanged();
    void changeTheQueueIfAsked();
    std::optional<PlayerOutcome> queueRefusal(Call call, std::optional<uint64_t> revision,
                                              bool positionPastEnd);
    void insertIntoQueue(std::vector<QueuedTrack> entries, std::optional<QueuePosition> at);

    Library* library_;
    PlayerStateStore* store_;

    mutable std::mutex mutex_;
    std::vector<Held> playlists_;
    std::vector<QueuedTrack> queue_;
    uint64_t queueRevision_ = 1;
    std::optional<PlayingLocation> playing_;
    std::map<std::string, PreviewResult> previews_;
    std::vector<bool> previewsAskingRows_;
    std::map<Call, PlayerOutcome> refusals_;
    std::vector<Asked> asked_;
    size_t made_ = 0;
    bool queueChangesFirst_ = false;
    bool libraryRebuildsFirst_ = false;
};

}  // namespace jean::testing
