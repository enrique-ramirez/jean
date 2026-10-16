#include "core/library_splice.h"

#include "core/library.h"

#include <algorithm>
#include <functional>
#include <string>
#include <string_view>
#include <unordered_map>

namespace jean {

namespace {

uint64_t hash64(std::string_view value) {
    return static_cast<uint64_t>(std::hash<std::string_view>{}(value));
}

std::vector<uint64_t> trackKeysOf(const Snapshot& snapshot) {
    constexpr uint64_t kMixer = 0x9e3779b97f4a7c15ULL;

    std::vector<uint64_t> keys(snapshot.trackCount(), 0);
    for (size_t field = 0; field < kSpineFieldCount; ++field) {
        const Column& column = snapshot.columns[field];

        std::vector<uint64_t> entries(column.dictionary.values.size());
        std::transform(column.dictionary.values.begin(), column.dictionary.values.end(),
                       entries.begin(), [](const std::string& value) { return hash64(value); });

        for (size_t row = 0; row < keys.size(); ++row)
            keys[row] = ((keys[row] ^ entries[column.ids[row]]) * kMixer) + field;
    }
    return keys;
}

struct OrderDiff {
    std::vector<uint32_t> sourceOf;

    std::vector<uint32_t> removed;
};

// Tracks are matched by key and never by comparing paths: foobar2000's order is not byte order.
std::optional<OrderDiff> diffOrders(const Snapshot& was, const Snapshot& is) {
    struct Tally {
        uint32_t was = 0;
        uint32_t is = 0;
        uint32_t seenWas = 0;
        uint32_t seenIs = 0;

        uint32_t shared() const { return std::min(was, is); }
    };

    const std::vector<uint64_t> wasKeys = trackKeysOf(was);
    const std::vector<uint64_t> isKeys = trackKeysOf(is);

    std::unordered_map<uint64_t, Tally> tallies;
    tallies.reserve(wasKeys.size() + isKeys.size());
    for (const uint64_t key : wasKeys)
        ++tallies[key].was;
    for (const uint64_t key : isKeys)
        ++tallies[key].is;

    OrderDiff diff;
    std::vector<uint32_t> sharedWas;
    for (size_t row = 0; row < wasKeys.size(); ++row) {
        Tally& tally = tallies[wasKeys[row]];
        if (++tally.seenWas <= tally.shared())
            sharedWas.push_back(static_cast<uint32_t>(row));
        else
            diff.removed.push_back(static_cast<uint32_t>(row));
    }

    diff.sourceOf.assign(isKeys.size(), kNoRow);
    size_t paired = 0;
    for (size_t row = 0; row < isKeys.size(); ++row) {
        Tally& tally = tallies[isKeys[row]];
        if (++tally.seenIs > tally.shared())
            continue;

        const uint32_t source = sharedWas[paired++];
        if (!sameTrack(was, source, is, row))
            return std::nullopt;
        diff.sourceOf[row] = source;
    }
    return diff;
}

struct GrownColumn {
    Column column;

    std::vector<uint32_t> moved;
};

GrownColumn growColumn(const Column& before, const Column& after,
                       const std::vector<uint32_t>& sourceOf) {
    GrownColumn grown;
    grown.column.name = before.name;
    grown.column.dictionary = before.dictionary;

    std::vector<uint32_t> idOf(after.dictionary.values.size());
    std::transform(
        after.dictionary.values.begin(), after.dictionary.values.end(), idOf.begin(),
        [&grown](const std::string& value) { return grown.column.dictionary.intern(value); });

    grown.column.ids.resize(after.ids.size());
    for (size_t row = 0; row < after.ids.size(); ++row) {
        grown.column.ids[row] = idOf[after.ids[row]];

        const uint32_t source = sourceOf[row];
        if (source != kNoRow && before.ids[source] != grown.column.ids[row])
            grown.moved.push_back(static_cast<uint32_t>(row));
    }
    return grown;
}

std::vector<uint32_t> insertedRows(const std::vector<uint32_t>& sourceOf) {
    std::vector<uint32_t> inserted;
    for (size_t row = 0; row < sourceOf.size(); ++row)
        if (sourceOf[row] == kNoRow)
            inserted.push_back(static_cast<uint32_t>(row));
    return inserted;
}

Merged landedAs(Landing landing) {
    Merged merged;
    merged.landing = landing;
    return merged;
}

}  // namespace

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

bool worthKeeping(size_t live, size_t dead, size_t bytes, size_t maxBytes) {
    return dead <= live && bytes <= maxBytes;
}

std::vector<uint32_t> originAfter(const std::vector<uint32_t>& origin,
                                  const std::vector<uint32_t>& removed,
                                  const std::vector<uint32_t>& inserted) {
    const size_t rows = origin.size() - removed.size() + inserted.size();

    std::vector<uint32_t> after;
    after.reserve(rows);

    size_t held = 0;
    size_t nextRemoved = 0;
    size_t nextInserted = 0;
    for (size_t row = 0; row < rows; ++row) {
        if (nextInserted < inserted.size() && inserted[nextInserted] == row) {
            after.push_back(kNoRow);
            ++nextInserted;
            continue;
        }

        while (nextRemoved < removed.size() && removed[nextRemoved] == held) {
            ++held;
            ++nextRemoved;
        }
        after.push_back(origin[held++]);
    }
    return after;
}

Merged mergeOnto(const Snapshot& was, const Snapshot& next, size_t maxBytes) {
    if (was.structure == 0 || !sameColumns(was, next))
        return landedAs(Landing::rearranged);

    const auto diff = diffOrders(was, next);
    if (!diff)
        return landedAs(Landing::rearranged);

    auto merged = std::make_shared<Snapshot>();
    merged->structure = next.structure;
    merged->revision = next.revision;
    merged->columns.resize(was.columns.size());

    Retained step;
    step.ordinals.resize(was.columns.size());
    step.dictionarySizes.reserve(was.columns.size());

    size_t live = 0;
    size_t dead = 0;
    for (size_t field = 0; field < was.columns.size(); ++field) {
        const size_t liveHere = next.columns[field].dictionary.values.size();
        GrownColumn grown = growColumn(was.columns[field], next.columns[field], diff->sourceOf);

        step.dictionarySizes.push_back(
            static_cast<uint32_t>(was.columns[field].dictionary.values.size()));
        step.ordinals[field] = std::move(grown.moved);

        live += liveHere;
        dead += grown.column.dictionary.values.size() - liveHere;
        merged->columns[field] = std::move(grown.column);
    }

    if (!worthKeeping(live, dead, serialisedBytes(*merged), maxBytes))
        return landedAs(Landing::compacted);

    step.splice = SpliceStep{diff->removed, insertedRows(diff->sourceOf)};

    Merged result = landedAs(Landing::spliced);
    result.snapshot = std::move(merged);
    result.step = std::move(step);
    return result;
}

}  // namespace jean
