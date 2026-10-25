#include "core/playlist_find.h"

#include "core/text.h"

#include <algorithm>
#include <array>
#include <iterator>
#include <numeric>
#include <optional>

namespace jean {

namespace {

using Fields = std::array<std::string_view, kSearchedColumnCount>;

bool foundIn(const Fields& fields, const std::string& word) {
    return std::any_of(fields.begin(), fields.end(), [&word](std::string_view field) {
        return field.find(word) != std::string_view::npos;
    });
}

}  // namespace

std::vector<std::string> playlistFindColumns(const Snapshot& snapshot, const LibraryRoles& roles) {
    const auto searched = searchedColumns(roles);

    std::vector<std::string> columns;
    columns.reserve(searched.size());
    std::transform(searched.begin(), searched.end(), std::back_inserter(columns),
                   [&snapshot](std::optional<size_t> role) {
                       return role ? snapshot.columns[*role].name : std::string();
                   });
    return columns;
}

std::vector<uint32_t> playlistMatches(const Snapshot& snapshot, const LibraryRoles& roles,
                                      const SearchText& folded, const SearchText& glyphsOf,
                                      std::span<const PlaylistTrack> rows, std::string_view query) {
    std::vector<std::string> words = foldedWords(query);
    const bool marks = searchesMarks(query);
    if (marks)
        words = {glyphs(query)};

    std::vector<uint32_t> matched;
    if (words.empty()) {
        matched.resize(rows.size());
        std::iota(matched.begin(), matched.end(), uint32_t{0});
        return matched;
    }

    const SearchText& text = marks ? glyphsOf : folded;
    const auto searched = searchedColumns(roles);
    for (size_t at = 0; at < rows.size(); ++at) {
        const PlaylistTrack& row = rows[at];

        Fields fields;
        std::array<std::string, kSearchedColumnCount> folding;
        for (size_t field = 0; field < fields.size(); ++field) {
            if (row.ordinal) {
                const std::optional<size_t> role = searched[field];
                const size_t id = role ? snapshot.columns[*role].ids[*row.ordinal] : 0;
                fields[field] = text.folded[field][id];
            } else if (field < row.columns.size() && row.columns[field] != kUnresolved) {
                folding[field] = marks ? glyphs(row.columns[field]) : fold(row.columns[field]);
                fields[field] = folding[field];
            }
        }

        if (std::all_of(words.begin(), words.end(),
                        [&fields](const std::string& word) { return foundIn(fields, word); }))
            matched.push_back(static_cast<uint32_t>(at));
    }
    return matched;
}

}  // namespace jean
