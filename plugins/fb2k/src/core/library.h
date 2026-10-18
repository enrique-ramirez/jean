#pragma once

#include "core/library_splice.h"
#include "core/shared_bytes.h"

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <iterator>
#include <memory>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// A snapshot of the player's media library and the wire format a client reads it from. Pure:
// this half holds the columns, decides what a request may ask for and serialises the answer,
// and fb2k/ walks the player and feeds the rows in.
namespace jean {

// `directory` and `filename` are library-relative and forward-slashed: foobar2000's library
// root MUST NOT reach a client. `directory` keeps its trailing separator, so joining the two
// back together is a concatenation.
constexpr const char* kSpineFields[] = {"directory", "filename", "subsong"};
constexpr size_t kSpineFieldCount = std::size(kSpineFields);

// Jean writes its expressions so that a field the player cannot resolve formats to this,
// which is how it tells an unresolved field from an empty one.
constexpr char kUnresolved[] = "?";

constexpr size_t kMaxColumns = 64;
constexpr size_t kMaxColumnLength = 1024;

// Room for a song's unsynced lyrics, which Jean reads as a column.
constexpr size_t kMaxColumnValueBytes = size_t{64} * 1024;

// The longest prefix of `formatted` within kMaxColumnValueBytes that ends between two UTF-8
// characters.
std::string cappedColumnValue(std::string_view formatted);

constexpr size_t kRevisionsPerListeningHour = 40;
constexpr size_t kRetainedListeningHours = 48;

// How far behind a client may fall and still be sent a delta. Below it the answer is 410 and
// the client exports again.
constexpr size_t kRetainedRevisions = kRevisionsPerListeningHour * kRetainedListeningHours;

constexpr size_t kHeldParts = 2;

// SplitMix64's finaliser: a bijection that mixes every input bit into every output bit.
uint64_t splitMixFinalised(uint64_t z);

enum class IdWidth : uint8_t { one = 1, two = 2, four = 4 };

// The narrowest of the three holding every id from 0 to distinctValues - 1.
IdWidth widthFor(size_t distinctValues);

// Distinct values in the order they were first seen, and the id each was given.
struct Dictionary {
    std::vector<std::string> values;

    uint32_t intern(std::string_view value);
    std::optional<uint32_t> find(std::string_view value) const;

    std::vector<uint32_t> sortBytewise();

private:
    std::optional<uint32_t> locate(std::string_view value, uint32_t hash) const;
    void place(uint32_t index);

    std::vector<uint32_t> slots_;
    std::vector<uint32_t> hashes_;
};

// A dictionary and one id per row. Nothing here parses, types or normalises: `?`, `''` and
// `N/A` reach the client exactly as the player produced them, because Jean's capability
// detection turns on telling them apart.
struct Column {
    std::string name;
    Dictionary dictionary;
    std::vector<uint32_t> ids;

    uint64_t changeCount = 0;
};

struct Snapshot {
    uint64_t structure = 0;
    uint64_t revision = 0;

    uint64_t snapshotId = 0;

    // kSpineFields first, in order, then the columns the request asked for.
    std::vector<Column> columns;

    size_t trackCount() const;
};

struct ExportPart {
    std::vector<std::string> only;
    bool spine = true;
};

struct Carrying {
    std::vector<bool> columns;
    bool spine = true;

    bool whole() const;

    std::string key() const;
};

Carrying carryingOf(const std::vector<std::string>& declared, const ExportPart& part);

std::string serialiseSnapshot(const Snapshot& snapshot);

std::string snapshotIdText(uint64_t snapshotId);

size_t serialisedBytes(const Snapshot& snapshot);

std::optional<std::string> serialiseSnapshotWithin(const Snapshot& snapshot,
                                                   const Carrying& carrying, size_t maxBytes);

struct RelativePathParts {
    std::string directory;
    std::string filename;
};

RelativePathParts splitRelativePath(const std::string& path);

// What is left of a track's place in the order once the player has compared the paths:
// `subsong` and `canonicalPath` break the tie two subsongs of one file and two library roots
// sharing a relative path would otherwise leave open. An order that is not total shuffles
// between rebuilds, and a client's refs are ordinals.
struct TrackOrder {
    uint32_t subsong = 0;
    std::string canonicalPath;
};

// Compares the library-relative paths of the tracks at two indices into `ordinalOrder`'s list.
using PathComparison = std::function<int(size_t left, size_t right)>;

// The permutation putting tracks in ordinal order: entry i is the index of the track that
// takes ordinal i.
std::vector<size_t> ordinalOrder(const std::vector<TrackOrder>& tracks,
                                 const PathComparison& comparePaths);

// Ingests rows from many threads at once. fb2k/ drives it from metadb_v2::queryMultiParallel,
// which calls back with (index, record) from a thread pool, in arbitrary order, against a row
// count known up front.
class LibraryBuilder {
public:
    LibraryBuilder(std::vector<std::string> columns, size_t rowCount);

    // One per worker thread, never shared by two, and every index written exactly once.
    // Interns into dictionaries of its own so that no two threads contend, and finish()
    // merges them.
    class Sink {
    public:
        void row(size_t index, const std::vector<std::string>& values);

        Sink(const Sink&) = delete;
        Sink& operator=(const Sink&) = delete;

    private:
        friend class LibraryBuilder;
        explicit Sink(LibraryBuilder& owner);

        LibraryBuilder& owner_;
        std::vector<Dictionary> dictionaries_;
        std::vector<size_t> rows_;
    };

    Sink& sink();

    // kSpineFields and the asked-for columns, in the order a row's values must arrive in.
    std::vector<std::string> fields() const;

    // Once, after every sink has finished.
    Snapshot finish();

    LibraryBuilder(const LibraryBuilder&) = delete;
    LibraryBuilder& operator=(const LibraryBuilder&) = delete;

private:
    std::vector<Column> columns_;
    const size_t rowCount_;

    std::mutex mutex_;
    std::vector<std::unique_ptr<Sink>> sinks_;
};

// One column's share of a delta. Jean keys its search text and its album, artist and genre
// indices on the identity of a column's array, so a delta that named changed rows rather than
// changed columns would rebuild all of them once per track played.
struct ColumnDelta {
    // The column's position in Snapshot::columns.
    size_t index = 0;

    std::string name;

    // Ascending, and one id each.
    std::vector<uint32_t> ordinals;
    std::vector<uint32_t> ids;

    // Dictionaries are append-only within a structure generation, so a delta carries only
    // what was added and `base` is the length the client already holds.
    uint32_t base = 0;
    std::vector<std::string> appended;

    bool hasUnresolved = false;
    bool allUnresolved = false;
};

struct Delta {
    uint64_t structure = 0;
    uint64_t revision = 0;
    uint64_t snapshotId = 0;
    uint64_t since = 0;
    size_t trackCount = 0;

    bool splice = false;
    uint64_t sinceStructure = 0;

    std::vector<uint32_t> removed;
    std::vector<uint32_t> inserted;

    // Only the columns that moved.
    std::vector<ColumnDelta> columns;
};

std::string serialiseDelta(const Delta& delta);

std::optional<std::string> serialiseDeltaWithin(const Delta& delta, size_t maxBytes);

enum class DeltaOutcome {
    ok,
    notBuilt,
    structureChanged,
    revisionTooOld,
    revisionUnknown,

    pairNotHeld,

    spliceTooLarge,

    dictionariesCompacted,

    rearranged,
};

// One re-queried row, values in the order LibraryBuilder::fields() gives.
struct RowChange {
    uint32_t ordinal = 0;
    std::vector<std::string> values;
};

enum class BuildPhase : uint8_t { listing, ordering, formatting };

struct BuildProgress {
    BuildPhase phase = BuildPhase::listing;
    size_t formatted = 0;
    size_t total = 0;
};

// The snapshot a client polls, and the revisions it may still be caught up from. `structure`
// moves when tracks are added or removed, so ordinals shift and a client re-exports;
// `revision` moves when rows change in place, so ordinals hold and a client patches.
class Library {
public:
    explicit Library(size_t retainedRevisions = kRetainedRevisions);

    Library(size_t retainedRevisions, size_t maxBytes);

    size_t maxBytes() const { return maxBytes_; }

    // One thread, the snapshot worker, is the only caller of this and of apply(), so what
    // structureAfter() announced is what this lands on and no row change lands between the two.
    void replace(Snapshot snapshot);

    uint64_t structureAfter(const Snapshot& next) const;

    // The revision after the change, which does not move when no id did.
    uint64_t apply(const std::vector<RowChange>& changes);

    // Called by the worker as a build moves through its phases. `replace` clears what this
    // sets; `endBuild` is for a build that never reaches `replace`.
    void reportBuild(BuildProgress progress);
    void endBuild();

    void reportHalted();

    struct State {
        bool ready = false;
        uint64_t structure = 0;
        uint64_t revision = 0;
        uint64_t snapshotId = 0;
        size_t trackCount = 0;
        std::vector<std::string> columns;
        std::optional<BuildProgress> build;
        bool halted = false;
    };

    State state() const;

    // Runs `read` over the snapshot as it stands, with no row change or rebuild landing until it
    // returns. Every const method here shares the lock with it, so a long `read` delays `apply`
    // and `replace` and no other reader.
    template <typename Read>
    decltype(auto) read(Read&& read) const {
        const std::shared_lock<std::shared_mutex> lock(mutex_);
        return std::forward<Read>(read)(std::as_const(*snapshot_));
    }

    // The serialised snapshot, and the generations it was serialised at.
    struct Export {
        uint64_t structure = 0;
        uint64_t revision = 0;
        SharedBytes bytes;
    };

    // Serialised once per revision and handed to every caller after that. The serialising
    // happens outside the lock state() takes, so a poll never waits on an export.
    Export exported(const ExportPart& part = {}) const;

    struct Changes {
        DeltaOutcome outcome = DeltaOutcome::ok;
        Delta delta;
    };

    Changes changes(uint64_t structure, uint64_t since) const;

    Library(const Library&) = delete;
    Library& operator=(const Library&) = delete;

private:
    struct Generation {
        uint64_t structure = 0;
        uint64_t began = 0;
    };

    static bool sameShape(const Snapshot& current, const Snapshot& next);
    static std::vector<RowChange> rowChangesBetween(const Snapshot& current, const Snapshot& next);
    std::shared_ptr<const Snapshot> current() const;

    struct SpliceInput {
        std::shared_ptr<const Snapshot> snapshot;

        std::vector<std::shared_ptr<const Retained>> unseen;
    };

    bool heldTogether(uint64_t structure, uint64_t since) const;
    bool retainsFrom(uint64_t since) const;
    std::optional<Changes> answerWithoutSplice(uint64_t structure, uint64_t since) const;
    std::optional<SpliceInput> spliceInputFrom(uint64_t since) const;
    Changes deltaSince(uint64_t since) const;
    Changes spliceSince(const SpliceInput& input, uint64_t structure, uint64_t since) const;
    size_t exportBytes(const Snapshot& snapshot) const;
    static ColumnDelta columnDeltaOf(const Snapshot& snapshot, size_t field,
                                     std::vector<uint32_t> ordinals, uint32_t base);

    const size_t retainedRevisions_;
    const size_t maxBytes_;

    mutable std::shared_mutex mutex_;
    std::shared_ptr<Snapshot> snapshot_ = std::make_shared<Snapshot>();
    std::deque<Generation> generations_;

    uint64_t historyFrom_ = 0;
    DeltaOutcome historyEndedBy_ = DeltaOutcome::rearranged;

    std::deque<std::shared_ptr<const Retained>> retained_;

    // Held apart from an optional: ThreadSanitizer under Apple clang at -O0 does not flag an
    // unlocked access through std::optional's assignment, which would hide a race here.
    bool building_ = false;
    BuildProgress build_;
    bool halted_ = false;

    struct HeldPart {
        std::string key;
        Export held;
    };

    mutable std::mutex exportLock_;
    mutable Export lastExport_;

    struct MeasuredExport {
        uint64_t structure = 0;
        uint64_t revision = 0;
        size_t bytes = 0;
    };
    mutable MeasuredExport measured_;
    mutable std::deque<HeldPart> heldParts_;
};

enum class LibraryRefusal {
    none,
    tooManyColumns,
    badColumn,
    duplicateColumn,
    badSince,
    columnNotDeclared,
    badSpine,
    badRole,
    duplicateRole,
    unacceptableQuestion,
    duplicateQuestion,
};

struct LibraryRequest {
    LibraryRefusal refusal = LibraryRefusal::none;
    std::string detail;

    std::vector<std::string> columns;
    uint64_t since = 0;

    bool ok() const { return refusal == LibraryRefusal::none; }
};

struct ExportPartRequest {
    LibraryRefusal refusal = LibraryRefusal::none;
    std::string detail;
    ExportPart part;

    bool ok() const { return refusal == LibraryRefusal::none; }
};

ExportPartRequest parseExportPart(const std::vector<std::string>& declared,
                                  const std::vector<std::string>& only,
                                  const std::optional<std::string>& spine);

// Never throws: the caller is an HTTP handler. `since` is empty for an export.
LibraryRequest parseLibraryRequest(const std::vector<std::string>& columns,
                                   const std::string& since);

enum class RebuildReason { columnsDeclared, dataChanged };

class RebuildQueue {
public:
    void ask(std::vector<std::string> columns, RebuildReason why);

    void dataMoved();

    uint64_t dataMoves() const;

    bool wanted() const;

    bool wantedForDataAlone() const;

    bool startIfWanted();

    void finished();

    // The worker failed. The build it was running is wanted again, of the set declared since if
    // there is one; with no build running, a rebuild stands in for the row changes it lost.
    void failed();

    const std::vector<std::string>& columns() const;

private:
    bool building(const std::vector<std::string>& columns) const;

    bool forColumns_ = false;
    bool forData_ = false;
    uint64_t dataMoves_ = 0;
    std::optional<std::vector<std::string>> asked_;
    std::optional<std::vector<std::string>> building_;
    std::vector<std::string> columns_;
};

}  // namespace jean
