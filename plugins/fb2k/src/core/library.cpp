#include "core/library.h"

#include "core/library_paths.h"
#include "core/library_wire.h"
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

constexpr size_t kFirstSlots = 16;

uint32_t hashOf(std::string_view value) {
    return static_cast<uint32_t>(std::hash<std::string_view>{}(value));
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

uint64_t splitMixFinalised(uint64_t z) {
    z = (z ^ (z >> 30U)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27U)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31U);
}

namespace {

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

bool sameColumns(const Snapshot& a, const Snapshot& b) {
    return a.columns.size() == b.columns.size() &&
           std::equal(
               a.columns.begin(), a.columns.end(), b.columns.begin(),
               [](const Column& left, const Column& right) { return left.name == right.name; });
}

bool sameTrack(const Snapshot& was, size_t wasRow, const Snapshot& is, size_t isRow) {
    for (size_t field = 0; field < kSpineFieldCount; ++field) {
        const Column& before = was.columns[field];
        const Column& after = is.columns[field];
        if (before.dictionary.values[before.ids[wasRow]] !=
            after.dictionary.values[after.ids[isRow]])
            return false;
    }
    return true;
}

}  // namespace

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

    auto landed = std::make_shared<Snapshot>(std::move(snapshot));
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    snapshot_ = std::move(landed);
    building_ = false;
}

uint64_t Library::apply(const std::vector<RowChange>& changes) {
    const std::lock_guard<std::shared_mutex> lock(mutex_);
    if (snapshot_->structure == 0)
        return 0;

    Snapshot& snapshot = *snapshot_;
    std::vector<bool> moved(snapshot.columns.size(), false);
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
            moved[field] = true;
        }
    }

    if (std::none_of(moved.begin(), moved.end(), [](bool changed) { return changed; }))
        return snapshot.revision;

    for (size_t field = 0; field < moved.size(); ++field) {
        if (moved[field])
            ++snapshot.columns[field].changeCount;
    }

    return ++snapshot.revision;
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
    state.trackCount = snapshot_->trackCount();

    for (size_t field = kSpineFieldCount; field < snapshot_->columns.size(); ++field) {
        state.columns.push_back(snapshot_->columns[field].name);
        state.changeCounts.push_back(snapshot_->columns[field].changeCount);
    }

    if (building_)
        state.build = build_;

    state.halted = halted_;
    return state;
}

std::shared_ptr<const LibraryPaths> Library::pathsOfHeldSnapshot() const {
    const std::lock_guard<std::mutex> building(pathsLock_);
    if (!paths_ || paths_->structure() != snapshot_->structure)
        paths_ = std::make_shared<const LibraryPaths>(*snapshot_);
    return paths_;
}

std::shared_ptr<const LibraryPaths> Library::paths() const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    return pathsOfHeldSnapshot();
}

void Library::readWithPaths(
    const std::function<void(const Snapshot&, const LibraryPaths&)>& read) const {
    const std::shared_lock<std::shared_mutex> lock(mutex_);
    const auto held = pathsOfHeldSnapshot();
    read(*snapshot_, *held);
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
