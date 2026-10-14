#include "core/library.h"

#include "core/text.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <numeric>
#include <set>

using nlohmann::json;

namespace jean {

namespace {

// `new Int32Array(buffer, offset, n)` in a browser throws unless the byte offset is a
// multiple of four, and a client's offsets are absolute, so the header is padded to keep the
// blob's own start aligned as well as every section inside it.
constexpr size_t kAlignment = 4;
constexpr size_t kHeaderBytesPerColumn = 320;

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
    facts.hasUnresolved = column.dictionary.ids.contains(kUnresolved);
    facts.allUnresolved = facts.distinct == 1 && facts.hasUnresolved;
    return facts;
}

size_t paddingTo(size_t alignment, size_t size) {
    return (alignment - (size % alignment)) % alignment;
}

void alignBlob(std::string& blob) {
    blob.append(paddingTo(kAlignment, blob.size()), '\0');
}

void appendLittleEndian(std::string& out, uint64_t value, size_t bytes) {
    for (size_t byte = 0; byte < bytes; ++byte)
        out.push_back(static_cast<char>((value >> (8 * byte)) & 0xFFU));
}

json placeIds(std::string& blob, const std::vector<uint32_t>& ids, IdWidth width) {
    alignBlob(blob);

    const json placed{
        {"offset", blob.size()}, {"count", ids.size()}, {"width", static_cast<int>(width)}};

    for (const uint32_t id : ids)
        appendLittleEndian(blob, id, static_cast<size_t>(width));

    return placed;
}

json placeDictionary(std::string& blob, const std::vector<std::string>& values) {
    const size_t length =
        std::accumulate(values.begin(), values.end(), size_t{0},
                        [](size_t total, const std::string& v) { return total + v.size(); });

    alignBlob(blob);
    const json text{{"offset", blob.size()}, {"length", length}};
    for (const std::string& value : values)
        blob.append(value);

    const IdWidth width = widthFor(length + 1);
    alignBlob(blob);
    const json ends{
        {"offset", blob.size()}, {"count", values.size()}, {"width", static_cast<int>(width)}};

    size_t end = 0;
    for (const std::string& value : values) {
        end += value.size();
        appendLittleEndian(blob, end, static_cast<size_t>(width));
    }

    return json{{"text", text}, {"ends", ends}};
}

json placeColumn(std::string& blob, const std::vector<uint32_t>& ids, size_t distinct,
                 const std::vector<std::string>& values, const ColumnFacts& facts) {
    return json{{"ids", placeIds(blob, ids, widthFor(distinct))},
                {"dict", placeDictionary(blob, values)},
                {"distinct", facts.distinct},
                {"hasUnresolved", facts.hasUnresolved},
                {"allUnresolved", facts.allUnresolved}};
}

std::string frame(const json& header, std::string blob) {
    // nlohmann's dump() throws on text that is not valid UTF-8, and a column expression comes
    // from a client, so the replacement handler keeps a malformed one from becoming a 500.
    std::string text = header.dump(-1, ' ', false, json::error_handler_t::replace);
    text.append(paddingTo(kAlignment, kMagicBytes + kHeaderLengthBytes + text.size()), ' ');

    std::string prefix;
    prefix.reserve(kMagicBytes + kHeaderLengthBytes + text.size());
    prefix.append(kMagic, kMagicBytes);
    appendLittleEndian(prefix, text.size(), kHeaderLengthBytes);
    prefix.append(text);

    blob.insert(0, prefix);
    return blob;
}

size_t messageBytesFor(const Column& column) {
    const size_t text = std::accumulate(
        column.dictionary.values.begin(), column.dictionary.values.end(), size_t{0},
        [](size_t total, const std::string& value) { return total + value.size(); });
    return (column.ids.size() * sizeof(uint32_t)) + text +
           (column.dictionary.values.size() * sizeof(uint32_t)) + (3 * kAlignment) +
           column.name.size() + kHeaderBytesPerColumn;
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

uint32_t Dictionary::intern(std::string_view value) {
    if (const auto found = ids.find(value); found != ids.end())
        return found->second;

    const auto next = static_cast<uint32_t>(values.size());
    ids.emplace(std::string(value), next);
    values.emplace_back(value);
    return next;
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

    for (Column& column : columns_)
        ensureEveryIdResolves(column);

    Snapshot snapshot;
    snapshot.columns = std::move(columns_);
    return snapshot;
}

std::string serialiseSnapshot(const Snapshot& snapshot) {
    std::string blob;
    blob.reserve(std::accumulate(
        snapshot.columns.begin(), snapshot.columns.end(), size_t{0},
        [](size_t total, const Column& column) { return total + messageBytesFor(column); }));
    json columns = json::array();
    json spine = json::object();

    for (size_t field = 0; field < snapshot.columns.size(); ++field) {
        const Column& column = snapshot.columns[field];
        const ColumnFacts facts = factsOf(column);
        json placed =
            placeColumn(blob, column.ids, facts.distinct, column.dictionary.values, facts);

        if (field < kSpineFieldCount) {
            spine[column.name] = std::move(placed);
        } else {
            placed["name"] = column.name;
            columns.push_back(std::move(placed));
        }
    }

    return frame(json{{"kind", "snapshot"},
                      {"structure", snapshot.structure},
                      {"revision", snapshot.revision},
                      {"trackCount", snapshot.trackCount()},
                      {"columns", std::move(columns)},
                      {"spine", std::move(spine)}},
                 std::move(blob));
}

std::string serialiseDelta(const Delta& delta) {
    std::string blob;
    json columns = json::array();
    json spine = json::object();

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

    return frame(json{{"kind", "delta"},
                      {"structure", delta.structure},
                      {"revision", delta.revision},
                      {"since", delta.since},
                      {"trackCount", delta.trackCount},
                      {"columns", std::move(columns)},
                      {"spine", std::move(spine)}},
                 std::move(blob));
}

Library::Library(size_t retainedRevisions) : retainedRevisions_(retainedRevisions) {}

bool Library::sameShape(const Snapshot& current, const Snapshot& next) {
    if (current.structure == 0 || current.columns.size() != next.columns.size() ||
        current.trackCount() != next.trackCount())
        return false;

    for (size_t field = 0; field < current.columns.size(); ++field)
        if (current.columns[field].name != next.columns[field].name)
            return false;

    const size_t count = current.trackCount();
    for (size_t field = 0; field < kSpineFieldCount; ++field) {
        const Column& was = current.columns[field];
        const Column& is = next.columns[field];
        for (size_t ordinal = 0; ordinal < count; ++ordinal)
            if (was.dictionary.values[was.ids[ordinal]] != is.dictionary.values[is.ids[ordinal]])
                return false;
    }

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
    const std::lock_guard<std::mutex> lock(mutex_);
    return snapshot_;
}

uint64_t Library::structureAfter(const Snapshot& next) const {
    const auto now = current();
    return sameShape(*now, next) ? now->structure : now->structure + 1;
}

void Library::replace(Snapshot snapshot) {
    const auto now = current();
    if (sameShape(*now, snapshot)) {
        apply(rowChangesBetween(*now, snapshot));
        return;
    }

    const std::lock_guard<std::mutex> lock(mutex_);

    snapshot.structure = snapshot_->structure + 1;
    snapshot.revision = snapshot_->revision + 1;
    structureBegan_ = snapshot.revision;

    snapshot_ = std::make_shared<Snapshot>(std::move(snapshot));
    retained_.clear();
    building_ = false;
}

uint64_t Library::apply(const std::vector<RowChange>& changes) {
    const std::lock_guard<std::mutex> exporting(exportLock_);
    const std::lock_guard<std::mutex> lock(mutex_);
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

            column.ids[change.ordinal] = id;
            entry.ordinals[field].push_back(change.ordinal);
        }
    }

    const bool moved =
        std::any_of(entry.ordinals.begin(), entry.ordinals.end(),
                    [](const std::vector<uint32_t>& ordinals) { return !ordinals.empty(); });
    if (!moved)
        return snapshot.revision;

    for (std::vector<uint32_t>& ordinals : entry.ordinals) {
        std::sort(ordinals.begin(), ordinals.end());
        ordinals.erase(std::unique(ordinals.begin(), ordinals.end()), ordinals.end());
    }

    entry.revision = ++snapshot.revision;
    retained_.push_back(std::move(entry));
    while (retained_.size() > retainedRevisions_)
        retained_.pop_front();

    return snapshot.revision;
}

void Library::reportBuild(BuildProgress progress) {
    const std::lock_guard<std::mutex> lock(mutex_);
    building_ = true;
    build_ = progress;
}

void Library::endBuild() {
    const std::lock_guard<std::mutex> lock(mutex_);
    building_ = false;
    build_ = BuildProgress{};
}

void Library::reportHalted() {
    const std::lock_guard<std::mutex> lock(mutex_);
    halted_ = true;
    building_ = false;
    build_ = BuildProgress{};
}

Library::State Library::state() const {
    const std::lock_guard<std::mutex> lock(mutex_);

    State state;
    state.ready = snapshot_->structure > 0;
    state.structure = snapshot_->structure;
    state.revision = snapshot_->revision;
    state.trackCount = snapshot_->trackCount();

    for (size_t field = kSpineFieldCount; field < snapshot_->columns.size(); ++field)
        state.columns.push_back(snapshot_->columns[field].name);

    if (building_)
        state.build = build_;

    state.halted = halted_;
    return state;
}

Library::Export Library::exported() const {
    const std::lock_guard<std::mutex> exporting(exportLock_);

    std::shared_ptr<const Snapshot> reading;
    {
        const std::lock_guard<std::mutex> lock(mutex_);
        reading = snapshot_;
    }

    if (lastExport_.bytes && lastExport_.structure == reading->structure &&
        lastExport_.revision == reading->revision)
        return lastExport_;

    lastExport_.structure = reading->structure;
    lastExport_.revision = reading->revision;
    lastExport_.bytes = std::make_shared<const std::string>(serialiseSnapshot(*reading));
    return lastExport_;
}

Library::Changes Library::changes(uint64_t since) const {
    const std::lock_guard<std::mutex> lock(mutex_);

    if (snapshot_->structure == 0)
        return {DeltaOutcome::notBuilt, {}};
    if (since > snapshot_->revision)
        return {DeltaOutcome::revisionUnknown, {}};
    if (since < structureBegan_)
        return {DeltaOutcome::structureChanged, {}};
    if (!retained_.empty() && retained_.front().revision > since + 1)
        return {DeltaOutcome::revisionTooOld, {}};

    const auto firstUnseen =
        std::find_if(retained_.begin(), retained_.end(),
                     [since](const Retained& entry) { return entry.revision > since; });

    std::vector<std::set<uint32_t>> moved(snapshot_->columns.size());
    for (auto entry = firstUnseen; entry != retained_.end(); ++entry) {
        for (size_t field = 0; field < moved.size(); ++field)
            moved[field].insert(entry->ordinals[field].begin(), entry->ordinals[field].end());
    }

    // Revisions are contiguous, so the dictionary lengths recorded before the first revision
    // the client has not seen are the lengths it holds.
    const std::vector<uint32_t> held =
        firstUnseen == retained_.end() ? std::vector<uint32_t>() : firstUnseen->dictionarySizes;

    Delta delta;
    delta.structure = snapshot_->structure;
    delta.revision = snapshot_->revision;
    delta.since = since;
    delta.trackCount = snapshot_->trackCount();

    for (size_t field = 0; field < snapshot_->columns.size(); ++field) {
        if (moved[field].empty())
            continue;

        const Column& column = snapshot_->columns[field];
        const ColumnFacts facts = factsOf(column);

        ColumnDelta patch;
        patch.index = field;
        patch.name = column.name;
        patch.ordinals.assign(moved[field].begin(), moved[field].end());
        patch.base = held[field];
        patch.appended.assign(column.dictionary.values.begin() + patch.base,
                              column.dictionary.values.end());
        patch.hasUnresolved = facts.hasUnresolved;
        patch.allUnresolved = facts.allUnresolved;

        patch.ids.reserve(patch.ordinals.size());
        for (const uint32_t ordinal : patch.ordinals)
            patch.ids.push_back(column.ids[ordinal]);

        delta.columns.push_back(std::move(patch));
    }

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
