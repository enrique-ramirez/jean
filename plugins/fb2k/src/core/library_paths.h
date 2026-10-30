#pragma once

#include "core/library.h"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <iterator>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace jean {

class LibraryQuestions;

class LibraryPaths {
public:
    explicit LibraryPaths(const Snapshot& snapshot);

    uint64_t structure() const { return structure_; }

    // The lowest ordinal at `libraryPath`, which is the one fb2k/library.cpp's `byRelativePath`
    // keeps when two media library roots hold one path.
    std::optional<uint32_t> firstOrdinalOf(std::string_view libraryPath) const;

    // The track at `libraryPath` whose subsong is `subsong`. Nothing where the file holds no
    // such subsong, and nothing where two roots hold the same subsong at one path, since the
    // playing track cannot be told apart from its twin.
    std::optional<uint32_t> ordinalOf(std::string_view libraryPath, uint32_t subsong) const;

private:
    uint64_t structure_ = 0;
    std::vector<uint32_t> subsongs_;
    std::unordered_map<std::string, uint32_t> first_;
    std::unordered_map<std::string, std::vector<uint32_t>> later_;
};

// The library-relative path of each row's album record's cover track, parallel to
// `libraryPaths`; a track with no album tag is its own cover. A row is null where the library
// holds no such path, and for every row where the library is absent or not built or holds no
// column a role names: a read that asked for covers is never refused for want of them. The album
// records come from `questions`, which holds them per structure and change counts.
std::vector<std::optional<std::string>> albumCoversOf(
    const Library* library, LibraryQuestions& questions,
    const std::map<std::string, std::string>& roles,
    const std::vector<std::optional<std::string>>& libraryPaths);

template <class Rows, class RowOf = std::identity>
void attachCovers(const Library* library, LibraryQuestions& questions,
                  const std::map<std::string, std::string>& roles, Rows& rows, RowOf rowOf = {}) {
    if (roles.empty())
        return;

    std::vector<std::optional<std::string>> paths;
    paths.reserve(std::size(rows));
    std::transform(std::begin(rows), std::end(rows), std::back_inserter(paths),
                   [&](auto& row) { return rowOf(row).libraryPath; });

    auto covers = albumCoversOf(library, questions, roles, paths);
    size_t at = 0;
    for (auto& row : rows)
        rowOf(row).cover = std::move(covers[at++]);
}

}  // namespace jean
