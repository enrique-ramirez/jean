#pragma once

#include "core/library.h"
#include "core/library_groups.h"
#include "core/library_roles.h"
#include "core/library_summary.h"
#include "third_party/json.hpp"

#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace jean {

struct SetFigures {
    size_t albumCount = 0;
    size_t trackCount = 0;
    double seconds = 0;
    std::optional<double> earliestYear;
    std::optional<double> latestYear;
};

std::optional<double> earliestOf(std::optional<double> held, double value);
std::optional<double> latestOf(std::optional<double> held, double value);

struct MostPlayedTrack {
    uint32_t ordinal = 0;
    std::string title;
    double plays = 0;
};

struct GenreShare {
    std::string name;
    size_t count = 0;
    int share = 0;
};

std::vector<GenreShare> topGenresOf(const std::vector<std::string>& names,
                                    const std::vector<size_t>& counts, std::vector<int32_t> order,
                                    size_t total, size_t limit);

struct ArtistCards {
    double playedShare = 0;
    double plays = 0;
    size_t neverPlayed = 0;
    std::optional<double> lastPlayed;
    std::optional<MostPlayedTrack> mostPlayed;
    std::vector<GenreShare> topGenres;
};

struct RecordInSet {
    std::string album;
    std::optional<std::string> artist;
    std::optional<double> year;
    uint32_t cover = 0;
    size_t trackCount = 0;
};

SetFigures figuresOver(const Snapshot& snapshot, const LibraryRoles& roles,
                       std::span<const uint32_t> ordinals);

SetFigures figuresOver(const Snapshot& snapshot, const LibraryRoles& roles, const Credits& credits,
                       std::span<const uint32_t> ordinals);

ArtistCards cardsOver(const Snapshot& snapshot, const LibraryRoles& roles,
                      std::span<const uint32_t> ordinals, const LocalTime& local);

std::vector<RecordInSet> recordsOver(const Snapshot& snapshot, const LibraryRoles& roles,
                                     std::span<const uint32_t> ordinals);

std::vector<RecordInSet> recordsOver(const Snapshot& snapshot, const LibraryRoles& roles,
                                     const Credits& credits, std::span<const uint32_t> ordinals);

struct GenreTile {
    std::string name;
    size_t count = 0;
    size_t albumCount = 0;
    size_t artistCount = 0;
    std::vector<uint32_t> covers;
};

std::vector<GenreTile> genreTilesOf(const Snapshot& snapshot, const LibraryRoles& roles,
                                    const Credits& credits);

nlohmann::ordered_json figuresDocument(const SetFigures& figures);

nlohmann::ordered_json cardsDocument(const ArtistCards& cards);

nlohmann::ordered_json recordsDocument(const Snapshot& snapshot,
                                       const std::vector<RecordInSet>& records);

nlohmann::ordered_json genresDocument(const Snapshot& snapshot,
                                      const std::vector<GenreTile>& tiles);

}  // namespace jean
