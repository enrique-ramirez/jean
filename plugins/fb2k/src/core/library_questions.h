#pragma once

#include "core/library.h"
#include "core/library_roles.h"
#include "core/library_summary.h"
#include "third_party/json.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string_view>
#include <vector>

namespace jean {

struct AlbumGrouping;
struct Credits;
struct HeldCredits;
struct HeldAlbums;
struct CreditLessons;
struct SearchParts;
struct SearchText;
struct CompletionValues;

enum class ValueField { artist, albumArtist, album, genre };

class LibraryQuestions {
public:
    LibraryQuestions();
    explicit LibraryQuestions(LocalTime local);
    ~LibraryQuestions();

    LibraryQuestions(const LibraryQuestions&) = delete;
    LibraryQuestions& operator=(const LibraryQuestions&) = delete;

    nlohmann::json album(const Snapshot& snapshot, const LibraryRoles& roles, std::string_view name,
                         const std::optional<std::string>& by);

    nlohmann::json artist(const Snapshot& snapshot, const LibraryRoles& roles,
                          std::string_view name, bool splitsCredits);

    nlohmann::json search(const Snapshot& snapshot, const LibraryRoles& roles,
                          std::string_view query, size_t limit, size_t entityLimit,
                          bool splitsCredits);

    nlohmann::json genre(const Snapshot& snapshot, const LibraryRoles& roles,
                         std::string_view name);

    nlohmann::json credits(const Snapshot& snapshot, const LibraryRoles& roles, uint32_t ordinal,
                           bool splitsCredits);

    nlohmann::json values(const Snapshot& snapshot, const LibraryRoles& roles, ValueField field,
                          std::string_view prefix, size_t limit);

    std::shared_ptr<const SearchText> searchTextFor(const Snapshot& snapshot,
                                                    const LibraryRoles& roles);

    std::shared_ptr<const SearchText> glyphTextFor(const Snapshot& snapshot,
                                                   const LibraryRoles& roles);

    std::vector<uint32_t> coverOrdinals(const Snapshot& snapshot, const LibraryRoles& roles,
                                        const std::vector<uint32_t>& ordinals);

    size_t albumBuilds() const { return albumBuilds_; }
    size_t groupingBuilds() const { return groupingBuilds_; }
    size_t creditBuilds() const { return creditBuilds_; }

    struct Held;

private:
    std::shared_ptr<const AlbumGrouping> groupingFor(const Snapshot& snapshot,
                                                     const LibraryRoles& roles);
    std::shared_ptr<const HeldCredits> creditsFor(const Snapshot& snapshot,
                                                  const LibraryRoles& roles);
    std::shared_ptr<const CreditLessons> lessonsFor(const Snapshot& snapshot,
                                                    const LibraryRoles& roles);

    SearchParts searchPartsFor(const Snapshot& snapshot, const LibraryRoles& roles,
                               bool splitsCredits);

    std::shared_ptr<const CompletionValues> completionFor(const Snapshot& snapshot,
                                                          const LibraryRoles& roles,
                                                          ValueField field);

    Held& heldFor(const Snapshot& snapshot, const LibraryRoles& roles);

    const LocalTime local_;
    std::mutex mutex_;
    uint64_t structure_ = 0;
    std::vector<std::shared_ptr<Held>> held_;
    std::atomic<size_t> groupingBuilds_{0};
    std::atomic<size_t> creditBuilds_{0};
    std::atomic<size_t> albumBuilds_{0};
};

}  // namespace jean
