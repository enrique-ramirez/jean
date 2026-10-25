#pragma once

#include "core/library.h"
#include "core/library_roles.h"

#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace jean {

// How foobar2000 joins the values of a multi-valued tag, which is what `$meta_sep` gives Jean's own
// expressions.
inline constexpr char kMultiValueSeparator = '\x1f';

// A column's text is no answer where foobar2000 left it unresolved, empty or `N/A`.
bool isPresent(std::string_view raw);

bool isDigit(char c);
bool isAsciiSpace(char c);

std::optional<double> readOrdinal(std::string_view raw);

template <class T>
struct PerValue {
    const std::vector<uint32_t>* ids = nullptr;
    std::vector<T> answers;
    T none{};

    const T& of(size_t row) const { return ids ? answers[(*ids)[row]] : none; }
};

template <class T, class Read>
PerValue<T> resolve(const Snapshot& snapshot, std::optional<size_t> role, Read read) {
    PerValue<T> resolved;
    if (!role)
        return resolved;

    const Column& column = snapshot.columns[*role];
    resolved.ids = &column.ids;
    resolved.answers.reserve(column.dictionary.values.size());
    for (const std::string& value : column.dictionary.values)
        resolved.answers.push_back(read(value));
    return resolved;
}

template <class T>
PerValue<T> perValue(const Snapshot& snapshot, std::optional<size_t> role, std::vector<T> answers,
                     T none) {
    PerValue<T> resolved;
    resolved.none = std::move(none);
    if (role) {
        resolved.ids = &snapshot.columns[*role].ids;
        resolved.answers = std::move(answers);
    }
    return resolved;
}

inline constexpr uint32_t kNoId = std::numeric_limits<uint32_t>::max();

uint32_t idAt(std::optional<size_t> role, const Snapshot& snapshot, size_t row);

std::optional<std::string_view> cellOf(const Snapshot& snapshot, std::optional<size_t> role,
                                       uint32_t id);

struct TagGroups {
    std::unordered_map<std::string, int32_t> byKey;
    std::vector<std::string> names;
    std::vector<bool> blank;

    int32_t add(const std::string& key, std::string_view raw);

    std::vector<int32_t> over(const Snapshot& snapshot, std::optional<size_t> role);
};

// A genre tag splits on the multi-value separator into genres, each counted once per cell.
struct GenreGroups {
    TagGroups tags;
    std::vector<std::string> keys;
    PerValue<std::vector<int32_t>> of;
};

GenreGroups genreGroupsOf(const Snapshot& snapshot, std::optional<size_t> role);

struct Credits {
    PerValue<int32_t> albumGroup, albumArtistGroup, artistGroup;
    TagGroups albums;
    TagGroups artists;

    int32_t creditedArtist(size_t row) const;
};

Credits creditsOf(const Snapshot& snapshot, const LibraryRoles& roles);

// The artist a row's credit names, or -1 where it names nobody: none, or whitespace alone.
int64_t artistKeyOf(const Credits& credits, size_t row);

struct AlbumRecord {
    std::string name;
    std::optional<std::string> artist;
    int64_t artistKey = -1;

    std::vector<uint32_t> ordinals;

    double coverDisc = 0;
    double coverTrack = 0;
    uint32_t cover = 0;
};

uint64_t albumPairOf(int32_t albumGroup, int64_t artistKey);

struct AlbumIndex {
    std::unordered_map<uint64_t, uint32_t> byPair;

    std::optional<size_t> of(const Credits& credits, size_t row) const;
};

struct AlbumRecords {
    std::vector<AlbumRecord> list;
    AlbumIndex index;
};

AlbumRecords albumRecordsOf(const Snapshot& snapshot, const LibraryRoles& roles,
                            const Credits& credits);

std::string pathOf(const Snapshot& snapshot, size_t row);

}  // namespace jean
