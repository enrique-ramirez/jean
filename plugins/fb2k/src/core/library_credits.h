#pragma once

#include "core/library.h"
#include "core/library_roles.h"

#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace jean {

std::vector<std::string_view> splitOnValues(std::string_view text);

size_t valueCount(std::string_view raw);

std::string collapseRepeatedTag(std::string_view value);

struct CreditedArtists {
    std::optional<std::string> lead;
    std::vector<std::string> guests;
};

CreditedArtists creditedArtists(std::string_view artist);

struct Named {
    std::string name;
    std::string key;
};

struct Member {
    std::string name;
    std::string key;
    bool isGuest = false;
};

struct CreditLessons {
    std::unordered_map<std::string, Named> nameOfId;
    std::unordered_set<std::string> standalone;
};

CreditLessons lessonsOf(const Snapshot& snapshot, const LibraryRoles& roles);

std::vector<Member> membersOf(std::string_view credit, std::optional<std::string_view> names,
                              std::optional<std::string_view> ids, const CreditLessons& lessons,
                              bool guesses);

}  // namespace jean
