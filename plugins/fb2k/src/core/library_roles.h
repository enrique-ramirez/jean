#pragma once

#include "third_party/httplib.h"

#include "core/library.h"

#include <array>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>

namespace jean {

struct LibraryRoles {
    std::optional<size_t> trackNumber, discNumber, title, artist, album, albumArtist, duration,
        playCount, lastPlayed, rating, year, genre, codec, bitrate, playCountLocal, lastPlayedLocal,
        added, artists, artistIds, albumArtists, albumArtistIds, artistSort;
};

using RoleField = std::optional<size_t> LibraryRoles::*;

struct RoleName {
    const char* name;
    RoleField field;
};

inline constexpr std::array kRoleNames{
    RoleName{"trackNumber", &LibraryRoles::trackNumber},
    RoleName{"discNumber", &LibraryRoles::discNumber},
    RoleName{"title", &LibraryRoles::title},
    RoleName{"artist", &LibraryRoles::artist},
    RoleName{"album", &LibraryRoles::album},
    RoleName{"albumArtist", &LibraryRoles::albumArtist},
    RoleName{"duration", &LibraryRoles::duration},
    RoleName{"playCount", &LibraryRoles::playCount},
    RoleName{"lastPlayed", &LibraryRoles::lastPlayed},
    RoleName{"rating", &LibraryRoles::rating},
    RoleName{"year", &LibraryRoles::year},
    RoleName{"genre", &LibraryRoles::genre},
    RoleName{"codec", &LibraryRoles::codec},
    RoleName{"bitrate", &LibraryRoles::bitrate},
    RoleName{"playCountLocal", &LibraryRoles::playCountLocal},
    RoleName{"lastPlayedLocal", &LibraryRoles::lastPlayedLocal},
    RoleName{"added", &LibraryRoles::added},
    RoleName{"artists", &LibraryRoles::artists},
    RoleName{"artistIds", &LibraryRoles::artistIds},
    RoleName{"albumArtists", &LibraryRoles::albumArtists},
    RoleName{"albumArtistIds", &LibraryRoles::albumArtistIds},
    RoleName{"artistSort", &LibraryRoles::artistSort},
};

inline constexpr std::array<std::string_view, kRoleNames.size()> kAllRoleNames = [] {
    std::array<std::string_view, kRoleNames.size()> names;
    for (size_t at = 0; at < names.size(); ++at)
        names[at] = kRoleNames[at].name;
    return names;
}();

inline constexpr size_t kSummaryRoleCount = [] {
    size_t at = 0;
    while (kAllRoleNames[at] != "artists")
        ++at;
    return at;
}();

inline constexpr std::array<std::string_view, kSummaryRoleCount> kSummaryRoleNames = [] {
    std::array<std::string_view, kSummaryRoleCount> names;
    for (size_t at = 0; at < names.size(); ++at)
        names[at] = kAllRoleNames[at];
    return names;
}();

struct RolesAsked {
    LibraryRefusal refusal = LibraryRefusal::none;
    std::string detail;
    std::map<std::string, std::string> expressions;

    bool ok() const { return refusal == LibraryRefusal::none; }
};

RolesAsked rolesAsked(const httplib::Request& req, std::span<const std::string_view> accepted,
                      std::span<const std::string_view> owned);

std::string rolesKey(const std::map<std::string, std::string>& roles);

std::optional<LibraryRoles> rolesIn(const Snapshot& snapshot,
                                    const std::map<std::string, std::string>& roles);

struct RolesVerdict {
    enum Kind { answerable, notYet, undeclared } kind = answerable;
    std::string expression;
};

RolesVerdict rolesVerdict(const Library::State& state, const std::vector<std::string>& declared,
                          const std::map<std::string, std::string>& expressions);

}  // namespace jean
