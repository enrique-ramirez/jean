#include "core/library.h"

#include "core/http_server.h"
#include "core/text.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <iterator>
#include <limits>
#include <numeric>
#include <random>
#include <set>
#include <shared_mutex>

using nlohmann::json;

namespace jean {

namespace {

// `new Int32Array(buffer, offset, n)` in a browser throws unless the byte offset is a
// multiple of four, and a client's offsets are absolute, so the header is padded to keep the
// blob's own start aligned as well as every section inside it.
constexpr size_t kAlignment = 4;

constexpr size_t kFirstSlots = 16;

uint32_t hashOf(std::string_view value) {
    return static_cast<uint32_t>(std::hash<std::string_view>{}(value));
}

constexpr char kMagic[] = "JLIB";
constexpr size_t kMagicBytes = sizeof(kMagic) - 1;
constexpr size_t kHeaderLengthBytes = 4;

struct ColumnFacts {
    size_t distinct = 0;
    bool hasUnresolved = false;
    bool allUnresolved = false;
};

ColumnFacts factsOf(const Column& column) {
    ColumnFacts facts;
    facts.distinct = column.dictionary.values.size();
    facts.hasUnresolved = column.dictionary.find(kUnresolved).has_value();
    facts.allUnresolved = facts.distinct == 1 && facts.hasUnresolved;
    return facts;
}

size_t paddingTo(size_t alignment, size_t size) {
    return (alignment - (size % alignment)) % alignment;
}

void appendLittleEndian(std::string& out, uint64_t value, size_t bytes) {
    for (size_t byte = 0; byte < bytes; ++byte)
        out.push_back(static_cast<char>((value >> (8 * byte)) & 0xFFU));
}

class Blob {
public:
    Blob() = default;
    explicit Blob(std::string& out) : out_(&out) {}

    size_t size() const { return size_; }

    void align() { pad(paddingTo(kAlignment, size_)); }

    void appendIds(const std::vector<uint32_t>& ids, IdWidth width) {
        const auto bytes = static_cast<size_t>(width);
        if (out_ != nullptr)
            for (const uint32_t id : ids)
                appendLittleEndian(*out_, id, bytes);
        size_ += ids.size() * bytes;
    }

    void appendText(const std::vector<std::string>& values, size_t length) {
        if (out_ != nullptr)
            for (const std::string& value : values)
                out_->append(value);
        size_ += length;
    }

    void appendEnds(const std::vector<std::string>& values, IdWidth width) {
        const auto bytes = static_cast<size_t>(width);
        if (out_ != nullptr) {
            size_t end = 0;
            for (const std::string& value : values) {
                end += value.size();
                appendLittleEndian(*out_, end, bytes);
            }
        }
        size_ += values.size() * bytes;
    }

private:
    void pad(size_t count) {
        if (out_ != nullptr)
            out_->append(count, '\0');
        size_ += count;
    }

    std::string* out_ = nullptr;
    size_t size_ = 0;
};

json placeIds(Blob& blob, const std::vector<uint32_t>& ids, IdWidth width) {
    blob.align();

    const json placed{
        {"offset", blob.size()}, {"count", ids.size()}, {"width", static_cast<int>(width)}};

    blob.appendIds(ids, width);
    return placed;
}

json placeDictionary(Blob& blob, const std::vector<std::string>& values) {
    const size_t length =
        std::accumulate(values.begin(), values.end(), size_t{0},
                        [](size_t total, const std::string& v) { return total + v.size(); });

    blob.align();
    const json text{{"offset", blob.size()}, {"length", length}};
    blob.appendText(values, length);

    const IdWidth width = widthFor(length + 1);
    blob.align();
    const json ends{
        {"offset", blob.size()}, {"count", values.size()}, {"width", static_cast<int>(width)}};
    blob.appendEnds(values, width);

    return json{{"text", text}, {"ends", ends}};
}

json placeColumn(Blob& blob, const std::vector<uint32_t>& ids, size_t distinct,
                 const std::vector<std::string>& values, const ColumnFacts& facts) {
    return json{{"ids", placeIds(blob, ids, widthFor(distinct))},
                {"dict", placeDictionary(blob, values)},
                {"distinct", facts.distinct},
                {"hasUnresolved", facts.hasUnresolved},
                {"allUnresolved", facts.allUnresolved}};
}

struct Framing {
    std::string prefix;
    size_t blobBytes = 0;

    size_t total() const { return prefix.size() + blobBytes; }
};

Framing frameOf(const json& header, size_t blobBytes) {
    // nlohmann's dump() throws on text that is not valid UTF-8, and a column expression comes
    // from a client, so the replacement handler keeps a malformed one from becoming a 500.
    std::string text = header.dump(-1, ' ', false, json::error_handler_t::replace);
    text.append(paddingTo(kAlignment, kMagicBytes + kHeaderLengthBytes + text.size()), ' ');

    Framing framing;
    framing.blobBytes = blobBytes;
    framing.prefix.reserve(kMagicBytes + kHeaderLengthBytes + text.size());
    framing.prefix.append(kMagic, kMagicBytes);
    appendLittleEndian(framing.prefix, text.size(), kHeaderLengthBytes);
    framing.prefix.append(text);
    return framing;
}

template <typename Describe>
Framing measured(const Describe& describe) {
    Blob blob;
    const json header = describe(blob);
    return frameOf(header, blob.size());
}

template <typename Describe>
std::optional<std::string> writtenWithin(const Describe& describe, size_t maxBytes) {
    const Framing framing = measured(describe);
    if (framing.total() > maxBytes)
        return std::nullopt;

    std::string out;
    out.reserve(framing.total());
    out.append(framing.prefix);

    Blob blob(out);
    describe(blob);
    return out;
}

void ensureEveryIdResolves(Column& column) {
    if (!column.ids.empty() && column.dictionary.values.empty())
        column.dictionary.intern("");
}

std::vector<std::string> namesOf(std::vector<std::string> columns) {
    std::vector<std::string> fields(std::begin(kSpineFields), std::end(kSpineFields));
    fields.insert(fields.end(), std::make_move_iterator(columns.begin()),
                  std::make_move_iterator(columns.end()));
    return fields;
}

LibraryRequest refuse(LibraryRefusal refusal, std::string detail) {
    LibraryRequest request;
    request.refusal = refusal;
    request.detail = std::move(detail);
    return request;
}

}  // namespace

IdWidth widthFor(size_t distinctValues) {
    if (distinctValues <= 0x100)
        return IdWidth::one;
    if (distinctValues <= 0x10000)
        return IdWidth::two;
    return IdWidth::four;
}

std::optional<uint32_t> Dictionary::find(std::string_view value) const {
    return locate(value, hashOf(value));
}

std::optional<uint32_t> Dictionary::locate(std::string_view value, uint32_t hash) const {
    if (slots_.empty())
        return std::nullopt;

    const size_t mask = slots_.size() - 1;
    for (size_t at = hash & mask; slots_[at] != 0; at = (at + 1) & mask) {
        const uint32_t candidate = slots_[at] - 1;
        if (hashes_[candidate] == hash && values[candidate] == value)
            return candidate;
    }
    return std::nullopt;
}

void Dictionary::place(uint32_t index) {
    const size_t mask = slots_.size() - 1;
    size_t at = hashes_[index] & mask;
    while (slots_[at] != 0)
        at = (at + 1) & mask;
    slots_[at] = index + 1;
}

uint32_t Dictionary::intern(std::string_view value) {
    const uint32_t hash = hashOf(value);
    if (const auto found = locate(value, hash))
        return *found;

    const auto next = static_cast<uint32_t>(values.size());
    values.emplace_back(value);
    hashes_.push_back(hash);

    if (values.size() * 2 > slots_.size()) {
        slots_.assign(std::max(kFirstSlots, slots_.size() * 2), 0);
        for (uint32_t index = 0; index < values.size(); ++index)
            place(index);
    } else {
        place(next);
    }
    return next;
}

std::vector<uint32_t> Dictionary::sortBytewise() {
    std::vector<uint32_t> order(values.size());
    std::iota(order.begin(), order.end(), uint32_t{0});
    std::sort(order.begin(), order.end(),
              [this](uint32_t a, uint32_t b) { return values[a] < values[b]; });

    std::vector<uint32_t> remap(values.size());
    std::vector<std::string> sorted(values.size());
    std::vector<uint32_t> sortedHashes(values.size());
    for (uint32_t now = 0; now < order.size(); ++now) {
        remap[order[now]] = now;
        sorted[now] = std::move(values[order[now]]);
        sortedHashes[now] = hashes_[order[now]];
    }
    values = std::move(sorted);
    hashes_ = std::move(sortedHashes);

    std::fill(slots_.begin(), slots_.end(), 0U);
    for (uint32_t index = 0; index < values.size(); ++index)
        place(index);
    return remap;
}

size_t Snapshot::trackCount() const {
    return columns.empty() ? 0 : columns.front().ids.size();
}

RelativePathParts splitRelativePath(const std::string& path) {
    const size_t separator = path.rfind('/');
    if (separator == std::string::npos)
        return {{}, path};

    return {path.substr(0, separator + 1), path.substr(separator + 1)};
}

std::vector<size_t> ordinalOrder(const std::vector<TrackOrder>& tracks,
                                 const PathComparison& comparePaths) {
    std::vector<size_t> order(tracks.size());
    std::iota(order.begin(), order.end(), size_t{0});

    std::sort(order.begin(), order.end(), [&tracks, &comparePaths](size_t a, size_t b) {
        const int byPath = comparePaths(a, b);
        if (byPath != 0)
            return byPath < 0;
        if (tracks[a].subsong != tracks[b].subsong)
            return tracks[a].subsong < tracks[b].subsong;
        return tracks[a].canonicalPath < tracks[b].canonicalPath;
    });

    return order;
}

LibraryBuilder::LibraryBuilder(std::vector<std::string> columns, size_t rowCount)
    : rowCount_(rowCount) {
    for (std::string& name : namesOf(std::move(columns))) {
        Column column;
        column.name = std::move(name);
        column.ids.assign(rowCount, 0);
        columns_.push_back(std::move(column));
    }
}

LibraryBuilder::Sink::Sink(LibraryBuilder& owner)
    : owner_(owner), dictionaries_(owner.columns_.size()) {}

void LibraryBuilder::Sink::row(size_t index, const std::vector<std::string>& values) {
    if (index >= owner_.rowCount_ || values.size() != owner_.columns_.size())
        return;

    for (size_t field = 0; field < values.size(); ++field)
        owner_.columns_[field].ids[index] = dictionaries_[field].intern(values[field]);

    rows_.push_back(index);
}

LibraryBuilder::Sink& LibraryBuilder::sink() {
    const std::lock_guard<std::mutex> lock(mutex_);
    sinks_.push_back(std::unique_ptr<Sink>(new Sink(*this)));
    return *sinks_.back();
}

std::vector<std::string> LibraryBuilder::fields() const {
    std::vector<std::string> names(columns_.size());
    std::transform(columns_.begin(), columns_.end(), names.begin(),
                   [](const Column& column) { return column.name; });

    return names;
}

Snapshot LibraryBuilder::finish() {
    for (const std::unique_ptr<Sink>& sink : sinks_) {
        for (size_t field = 0; field < columns_.size(); ++field) {
            Dictionary& local = sink->dictionaries_[field];
            Column& column = columns_[field];

            std::vector<uint32_t> merged(local.values.size());
            std::transform(local.values.begin(), local.values.end(), merged.begin(),
                           [&column](std::string& value) {
                               return column.dictionary.intern(std::move(value));
                           });

            for (const size_t row : sink->rows_)
                column.ids[row] = merged[column.ids[row]];
        }
    }
    sinks_.clear();

    for (Column& column : columns_) {
        ensureEveryIdResolves(column);

        // std::string orders by unsigned byte (std::char_traits<char>::lt), which is UTF-8's code
        // point order and not UTF-16's.
        const std::vector<uint32_t> remap = column.dictionary.sortBytewise();
        for (uint32_t& id : column.ids)
            id = remap[id];
    }

    Snapshot snapshot;
    snapshot.columns = std::move(columns_);
    return snapshot;
}

namespace {

json describeUncarried(const ColumnFacts& facts) {
    return json{{"distinct", facts.distinct},
                {"hasUnresolved", facts.hasUnresolved},
                {"allUnresolved", facts.allUnresolved}};
}

json describeSnapshot(const Snapshot& snapshot, const Carrying& carrying, Blob& blob) {
    json columns = json::array();
    json spine = json::object();
    json carried = json::array();

    for (size_t field = 0; field < snapshot.columns.size(); ++field) {
        const Column& column = snapshot.columns[field];
        const ColumnFacts facts = factsOf(column);
        const bool isSpine = field < kSpineFieldCount;
        const bool holds = isSpine ? carrying.spine : carrying.columns[field - kSpineFieldCount];

        json placed =
            holds ? placeColumn(blob, column.ids, facts.distinct, column.dictionary.values, facts)
                  : describeUncarried(facts);

        if (isSpine) {
            spine[column.name] = std::move(placed);
        } else {
            placed["name"] = column.name;
            columns.push_back(std::move(placed));
            if (holds)
                carried.push_back(column.name);
        }
    }

    return json{{"kind", "snapshot"},
                {"structure", snapshot.structure},
                {"revision", snapshot.revision},
                {"snapshotId", snapshotIdText(snapshot.snapshotId)},
                {"trackCount", snapshot.trackCount()},
                {"carried", std::move(carried)},
                {"spineCarried", carrying.spine},
                {"columns", std::move(columns)},
                {"spine", std::move(spine)}};
}

json describeDelta(const Delta& delta, Blob& blob) {
    json columns = json::array();
    json spine = json::object();

    json removed;
    json inserted;
    if (delta.splice) {
        const size_t rowsBefore = delta.trackCount - delta.inserted.size() + delta.removed.size();
        removed = placeIds(blob, delta.removed, widthFor(rowsBefore));
        inserted = placeIds(blob, delta.inserted, widthFor(delta.trackCount));
    }

    for (const ColumnDelta& patch : delta.columns) {
        const ColumnFacts facts{patch.base + patch.appended.size(), patch.hasUnresolved,
                                patch.allUnresolved};

        json placed = placeColumn(blob, patch.ids, facts.distinct, patch.appended, facts);
        placed["ordinals"] = placeIds(blob, patch.ordinals, widthFor(delta.trackCount));
        placed["dict"]["base"] = patch.base;

        if (patch.index < kSpineFieldCount) {
            spine[patch.name] = std::move(placed);
        } else {
            placed["name"] = patch.name;
            columns.push_back(std::move(placed));
        }
    }

    json header{{"kind", delta.splice ? "splice" : "delta"},
                {"structure", delta.structure},
                {"revision", delta.revision},
                {"snapshotId", snapshotIdText(delta.snapshotId)},
                {"since", delta.since},
                {"trackCount", delta.trackCount},
                {"columns", std::move(columns)},
                {"spine", std::move(spine)}};

    if (delta.splice) {
        header["sinceStructure"] = delta.sinceStructure;
        header["removed"] = std::move(removed);
        header["inserted"] = std::move(inserted);
    }
    return header;
}

std::vector<std::string> declaredIn(const Snapshot& snapshot) {
    std::vector<std::string> declared;
    for (size_t field = kSpineFieldCount; field < snapshot.columns.size(); ++field)
        declared.push_back(snapshot.columns[field].name);
    return declared;
}

}  // namespace

bool Carrying::whole() const {
    return spine && std::all_of(columns.begin(), columns.end(), [](bool held) { return held; });
}

std::string Carrying::key() const {
    if (whole())
        return {};

    std::string key = "c";
    for (size_t index = 0; index < columns.size(); ++index)
        if (columns[index])
            key += std::to_string(index) + '.';

    return spine ? key : key + 'n';
}

Carrying carryingOf(const std::vector<std::string>& declared, const ExportPart& part) {
    Carrying carrying;
    carrying.spine = part.spine;
    carrying.columns.resize(declared.size());
    std::transform(declared.begin(), declared.end(), carrying.columns.begin(),
                   [&part](const std::string& name) {
                       return part.only.empty() || std::find(part.only.begin(), part.only.end(),
                                                             name) != part.only.end();
                   });
    return carrying;
}

std::optional<std::string> serialiseSnapshotWithin(const Snapshot& snapshot,
                                                   const Carrying& carrying, size_t maxBytes) {
    return writtenWithin(
        [&snapshot, &carrying](Blob& blob) { return describeSnapshot(snapshot, carrying, blob); },
        maxBytes);
}

std::optional<std::string> serialiseDeltaWithin(const Delta& delta, size_t maxBytes) {
    return writtenWithin([&delta](Blob& blob) { return describeDelta(delta, blob); }, maxBytes);
}

std::string snapshotIdText(uint64_t snapshotId) {
    constexpr size_t kDigits = 16;
    constexpr char kHex[] = "0123456789abcdef";

    std::string text(kDigits, '0');
    for (size_t digit = kDigits; digit > 0; --digit, snapshotId >>= 4U)
        text[digit - 1] = kHex[snapshotId & 0xFU];
    return text;
}

std::string serialiseSnapshot(const Snapshot& snapshot) {
    const Carrying everything = carryingOf(declaredIn(snapshot), ExportPart{});
    return serialiseSnapshotWithin(snapshot, everything, std::numeric_limits<size_t>::max())
        .value_or(std::string());
}

std::string serialiseDelta(const Delta& delta) {
    return serialiseDeltaWithin(delta, std::numeric_limits<size_t>::max()).value_or(std::string());
}

size_t serialisedBytes(const Snapshot& snapshot) {
    const Carrying everything = carryingOf(declaredIn(snapshot), ExportPart{});
    return measured([&snapshot, &everything](Blob& blob) {
               return describeSnapshot(snapshot, everything, blob);
           })
        .total();
}

uint64_t splitMixFinalised(uint64_t z) {
    z = (z ^ (z >> 30U)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27U)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31U);
}

namespace {

size_t serialisedBytes(const Delta& delta) {
    return measured([&delta](Blob& blob) { return describeDelta(delta, blob); }).total();
}

// Below 2^53, so every structure this run reaches is exact as a JSON number in a JavaScript client.
uint64_t firstStructureOfThisProcess() {
    constexpr uint64_t kSmallest = 1'000'000'000'000'000;
    constexpr uint64_t kSpan = 8'000'000'000'000'000;

    static const uint64_t seed = [] {
        std::random_device entropy;
        const uint64_t high = entropy();
        const uint64_t low = entropy();
        return kSmallest + (((high << 32U) | low) % kSpan);
    }();
    return seed;
}

uint64_t structureFollowing(const Snapshot& now) {
    return now.structure == 0 ? firstStructureOfThisProcess() : now.structure + 1;
}

constexpr uint64_t kFnvBasis = 0xcbf29ce484222325ULL;
constexpr uint64_t kFnvPrime = 0x100000001b3ULL;

constexpr unsigned char kDeclaredPrefix = 0x01;
constexpr unsigned char kSpinePrefix = 0x02;
constexpr unsigned char kCountPrefix = 0x03;
constexpr unsigned char kUnresolvedByte = 0xFF;

uint64_t fnvByte(uint64_t hash, unsigned char byte) {
    return (hash ^ byte) * kFnvPrime;
}

uint64_t fnvText(uint64_t hash, std::string_view text) {
    for (const char byte : text)
        hash = fnvByte(hash, static_cast<unsigned char>(byte));
    return hash;
}

uint64_t fnvDecimal(uint64_t hash, uint64_t number) {
    return fnvText(hash, std::to_string(number));
}

uint64_t columnSeed(size_t field, const std::string& name) {
    const uint64_t prefixed =
        fnvByte(kFnvBasis, field < kSpineFieldCount ? kSpinePrefix : kDeclaredPrefix);
    return fnvByte(fnvText(prefixed, name), 0);
}

// FNV-1a's terms are too regular to add: two cells whose last byte changes in the same bit would
// cancel, so each term goes through SplitMix64's finaliser first.
uint64_t cellTerm(uint64_t seed, size_t ordinal, std::string_view value) {
    const uint64_t placed = fnvByte(fnvDecimal(seed, ordinal), 0);
    return splitMixFinalised(value == kUnresolved ? fnvByte(placed, kUnresolvedByte)
                                                  : fnvText(placed, value));
}

uint64_t countTerm(size_t trackCount) {
    return splitMixFinalised(fnvDecimal(fnvByte(kFnvBasis, kCountPrefix), trackCount));
}

uint64_t foldSnapshot(const Snapshot& snapshot) {
    uint64_t sum = countTerm(snapshot.trackCount());
    for (size_t field = 0; field < snapshot.columns.size(); ++field) {
        const Column& column = snapshot.columns[field];
        const uint64_t seed = columnSeed(field, column.name);
        for (size_t row = 0; row < column.ids.size(); ++row)
            sum += cellTerm(seed, row, column.dictionary.values[column.ids[row]]);
    }
    return sum;
}

}  // namespace

Library::Library(size_t retainedRevisions) : Library(retainedRevisions, kMaxLibraryBytes) {}

Library::Library(size_t retainedRevisions, size_t maxBytes)
    : retainedRevisions_(retainedRevisions), maxBytes_(maxBytes) {}

bool Library::sameShape(const Snapshot& current, const Snapshot& next) {
    if (current.structure == 0 || !sameColumns(current, next) ||
        current.trackCount() != next.trackCount())
        return false;

    const size_t count = current.trackCount();
    for (size_t ordinal = 0; ordinal < count; ++ordinal)
        if (!sameTrack(current, ordinal, next, ordinal))
            return false;

    return true;
}

std::vector<RowChange> Library::rowChangesBetween(const Snapshot& current, const Snapshot& next) {
    std::vector<RowChange> changes;
    const size_t count = next.trackCount();

    for (size_t ordinal = 0; ordinal < count; ++ordinal) {
        bool moved = false;
        for (size_t field = 0; field < next.columns.size() && !moved; ++field) {
            const Column& was = current.columns[field];
            const Column& is = next.columns[field];
            moved =
                was.dictionary.values[was.ids[ordinal]] != is.dictionary.values[is.ids[ordinal]];
        }
        if (!moved)
            continue;

        RowChange change;
        change.ordinal = static_cast<uint32_t>(ordinal);
        std::transform(next.columns.begin(), next.columns.end(), std::back_inserter(change.values),
                       [ordinal](const Column& column) {
                           return column.dictionary.values[column.ids[ordinal]];
                       });
        changes.push_back(std::move(change));
    }

    return changes;
}

std::shared_ptr<const Snapshot> Library::current() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    return snapshot_;
}

uint64_t Library::structureAfter(const Snapshot& next) const {
    const auto now = current();
    return sameShape(*now, next) ? now->structure : structureFollowing(*now);
}

void Library::replace(Snapshot snapshot) {
    const auto now = current();
    if (sameShape(*now, snapshot)) {
        apply(rowChangesBetween(*now, snapshot));
        return;
    }

    snapshot.structure = structureFollowing(*now);
    snapshot.revision = now->revision + 1;

    Merged merged = mergeOnto(*now, snapshot, maxBytes_);
    std::shared_ptr<Snapshot> landed = merged.snapshot
                                           ? std::move(merged.snapshot)
                                           : std::make_shared<Snapshot>(std::move(snapshot));
    landed->snapshotId = foldSnapshot(*landed);

    const std::lock_guard<std::mutex> exporting(exportLock_);
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    lastExport_ = Export{};
    heldParts_.clear();

    generations_.push_back({landed->structure, landed->revision});
    while (generations_.size() > retainedRevisions_ + 1)
        generations_.pop_front();

    if (merged.landing == Landing::spliced) {
        merged.step.revision = landed->revision;
        retained_.push_back(std::make_shared<const Retained>(std::move(merged.step)));
        while (retained_.size() > retainedRevisions_)
            retained_.pop_front();
    } else {
        historyFrom_ = landed->revision;
        historyEndedBy_ = merged.landing == Landing::compacted ? DeltaOutcome::dictionariesCompacted
                                                               : DeltaOutcome::rearranged;
        retained_.clear();
    }

    snapshot_ = std::move(landed);
    building_ = false;
}

uint64_t Library::apply(const std::vector<RowChange>& changes) {
    const std::lock_guard<std::mutex> exporting(exportLock_);
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    if (snapshot_->structure == 0)
        return 0;

    Snapshot& snapshot = *snapshot_;

    Retained entry;
    entry.ordinals.resize(snapshot.columns.size());
    entry.dictionarySizes.reserve(snapshot.columns.size());
    for (const Column& column : snapshot.columns)
        entry.dictionarySizes.push_back(static_cast<uint32_t>(column.dictionary.values.size()));

    const size_t trackCount = snapshot.trackCount();

    for (const RowChange& change : changes) {
        if (change.ordinal >= trackCount || change.values.size() != snapshot.columns.size())
            continue;

        for (size_t field = 0; field < snapshot.columns.size(); ++field) {
            Column& column = snapshot.columns[field];
            const uint32_t id = column.dictionary.intern(change.values[field]);
            if (id == column.ids[change.ordinal])
                continue;

            const uint64_t seed = columnSeed(field, column.name);
            snapshot.snapshotId -= cellTerm(seed, change.ordinal,
                                            column.dictionary.values[column.ids[change.ordinal]]);
            snapshot.snapshotId += cellTerm(seed, change.ordinal, change.values[field]);

            column.ids[change.ordinal] = id;
            entry.ordinals[field].push_back(change.ordinal);
        }
    }

    const bool moved =
        std::any_of(entry.ordinals.begin(), entry.ordinals.end(),
                    [](const std::vector<uint32_t>& ordinals) { return !ordinals.empty(); });
    if (!moved)
        return snapshot.revision;

    for (size_t field = 0; field < entry.ordinals.size(); ++field) {
        if (!entry.ordinals[field].empty())
            ++snapshot.columns[field].changeCount;
    }

    for (std::vector<uint32_t>& ordinals : entry.ordinals) {
        std::sort(ordinals.begin(), ordinals.end());
        ordinals.erase(std::unique(ordinals.begin(), ordinals.end()), ordinals.end());
    }

    lastExport_ = Export{};
    heldParts_.clear();

    entry.revision = ++snapshot.revision;
    retained_.push_back(std::make_shared<const Retained>(std::move(entry)));
    while (retained_.size() > retainedRevisions_)
        retained_.pop_front();

    return snapshot.revision;
}

void Library::reportBuild(BuildProgress progress) {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    building_ = true;
    build_ = progress;
}

void Library::endBuild() {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    building_ = false;
    build_ = BuildProgress{};
}

void Library::reportHalted() {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    halted_ = true;
    building_ = false;
    build_ = BuildProgress{};
}

Library::State Library::state() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);

    State state;
    state.ready = snapshot_->structure > 0;
    state.structure = snapshot_->structure;
    state.revision = snapshot_->revision;
    state.snapshotId = snapshot_->snapshotId;
    state.trackCount = snapshot_->trackCount();

    for (size_t field = kSpineFieldCount; field < snapshot_->columns.size(); ++field)
        state.columns.push_back(snapshot_->columns[field].name);

    if (building_)
        state.build = build_;

    state.halted = halted_;
    return state;
}

Library::Export Library::exported(const ExportPart& part) const {
    const std::lock_guard<std::mutex> exporting(exportLock_);

    std::shared_ptr<const Snapshot> reading;
    {
        const std::shared_lock<std::shared_mutex> lock(mutex_);
        reading = snapshot_;
    }

    if (lastExport_.structure != reading->structure || lastExport_.revision != reading->revision) {
        lastExport_ = Export{reading->structure, reading->revision, nullptr};
        heldParts_.clear();
    }

    const Carrying carrying = carryingOf(declaredIn(*reading), part);
    const std::string key = carrying.key();

    if (carrying.whole()) {
        if (!lastExport_.bytes)
            if (auto body = serialiseSnapshotWithin(*reading, carrying, maxBytes_))
                lastExport_.bytes = std::make_shared<const std::string>(std::move(*body));
        return lastExport_;
    }

    Export made{reading->structure, reading->revision, nullptr};
    const auto held = std::find_if(heldParts_.begin(), heldParts_.end(),
                                   [&key](const HeldPart& entry) { return entry.key == key; });
    if (held != heldParts_.end())
        return held->held;

    if (auto body = serialiseSnapshotWithin(*reading, carrying, maxBytes_)) {
        made.bytes = std::make_shared<const std::string>(std::move(*body));
        heldParts_.push_back({key, made});
        while (heldParts_.size() > kHeldParts)
            heldParts_.pop_front();
    }
    return made;
}

bool Library::heldTogether(uint64_t structure, uint64_t since) const {
    const auto after = std::upper_bound(
        generations_.begin(), generations_.end(), since,
        [](uint64_t revision, const Generation& began) { return revision < began.began; });

    return after != generations_.begin() && std::prev(after)->structure == structure;
}

bool Library::retainsFrom(uint64_t since) const {
    return since >= snapshot_->revision ||
           (!retained_.empty() && retained_.front()->revision <= since + 1);
}

ColumnDelta Library::columnDeltaOf(const Snapshot& snapshot, size_t field,
                                   std::vector<uint32_t> ordinals, uint32_t base) {
    const Column& column = snapshot.columns[field];
    const ColumnFacts facts = factsOf(column);

    ColumnDelta patch;
    patch.index = field;
    patch.name = column.name;
    patch.ordinals = std::move(ordinals);
    patch.base = base;
    patch.appended.assign(column.dictionary.values.begin() + base, column.dictionary.values.end());
    patch.hasUnresolved = facts.hasUnresolved;
    patch.allUnresolved = facts.allUnresolved;

    patch.ids.reserve(patch.ordinals.size());
    for (const uint32_t ordinal : patch.ordinals)
        patch.ids.push_back(column.ids[ordinal]);

    return patch;
}

std::optional<Library::Changes> Library::answerWithoutSplice(uint64_t structure,
                                                             uint64_t since) const {
    if (snapshot_->structure == 0)
        return Changes{DeltaOutcome::notBuilt, {}};
    if (structure > snapshot_->structure)
        return Changes{DeltaOutcome::pairNotHeld, {}};
    if (since > snapshot_->revision)
        return Changes{DeltaOutcome::revisionUnknown, {}};
    if (!heldTogether(structure, since))
        return Changes{DeltaOutcome::pairNotHeld, {}};
    if (structure == snapshot_->structure)
        return deltaSince(since);
    if (since < historyFrom_)
        return Changes{historyEndedBy_, {}};
    if (!retainsFrom(since))
        return Changes{DeltaOutcome::revisionTooOld, {}};

    return std::nullopt;
}

std::optional<Library::SpliceInput> Library::spliceInputFrom(uint64_t since) const {
    const auto firstUnseen = std::find_if(
        retained_.begin(), retained_.end(),
        [since](const std::shared_ptr<const Retained>& entry) { return entry->revision > since; });
    if (firstUnseen == retained_.end())
        return std::nullopt;

    return SpliceInput{snapshot_,
                       std::vector<std::shared_ptr<const Retained>>(firstUnseen, retained_.end())};
}

Library::Changes Library::changes(uint64_t structure, uint64_t since) const {
    {
        const std::shared_lock<std::shared_mutex> lock(mutex_);
        if (const auto answer = answerWithoutSplice(structure, since))
            return *answer;
    }

    const std::lock_guard<std::mutex> exporting(exportLock_);

    std::optional<SpliceInput> input;
    {
        const std::shared_lock<std::shared_mutex> lock(mutex_);
        if (const auto answer = answerWithoutSplice(structure, since))
            return *answer;
        input = spliceInputFrom(since);
    }

    if (!input)
        return {DeltaOutcome::pairNotHeld, {}};

    return spliceSince(*input, structure, since);
}

Library::Changes Library::deltaSince(uint64_t since) const {
    if (!retainsFrom(since))
        return {DeltaOutcome::revisionTooOld, {}};

    const auto firstUnseen = std::find_if(
        retained_.begin(), retained_.end(),
        [since](const std::shared_ptr<const Retained>& entry) { return entry->revision > since; });

    std::vector<std::set<uint32_t>> moved(snapshot_->columns.size());
    for (auto entry = firstUnseen; entry != retained_.end(); ++entry) {
        for (size_t field = 0; field < moved.size(); ++field)
            moved[field].insert((*entry)->ordinals[field].begin(), (*entry)->ordinals[field].end());
    }

    // Revisions are contiguous, so the dictionary lengths recorded before the first revision
    // the client has not seen are the lengths it holds.
    const std::vector<uint32_t> held =
        firstUnseen == retained_.end() ? std::vector<uint32_t>() : (*firstUnseen)->dictionarySizes;

    Delta delta;
    delta.structure = snapshot_->structure;
    delta.revision = snapshot_->revision;
    delta.snapshotId = snapshot_->snapshotId;
    delta.since = since;
    delta.trackCount = snapshot_->trackCount();

    for (size_t field = 0; field < snapshot_->columns.size(); ++field) {
        if (moved[field].empty())
            continue;

        delta.columns.push_back(columnDeltaOf(
            *snapshot_, field, std::vector<uint32_t>(moved[field].begin(), moved[field].end()),
            held[field]));
    }

    return {DeltaOutcome::ok, std::move(delta)};
}

size_t Library::exportBytes(const Snapshot& snapshot) const {
    if (measured_.structure != snapshot.structure || measured_.revision != snapshot.revision)
        measured_ = {snapshot.structure, snapshot.revision, serialisedBytes(snapshot)};
    return measured_.bytes;
}

Library::Changes Library::spliceSince(const SpliceInput& input, uint64_t structure,
                                      uint64_t since) const {
    const Snapshot& snapshot = *input.snapshot;
    size_t rowsHeld = snapshot.trackCount();
    for (const auto& entry : input.unseen)
        if (entry->splice)
            rowsHeld = rowsHeld + entry->splice->removed.size() - entry->splice->inserted.size();

    const size_t columnCount = snapshot.columns.size();
    std::vector<uint32_t> origin(rowsHeld);
    std::iota(origin.begin(), origin.end(), uint32_t{0});

    std::vector<std::vector<uint32_t>> moved(columnCount);
    for (const auto& entry : input.unseen) {
        if (entry->splice)
            origin = originAfter(origin, entry->splice->removed, entry->splice->inserted);

        for (size_t field = 0; field < columnCount; ++field)
            for (const uint32_t ordinal : entry->ordinals[field])
                if (origin[ordinal] != kNoRow)
                    moved[field].push_back(origin[ordinal]);
    }

    Delta delta;
    delta.splice = true;
    delta.sinceStructure = structure;
    delta.structure = snapshot.structure;
    delta.revision = snapshot.revision;
    delta.snapshotId = snapshot.snapshotId;
    delta.since = since;
    delta.trackCount = snapshot.trackCount();

    std::vector<uint32_t> placedAt(rowsHeld, kNoRow);
    uint32_t expected = 0;
    for (size_t row = 0; row < origin.size(); ++row) {
        if (origin[row] == kNoRow) {
            delta.inserted.push_back(static_cast<uint32_t>(row));
            continue;
        }

        for (; expected < origin[row]; ++expected)
            delta.removed.push_back(expected);
        expected = origin[row] + 1;
        placedAt[origin[row]] = static_cast<uint32_t>(row);
    }
    for (; expected < rowsHeld; ++expected)
        delta.removed.push_back(expected);

    for (size_t field = 0; field < columnCount; ++field) {
        std::vector<uint32_t> ordinals;
        for (const uint32_t held : moved[field])
            if (placedAt[held] != kNoRow)
                ordinals.push_back(placedAt[held]);

        ordinals.insert(ordinals.end(), delta.inserted.begin(), delta.inserted.end());
        std::sort(ordinals.begin(), ordinals.end());
        ordinals.erase(std::unique(ordinals.begin(), ordinals.end()), ordinals.end());

        const uint32_t base = input.unseen.front()->dictionarySizes[field];
        const bool grown = base < snapshot.columns[field].dictionary.values.size();
        if (ordinals.empty() && !grown)
            continue;

        delta.columns.push_back(columnDeltaOf(snapshot, field, std::move(ordinals), base));
    }

    if (2 * serialisedBytes(delta) >= exportBytes(snapshot))
        return {DeltaOutcome::spliceTooLarge, {}};

    return {DeltaOutcome::ok, std::move(delta)};
}

std::string cappedColumnValue(std::string_view formatted) {
    if (formatted.size() <= kMaxColumnValueBytes)
        return std::string(formatted);

    const auto continuesACharacter = [](char byte) {
        return (static_cast<unsigned char>(byte) & 0xc0U) == 0x80U;
    };

    size_t cut = kMaxColumnValueBytes;
    while (cut > 0 && continuesACharacter(formatted[cut]))
        --cut;

    return std::string(formatted.substr(0, cut));
}

LibraryRequest parseLibraryRequest(const std::vector<std::string>& columns,
                                   const std::string& since) {
    if (columns.size() > kMaxColumns) {
        return refuse(LibraryRefusal::tooManyColumns,
                      "at most " + std::to_string(kMaxColumns) + " columns, and " +
                          std::to_string(columns.size()) + " were asked for");
    }

    std::set<std::string> seen;
    for (size_t index = 0; index < columns.size(); ++index) {
        const std::string& column = columns[index];
        const std::string named = "column " + std::to_string(index);

        if (column.empty() || column.size() > kMaxColumnLength || !isPrintable(column)) {
            return refuse(LibraryRefusal::badColumn, named + " must be printable text of 1 to " +
                                                         std::to_string(kMaxColumnLength) +
                                                         " characters");
        }

        if (!seen.insert(column).second)
            return refuse(LibraryRefusal::duplicateColumn, named + " repeats an earlier one");
    }

    LibraryRequest request;
    request.columns = columns;

    if (!since.empty() && !readDecimal(since, request.since))
        return refuse(LibraryRefusal::badSince, "'since' must be a whole number");

    return request;
}

ExportPartRequest parseExportPart(const std::vector<std::string>& declared,
                                  const std::vector<std::string>& only,
                                  const std::optional<std::string>& spine) {
    ExportPartRequest request;
    const auto declined = [&request](LibraryRefusal refusal, std::string detail) {
        request.refusal = refusal;
        request.detail = std::move(detail);
        return request;
    };

    std::set<std::string> seen;
    for (size_t index = 0; index < only.size(); ++index) {
        const std::string named = "'only' column " + std::to_string(index);

        if (std::find(declared.begin(), declared.end(), only[index]) == declared.end())
            return declined(LibraryRefusal::columnNotDeclared, named + " is not one of 'columns'");

        if (!seen.insert(only[index]).second)
            return declined(LibraryRefusal::duplicateColumn, named + " repeats an earlier one");
    }

    if (spine && *spine != "true" && *spine != "false")
        return declined(LibraryRefusal::badSpine, "'spine' must be true or false");

    request.part.only = only;
    request.part.spine = !spine || *spine == "true";
    return request;
}

void RebuildQueue::ask(std::vector<std::string> columns, RebuildReason why) {
    if (why == RebuildReason::dataChanged)
        dataMoved();
    else
        forColumns_ = !building(columns);

    asked_ = std::move(columns);
}

void RebuildQueue::dataMoved() {
    forData_ = true;
    ++dataMoves_;
}

uint64_t RebuildQueue::dataMoves() const {
    return dataMoves_;
}

bool RebuildQueue::wanted() const {
    return forColumns_ || forData_;
}

bool RebuildQueue::wantedForDataAlone() const {
    return forData_ && !forColumns_;
}

bool RebuildQueue::startIfWanted() {
    const bool rebuilding = wanted();
    forColumns_ = false;
    forData_ = false;

    if (!rebuilding)
        return false;

    if (asked_.has_value()) {
        columns_ = std::move(*asked_);
        asked_.reset();
    }

    building_ = columns_;
    return true;
}

void RebuildQueue::finished() {
    building_.reset();
}

void RebuildQueue::failed() {
    if (building_.has_value())
        forColumns_ = true;
    else
        dataMoved();

    building_.reset();
}

const std::vector<std::string>& RebuildQueue::columns() const {
    return columns_;
}

bool RebuildQueue::building(const std::vector<std::string>& columns) const {
    return building_.has_value() && *building_ == columns;
}

}  // namespace jean
