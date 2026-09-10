#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <iterator>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
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

constexpr size_t kRevisionsPerListeningHour = 40;
constexpr size_t kRetainedListeningHours = 48;

// How far behind a client may fall and still be sent a delta. Below it the answer is 410 and
// the client exports again.
constexpr size_t kRetainedRevisions = kRevisionsPerListeningHour * kRetainedListeningHours;

enum class IdWidth : uint8_t { one = 1, two = 2, four = 4 };

// The narrowest of the three holding every id from 0 to distinctValues - 1.
IdWidth widthFor(size_t distinctValues);

// Distinct values in the order they were first seen, and the id each was given.
struct Dictionary {
    std::vector<std::string> values;
    std::unordered_map<std::string, uint32_t> ids;

    uint32_t intern(std::string value);
};

// A dictionary and one id per row. Nothing here parses, types or normalises: `?`, `''` and
// `N/A` reach the client exactly as the player produced them, because Jean's capability
// detection turns on telling them apart.
struct Column {
    std::string name;
    Dictionary dictionary;
    std::vector<uint32_t> ids;
};

// What the client would otherwise learn by sampling rows and guessing.
struct ColumnFacts {
    size_t distinct = 0;
    bool hasUnresolved = false;
    bool allUnresolved = false;
};

ColumnFacts factsOf(const Column& column);

struct Snapshot {
    uint64_t structure = 0;
    uint64_t revision = 0;

    // kSpineFields first, in order, then the columns the request asked for.
    std::vector<Column> columns;

    size_t trackCount() const;
};

std::string serialiseSnapshot(const Snapshot& snapshot);

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
    size_t fieldCount() const;

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
    uint64_t since = 0;
    size_t trackCount = 0;

    // Only the columns that moved.
    std::vector<ColumnDelta> columns;
};

std::string serialiseDelta(const Delta& delta);

enum class DeltaOutcome {
    ok,
    notBuilt,
    structureChanged,
    revisionTooOld,
    revisionUnknown,
};

std::string describe(DeltaOutcome outcome);

// One re-queried row, values in the order LibraryBuilder::fields() gives.
struct RowChange {
    uint32_t ordinal = 0;
    std::vector<std::string> values;
};

// The snapshot a client polls, and the revisions it may still be caught up from. `structure`
// moves when tracks are added or removed, so ordinals shift and a client re-exports;
// `revision` moves when rows change in place, so ordinals hold and a client patches.
class Library {
public:
    explicit Library(size_t retainedRevisions = kRetainedRevisions);

    void replace(Snapshot snapshot);

    // The revision after the change, which does not move when no id did.
    uint64_t apply(const std::vector<RowChange>& changes);

    struct State {
        bool ready = false;
        uint64_t structure = 0;
        uint64_t revision = 0;
        size_t trackCount = 0;
        std::vector<std::string> columns;
    };

    State state() const;

    std::string exported() const;

    struct Changes {
        DeltaOutcome outcome = DeltaOutcome::ok;
        Delta delta;
    };

    Changes changes(uint64_t since) const;

    Library(const Library&) = delete;
    Library& operator=(const Library&) = delete;

private:
    struct Retained {
        uint64_t revision = 0;

        // Per column, the ordinals it changed.
        std::vector<std::vector<uint32_t>> ordinals;

        // Per column, the dictionary length a client holding the previous revision has.
        std::vector<uint32_t> dictionarySizes;
    };

    const size_t retainedRevisions_;

    mutable std::mutex mutex_;
    Snapshot snapshot_;
    uint64_t structureBegan_ = 0;
    std::deque<Retained> retained_;
};

enum class LibraryRefusal {
    none,
    tooManyColumns,
    badColumn,
    duplicateColumn,
    badSince,
};

struct LibraryRequest {
    LibraryRefusal refusal = LibraryRefusal::none;
    std::string detail;

    std::vector<std::string> columns;
    uint64_t since = 0;

    bool ok() const { return refusal == LibraryRefusal::none; }
};

// Never throws: the caller is an HTTP handler. `since` is empty for an export.
LibraryRequest parseLibraryRequest(const std::vector<std::string>& columns,
                                   const std::string& since);

std::string describe(LibraryRefusal refusal);

}  // namespace jean
