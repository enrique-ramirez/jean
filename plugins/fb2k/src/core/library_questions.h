#pragma once

#include "core/library.h"
#include "core/library_roles.h"
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
struct CreditLessons;
struct SearchParts;

inline constexpr size_t kHeldRoleSets = kHeldParts;

class LibraryQuestions {
public:
    LibraryQuestions();
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

    static nlohmann::json genre(const Snapshot& snapshot, const LibraryRoles& roles,
                                std::string_view name);

    size_t groupingBuilds() const { return groupingBuilds_; }

    struct Held;

private:
    std::shared_ptr<const AlbumGrouping> groupingFor(const Snapshot& snapshot,
                                                     const LibraryRoles& roles);
    std::shared_ptr<const CreditLessons> lessonsFor(const Snapshot& snapshot,
                                                    const LibraryRoles& roles);

    SearchParts searchPartsFor(const Snapshot& snapshot, const LibraryRoles& roles,
                               bool splitsCredits);

    Held& heldFor(const Snapshot& snapshot, const LibraryRoles& roles);

    std::mutex mutex_;
    uint64_t structure_ = 0;
    std::vector<std::shared_ptr<Held>> held_;
    std::atomic<size_t> groupingBuilds_{0};
};

}  // namespace jean
