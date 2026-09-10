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

constexpr char kMagic[] = "JLIB";
constexpr size_t kMagicBytes = sizeof(kMagic) - 1;
constexpr size_t kHeaderLengthBytes = 4;

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

std::string frame(const json& header, const std::string& blob) {
    // nlohmann's dump() throws on text that is not valid UTF-8, and a column expression comes
    // from a client, so the replacement handler keeps a malformed one from becoming a 500.
    std::string text = header.dump(-1, ' ', false, json::error_handler_t::replace);
    text.append(paddingTo(kAlignment, kMagicBytes + kHeaderLengthBytes + text.size()), ' ');

    std::string message;
    message.reserve(kMagicBytes + kHeaderLengthBytes + text.size() + blob.size());
    message.append(kMagic, kMagicBytes);
    appendLittleEndian(message, text.size(), kHeaderLengthBytes);
    message.append(text);
    message.append(blob);

    return message;
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

bool readRevision(const std::string& text, uint64_t& revision) {
    constexpr size_t kMaxDigits = 20;

    if (text.empty() || text.size() > kMaxDigits)
        return false;

    uint64_t value = 0;
    for (const char digit : text) {
        if (digit < '0' || digit > '9')
            return false;

        const auto step = static_cast<uint64_t>(digit - '0');
        if (value > (UINT64_MAX - step) / 10)
            return false;

        value = (value * 10) + step;
    }

    revision = value;
    return true;
}

}  // namespace

IdWidth widthFor(size_t distinctValues) {
    if (distinctValues <= 0x100)
        return IdWidth::one;
    if (distinctValues <= 0x10000)
        return IdWidth::two;
    return IdWidth::four;
}

uint32_t Dictionary::intern(std::string value) {
    const auto next = static_cast<uint32_t>(values.size());
    const auto placed = ids.emplace(value, next);
    if (placed.second)
        values.push_back(std::move(value));

    return placed.first->second;
}

ColumnFacts factsOf(const Column& column) {
    ColumnFacts facts;
    facts.distinct = column.dictionary.values.size();
    facts.hasUnresolved = column.dictionary.ids.count(kUnresolved) > 0;
    facts.allUnresolved = facts.distinct == 1 && facts.hasUnresolved;
    return facts;
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

size_t LibraryBuilder::fieldCount() const {
    return columns_.size();
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
                 blob);
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
                 blob);
}

Library::Library(size_t retainedRevisions) : retainedRevisions_(retainedRevisions) {}

void Library::replace(Snapshot snapshot) {
    const std::lock_guard<std::mutex> lock(mutex_);

    const uint64_t structure = snapshot_.structure + 1;
    const uint64_t revision = snapshot_.revision + 1;

    snapshot_ = std::move(snapshot);
    snapshot_.structure = structure;
    snapshot_.revision = revision;
    structureBegan_ = revision;
    retained_.clear();
}

uint64_t Library::apply(const std::vector<RowChange>& changes) {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (snapshot_.structure == 0)
        return 0;

    Retained entry;
    entry.ordinals.resize(snapshot_.columns.size());
    entry.dictionarySizes.reserve(snapshot_.columns.size());
    for (const Column& column : snapshot_.columns)
        entry.dictionarySizes.push_back(static_cast<uint32_t>(column.dictionary.values.size()));

    const size_t trackCount = snapshot_.trackCount();

    for (const RowChange& change : changes) {
        if (change.ordinal >= trackCount || change.values.size() != snapshot_.columns.size())
            continue;

        for (size_t field = 0; field < snapshot_.columns.size(); ++field) {
            Column& column = snapshot_.columns[field];
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
        return snapshot_.revision;

    for (std::vector<uint32_t>& ordinals : entry.ordinals) {
        std::sort(ordinals.begin(), ordinals.end());
        ordinals.erase(std::unique(ordinals.begin(), ordinals.end()), ordinals.end());
    }

    entry.revision = ++snapshot_.revision;
    retained_.push_back(std::move(entry));
    while (retained_.size() > retainedRevisions_)
        retained_.pop_front();

    return snapshot_.revision;
}

Library::State Library::state() const {
    const std::lock_guard<std::mutex> lock(mutex_);

    State state;
    state.ready = snapshot_.structure > 0;
    state.structure = snapshot_.structure;
    state.revision = snapshot_.revision;
    state.trackCount = snapshot_.trackCount();

    for (size_t field = kSpineFieldCount; field < snapshot_.columns.size(); ++field)
        state.columns.push_back(snapshot_.columns[field].name);

    return state;
}

std::string Library::exported() const {
    const std::lock_guard<std::mutex> lock(mutex_);
    return serialiseSnapshot(snapshot_);
}

Library::Changes Library::changes(uint64_t since) const {
    const std::lock_guard<std::mutex> lock(mutex_);

    if (snapshot_.structure == 0)
        return {DeltaOutcome::notBuilt, {}};
    if (since > snapshot_.revision)
        return {DeltaOutcome::revisionUnknown, {}};
    if (since < structureBegan_)
        return {DeltaOutcome::structureChanged, {}};
    if (!retained_.empty() && retained_.front().revision > since + 1)
        return {DeltaOutcome::revisionTooOld, {}};

    const auto firstUnseen =
        std::find_if(retained_.begin(), retained_.end(),
                     [since](const Retained& entry) { return entry.revision > since; });

    std::vector<std::set<uint32_t>> moved(snapshot_.columns.size());
    for (auto entry = firstUnseen; entry != retained_.end(); ++entry) {
        for (size_t field = 0; field < moved.size(); ++field)
            moved[field].insert(entry->ordinals[field].begin(), entry->ordinals[field].end());
    }

    // Revisions are contiguous, so the dictionary lengths recorded before the first revision
    // the client has not seen are the lengths it holds.
    const std::vector<uint32_t> held =
        firstUnseen == retained_.end() ? std::vector<uint32_t>() : firstUnseen->dictionarySizes;

    Delta delta;
    delta.structure = snapshot_.structure;
    delta.revision = snapshot_.revision;
    delta.since = since;
    delta.trackCount = snapshot_.trackCount();

    for (size_t field = 0; field < snapshot_.columns.size(); ++field) {
        if (moved[field].empty())
            continue;

        const Column& column = snapshot_.columns[field];
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

    if (!since.empty() && !readRevision(since, request.since))
        return refuse(LibraryRefusal::badSince, "'since' must be a whole number");

    return request;
}

std::string describe(LibraryRefusal refusal) {
    switch (refusal) {
        case LibraryRefusal::none:
            return "ok";
        case LibraryRefusal::tooManyColumns:
            return "too many columns";
        case LibraryRefusal::badColumn:
            return "unacceptable column";
        case LibraryRefusal::duplicateColumn:
            return "duplicate column";
        case LibraryRefusal::badSince:
            return "unacceptable revision";
    }
    return "unknown";
}

std::string describe(DeltaOutcome outcome) {
    switch (outcome) {
        case DeltaOutcome::ok:
            return "ok";
        case DeltaOutcome::notBuilt:
            return "the library snapshot has not been built yet";
        case DeltaOutcome::structureChanged:
            return "tracks were added or removed; export the library again";
        case DeltaOutcome::revisionTooOld:
            return "that revision is older than the retained window; export the library again";
        case DeltaOutcome::revisionUnknown:
            return "no such revision";
    }
    return "unknown";
}

}  // namespace jean
