#include "core/library_paths.h"

#include "core/library_groups.h"
#include "core/library_questions.h"
#include "core/library_roles.h"

#include <algorithm>
#include <charconv>
#include <limits>

namespace jean {

namespace {

constexpr uint32_t kNoSubsong = std::numeric_limits<uint32_t>::max();

uint32_t subsongOf(const std::string& text) {
    uint32_t subsong = kNoSubsong;
    const auto parsed = std::from_chars(text.data(), text.data() + text.size(), subsong);
    return parsed.ec == std::errc() ? subsong : kNoSubsong;
}

}  // namespace

LibraryPaths::LibraryPaths(const Snapshot& snapshot) : structure_(snapshot.structure) {
    if (snapshot.columns.size() < kSpineFieldCount)
        return;

    const size_t count = snapshot.trackCount();
    const Column& subsongColumn = snapshot.columns[kSpineFieldCount - 1];

    subsongs_.reserve(count);
    first_.reserve(count);
    for (size_t ordinal = 0; ordinal < count; ++ordinal) {
        subsongs_.push_back(subsongOf(subsongColumn.dictionary.values[subsongColumn.ids[ordinal]]));

        const auto placed =
            first_.emplace(pathOf(snapshot, ordinal), static_cast<uint32_t>(ordinal));
        if (!placed.second)
            later_[placed.first->first].push_back(static_cast<uint32_t>(ordinal));
    }
}

std::optional<uint32_t> LibraryPaths::firstOrdinalOf(std::string_view libraryPath) const {
    const auto found = first_.find(std::string(libraryPath));
    if (found == first_.end())
        return std::nullopt;
    return found->second;
}

std::optional<uint32_t> LibraryPaths::ordinalOf(std::string_view libraryPath,
                                                uint32_t subsong) const {
    const auto first = firstOrdinalOf(libraryPath);
    if (!first)
        return std::nullopt;

    std::optional<uint32_t> matched;
    size_t matches = 0;
    const auto consider = [&](uint32_t ordinal) {
        if (subsongs_[ordinal] != subsong)
            return;
        ++matches;
        if (!matched)
            matched = ordinal;
    };

    consider(*first);
    const auto twins = later_.find(std::string(libraryPath));
    if (twins != later_.end())
        std::for_each(twins->second.begin(), twins->second.end(), consider);

    return matches == 1 ? matched : std::nullopt;
}

std::vector<std::optional<std::string>> albumCoversOf(
    const Library* library, LibraryQuestions& questions,
    const std::map<std::string, std::string>& roles,
    const std::vector<std::optional<std::string>>& libraryPaths) {
    std::vector<std::optional<std::string>> covers(libraryPaths.size());
    if (!library ||
        std::none_of(libraryPaths.begin(), libraryPaths.end(),
                     [](const std::optional<std::string>& path) { return path.has_value(); }))
        return covers;

    library->readWithPaths([&](const Snapshot& snapshot, const LibraryPaths& paths) {
        const auto indices = rolesIn(snapshot, roles);
        if (!indices)
            return;

        std::vector<size_t> rows;
        std::vector<uint32_t> ordinals;
        for (size_t at = 0; at < libraryPaths.size(); ++at) {
            const auto ordinal =
                libraryPaths[at] ? paths.firstOrdinalOf(*libraryPaths[at]) : std::nullopt;
            if (ordinal) {
                rows.push_back(at);
                ordinals.push_back(*ordinal);
            }
        }
        if (ordinals.empty())
            return;

        const auto coverOrdinals = questions.coverOrdinals(snapshot, *indices, ordinals);
        for (size_t at = 0; at < rows.size(); ++at)
            covers[rows[at]] = pathOf(snapshot, coverOrdinals[at]);
    });
    return covers;
}

}  // namespace jean
