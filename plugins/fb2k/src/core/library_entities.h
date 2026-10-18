#pragma once

#include "core/library.h"
#include "core/library_credits.h"
#include "core/library_groups.h"
#include "core/library_roles.h"

#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace jean {

struct AlbumGrouping {
    TagGroups albums;
    TagGroups artists;
    std::vector<int32_t> albumOfId;
    std::vector<int32_t> albumArtistOfId;
    std::vector<int32_t> artistOfId;
};

struct EntityKey {
    std::string squashed;
    std::vector<std::string> words;

    // The squashed name's length in UTF-16 code units, as a browser counts it.
    size_t length = 0;
};

constexpr size_t kSearchedColumnCount = 5;

std::array<std::optional<size_t>, kSearchedColumnCount> searchedColumns(const LibraryRoles& roles);

struct SearchText {
    std::array<std::vector<std::string>, kSearchedColumnCount> folded;
};

std::shared_ptr<const SearchText> searchTextOf(const Snapshot& snapshot, const LibraryRoles& roles);

std::shared_ptr<const SearchText> glyphTextOf(const Snapshot& snapshot, const LibraryRoles& roles);

struct GenreEntities {
    struct Entity {
        std::string name;
        EntityKey match;
        uint32_t trackCount = 0;
    };

    std::vector<Entity> entities;
};

std::shared_ptr<const GenreEntities> genreEntitiesOf(const Snapshot& snapshot,
                                                     const LibraryRoles& roles);

struct AlbumEntities {
    struct Entity {
        std::string album;
        std::optional<std::string> artist;
        EntityKey match;
        uint32_t trackCount = 0;
        uint32_t coverRow = 0;
    };

    std::vector<Entity> entities;
    std::vector<int32_t> recordOfRow;

    uint32_t coverRowOf(size_t row) const {
        const int32_t record = recordOfRow[row];
        return record < 0 ? static_cast<uint32_t>(row)
                          : entities[static_cast<size_t>(record)].coverRow;
    }
};

std::shared_ptr<const AlbumEntities> albumEntitiesOf(const Snapshot& snapshot,
                                                     const LibraryRoles& roles,
                                                     const AlbumGrouping& grouping);

struct ArtistEntities {
    struct Entity {
        std::string name;
        EntityKey match;
        std::optional<EntityKey> sortMatch;
        uint32_t trackCount = 0;
        uint32_t guestCount = 0;
        uint32_t albumCount = 0;
        std::optional<uint32_t> coverRow;
    };

    std::vector<Entity> entities;
};

std::shared_ptr<const ArtistEntities> artistEntitiesOf(
    const Snapshot& snapshot, const LibraryRoles& roles, const AlbumGrouping& grouping,
    const AlbumEntities& albums, const CreditLessons& lessons, bool splitsCredits);

struct SearchParts {
    std::shared_ptr<const SearchText> text;
    std::shared_ptr<const AlbumEntities> albums;
    std::shared_ptr<const ArtistEntities> artists;
    std::shared_ptr<const GenreEntities> genres;
};

}  // namespace jean
