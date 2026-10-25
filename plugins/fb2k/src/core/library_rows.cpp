#include "core/library_rows.h"

#include "core/failures.h"
#include "core/library_wire.h"
#include "core/selection.h"
#include "core/text.h"

#include <algorithm>
#include <limits>
#include <numeric>
#include <utility>
#include <vector>

using nlohmann::json;

namespace jean {

namespace {

struct WindowColumn {
    std::vector<uint32_t> ids;
    std::vector<std::string> values;
};

// Dictionaries are only append-only within a structure, so a value's id does not promise its
// place in byte order; the window sorts by value itself.
WindowColumn windowOf(const Column& column, std::span<const uint32_t> ordinals) {
    std::vector<uint32_t> used(ordinals.size());
    std::transform(ordinals.begin(), ordinals.end(), used.begin(),
                   [&column](uint32_t ordinal) { return column.ids[ordinal]; });

    std::vector<uint32_t> distinct = used;
    std::sort(distinct.begin(), distinct.end());
    distinct.erase(std::unique(distinct.begin(), distinct.end()), distinct.end());

    const auto& held = column.dictionary.values;
    std::vector<uint32_t> byValue = distinct;
    std::sort(byValue.begin(), byValue.end(),
              [&held](uint32_t a, uint32_t b) { return held[a] < held[b]; });

    std::vector<std::pair<uint32_t, uint32_t>> renumbered(byValue.size());
    for (uint32_t rank = 0; rank < byValue.size(); ++rank)
        renumbered[rank] = {byValue[rank], rank};
    std::sort(renumbered.begin(), renumbered.end());

    WindowColumn window;
    window.ids.resize(used.size());
    std::transform(used.begin(), used.end(), window.ids.begin(), [&renumbered](uint32_t id) {
        return std::lower_bound(renumbered.begin(), renumbered.end(),
                                std::pair<uint32_t, uint32_t>{id, 0})
            ->second;
    });

    window.values.resize(byValue.size());
    std::transform(byValue.begin(), byValue.end(), window.values.begin(),
                   [&held](uint32_t id) { return held[id]; });
    return window;
}

json placeWindow(Blob& blob, const Column& column, std::span<const uint32_t> ordinals) {
    const WindowColumn window = windowOf(column, ordinals);
    return placeColumn(blob, window.ids, window.values.size(), window.values, factsOf(column));
}

json describeRows(const Snapshot& snapshot, std::span<const uint32_t> ordinals, Blob& blob) {
    json columns = json::array();
    json spine = json::object();

    for (size_t field = 0; field < snapshot.columns.size(); ++field) {
        const Column& column = snapshot.columns[field];
        json placed = placeWindow(blob, column, ordinals);

        if (field < kSpineFieldCount) {
            spine[column.name] = std::move(placed);
        } else {
            placed["name"] = column.name;
            columns.push_back(std::move(placed));
        }
    }

    return json{{"kind", "rows"},
                {"structure", snapshot.structure},
                {"revision", snapshot.revision},
                {"trackCount", snapshot.trackCount()},
                {"rows", ordinals.size()},
                {"columns", std::move(columns)},
                {"spine", std::move(spine)}};
}

constexpr size_t kOrdinalLimit = size_t{std::numeric_limits<uint32_t>::max()} + 1;

size_t rowsNamed(const nlohmann::json& root) {
    const auto ordinals = root.find("ordinals");
    if (ordinals != root.end())
        return ordinals->is_array() ? ordinals->size() : 0;

    const auto runs = root.find("runs");
    if (runs == root.end() || !runs->is_array())
        return 0;

    uint64_t total = 0;
    for (const auto& run : *runs) {
        if (!run.is_array() || run.size() != 2 || !run[1].is_number_unsigned())
            continue;

        total += std::min<uint64_t>(run[1].get<uint64_t>(), kMaxRowsPerAnswer + 1);
        if (total > kMaxRowsPerAnswer)
            break;
    }
    return total;
}

std::optional<std::vector<std::string>> stringsOf(const nlohmann::json& root, const char* key) {
    const auto held = root.find(key);
    if (held == root.end())
        return std::vector<std::string>{};
    if (!held->is_array())
        return std::nullopt;

    std::vector<std::string> strings;
    for (const auto& entry : *held) {
        if (!entry.is_string())
            return std::nullopt;
        strings.push_back(entry.get<std::string>());
    }
    return strings;
}

}  // namespace

RowsRequest parseRowsRequest(const std::string& body) {
    RowsRequest asked;
    const auto malformed = [&asked] {
        asked.refusal = PlaylistRefusal::malformedBody;
        return asked;
    };

    const auto root = nlohmann::json::parse(body, nullptr, false);
    if (!root.is_object())
        return malformed();

    const auto structure = root.find("structure");
    if (structure == root.end() || !structure->is_string() ||
        !readDecimal(structure->get<std::string>(), asked.structure))
        return malformed();

    const auto columns = stringsOf(root, "columns");
    if (!columns)
        return malformed();

    if (root.contains("bitset") || !namesOneSelectionForm(root)) {
        asked.refusal = PlaylistRefusal::badOrdinals;
        return asked;
    }

    if (rowsNamed(root) > kMaxRowsPerAnswer) {
        asked.declaration = refused<LibraryRequest>(
            LibraryRefusal::tooManyRows,
            "a request names at most " + std::to_string(kMaxRowsPerAnswer) + " rows");
        return asked;
    }

    auto selection = decodeSelection(root, kOrdinalLimit);
    if (!selection.ok()) {
        asked.refusal = selection.refusal;
        return asked;
    }
    asked.ordinals = std::move(selection.ordinals);

    asked.declaration = columns->empty()
                            ? refused<LibraryRequest>(LibraryRefusal::badColumn, kColumnsRequired)
                            : parseLibraryRequest(*columns, std::string());
    return asked;
}

std::string serialiseRows(const Snapshot& snapshot, std::span<const uint32_t> ordinals) {
    return written(
        [&snapshot, ordinals](Blob& blob) { return describeRows(snapshot, ordinals, blob); });
}

}  // namespace jean
