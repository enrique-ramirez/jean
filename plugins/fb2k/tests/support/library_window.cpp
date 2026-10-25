#include "support/library_window.h"

#include <algorithm>
#include <iterator>
#include <set>

namespace jean::testing {

Cells cellsOf(const Wire& rows) {
    Cells cells;
    for (const auto& [name, placed] : rows.header.at("spine").items())
        cells[name] = column(rows, placed);
    for (const auto& placed : rows.header.at("columns"))
        cells[placed.at("name").get<std::string>()] = column(rows, placed);
    return cells;
}

Cells cellsAt(const Snapshot& snapshot, std::span<const uint32_t> ordinals) {
    Cells cells;
    for (const Column& held : snapshot.columns) {
        auto& read = cells[held.name];
        std::transform(
            ordinals.begin(), ordinals.end(), std::back_inserter(read),
            [&held](uint32_t ordinal) { return held.dictionary.values.at(held.ids.at(ordinal)); });
    }
    return cells;
}

std::vector<std::string> usedValues(const std::vector<std::string>& cells) {
    const std::set<std::string> used(cells.begin(), cells.end());
    return {used.begin(), used.end()};
}

}  // namespace jean::testing
