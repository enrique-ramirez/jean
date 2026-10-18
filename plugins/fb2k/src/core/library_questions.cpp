#include "core/library_questions.h"

#include "core/library.h"
#include "core/library_credits.h"
#include "core/library_entities.h"
#include "core/library_groups.h"
#include "core/ordinal_sets.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <iterator>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>

using nlohmann::json;

namespace jean {

using Roles = std::vector<std::optional<size_t>>;

namespace {

template <class Part>
struct Kept {
    std::vector<uint64_t> counts;
    std::shared_ptr<const Part> value;
};

}  // namespace

struct LibraryQuestions::Held {
    Roles roles;

    Kept<AlbumGrouping> grouping;
    Kept<CreditLessons> lessons;
    Kept<SearchText> text;
    Kept<SearchText> glyphs;
    Kept<AlbumEntities> albums;
    std::array<Kept<ArtistEntities>, 2> artists;
    Kept<GenreEntities> genres;
};

namespace {

std::vector<uint64_t> changeCountsOf(const Snapshot& snapshot, const Roles& roles) {
    std::vector<uint64_t> counts;
    counts.reserve(roles.size());
    std::transform(roles.begin(), roles.end(), std::back_inserter(counts),
                   [&](std::optional<size_t> role) {
                       return role ? snapshot.columns[*role].changeCount : uint64_t{0};
                   });
    return counts;
}

json pairOf(const Snapshot& snapshot) {
    return {{"structure", snapshot.structure}, {"revision", snapshot.revision}};
}

json withSet(json answer, const char* key, const std::vector<uint32_t>& ordinals,
             const Snapshot& snapshot) {
    answer[key] = ordinalSetDocument(ordinals, snapshot.trackCount());
    return answer;
}

std::shared_ptr<const AlbumGrouping> groupingOf(const Snapshot& snapshot,
                                                const LibraryRoles& roles) {
    auto grouping = std::make_shared<AlbumGrouping>();
    grouping->albumOfId = grouping->albums.over(snapshot, roles.album);
    grouping->albumArtistOfId = grouping->artists.over(snapshot, roles.albumArtist);
    grouping->artistOfId = grouping->artists.over(snapshot, roles.artist);
    return grouping;
}

struct Naming {
    bool member = false;
    bool guest = false;
};

Naming namings(const std::string& wanted, std::optional<std::string_view> credit,
               std::optional<std::string_view> names, std::optional<std::string_view> ids,
               const CreditLessons& lessons, bool guesses) {
    Naming naming;
    if (!credit)
        return naming;

    for (const Member& member : membersOf(*credit, names, ids, lessons, guesses)) {
        if (member.key == wanted)
            (member.isGuest ? naming.guest : naming.member) = true;
    }
    return naming;
}

struct Combination {
    uint32_t credit = kNoId;
    uint32_t names = kNoId;
    uint32_t ids = kNoId;
    bool guesses = false;

    bool operator==(const Combination&) const = default;
};

struct CombinationHash {
    size_t operator()(const Combination& combination) const {
        return static_cast<size_t>(splitMixFinalised(
            (uint64_t{combination.credit} << 32U) ^ (uint64_t{combination.names} * 31U) ^
            (uint64_t{combination.ids} << 1U) ^ (combination.guesses ? 1U : 0U)));
    }
};

struct CreditTags {
    std::string wanted;
    std::optional<size_t> credit, names, ids;
    std::unordered_map<Combination, Naming, CombinationHash> said;

    Naming of(const Snapshot& snapshot, const CreditLessons& lessons, size_t row, bool guesses) {
        const Combination combination{idAt(credit, snapshot, row), idAt(names, snapshot, row),
                                      idAt(ids, snapshot, row), guesses};
        const auto found = said.find(combination);
        if (found != said.end())
            return found->second;
        return said
            .emplace(combination, namings(wanted, cellOf(snapshot, credit, combination.credit),
                                          cellOf(snapshot, names, combination.names),
                                          cellOf(snapshot, ids, combination.ids), lessons, guesses))
            .first->second;
    }
};

template <class Test>
std::vector<char> flagged(const Snapshot& snapshot, std::optional<size_t> role, Test test) {
    if (!role)
        return {};
    const auto& values = snapshot.columns[*role].dictionary.values;
    std::vector<char> flags(values.size(), 0);
    for (size_t id = 0; id < values.size(); ++id)
        flags[id] = isPresent(values[id]) && test(values[id]) ? 1 : 0;
    return flags;
}

struct ArtistFlags {
    std::vector<char> leads, guestOn, albumArtists, hasIds, hasAlbumIds;
};

ArtistFlags artistFlagsOf(const Snapshot& snapshot, const LibraryRoles& roles,
                          const std::string& wanted) {
    const auto present = [](const std::string&) { return true; };
    ArtistFlags flags;
    flags.leads = flagged(snapshot, roles.artist, [&](const std::string& raw) {
        const CreditedArtists credited = creditedArtists(raw);
        return credited.lead && tagKey(*credited.lead) == wanted;
    });
    flags.guestOn = flagged(snapshot, roles.artist, [&](const std::string& raw) {
        const CreditedArtists credited = creditedArtists(raw);
        return std::any_of(credited.guests.begin(), credited.guests.end(),
                           [&](const std::string& one) { return tagKey(one) == wanted; });
    });
    flags.albumArtists = flagged(snapshot, roles.albumArtist, [&](const std::string& raw) {
        return tagKey(collapseRepeatedTag(raw)) == wanted;
    });
    flags.hasIds = flagged(snapshot, roles.artistIds, present);
    flags.hasAlbumIds = flagged(snapshot, roles.albumArtistIds, present);
    return flags;
}

struct ArtistSets {
    std::vector<uint32_t> own, shared, guest;
};

ArtistSets classifyArtist(const Snapshot& snapshot, const LibraryRoles& roles,
                          const std::string& wanted, bool splitsCredits,
                          const CreditLessons& lessons) {
    const ArtistFlags flags = artistFlagsOf(snapshot, roles, wanted);
    const auto leadOf = perValue(snapshot, roles.artist, flags.leads, char{0});
    const auto guestOf = perValue(snapshot, roles.artist, flags.guestOn, char{0});
    const auto albumArtistOf = perValue(snapshot, roles.albumArtist, flags.albumArtists, char{0});
    const auto idsOf = perValue(snapshot, roles.artistIds, flags.hasIds, char{0});
    const auto albumIdsOf = perValue(snapshot, roles.albumArtistIds, flags.hasAlbumIds, char{0});

    CreditTags artistTags{wanted, roles.artist, roles.artists, roles.artistIds, {}};
    CreditTags albumArtistTags{
        wanted, roles.albumArtist, roles.albumArtists, roles.albumArtistIds, {}};

    ArtistSets sets;
    for (size_t row = 0; row < snapshot.trackCount(); ++row) {
        const auto ordinal = static_cast<uint32_t>(row);
        if (leadOf.of(row) != 0 || albumArtistOf.of(row) != 0) {
            sets.own.push_back(ordinal);
            continue;
        }

        const bool guesses = splitsCredits && idsOf.of(row) == 0 && albumIdsOf.of(row) == 0;
        const Naming byArtist = artistTags.of(snapshot, lessons, row, guesses);
        const Naming byAlbumArtist = albumArtistTags.of(snapshot, lessons, row, guesses);
        if (byArtist.member || byAlbumArtist.member)
            sets.shared.push_back(ordinal);
        else if (guestOf.of(row) != 0 || byArtist.guest || byAlbumArtist.guest)
            sets.guest.push_back(ordinal);
    }
    return sets;
}

template <class Part, class Build>
std::shared_ptr<const Part> keep(Kept<Part>& slot, const Snapshot& snapshot, const Roles& read,
                                 std::atomic<size_t>& builds, Build build) {
    std::vector<uint64_t> counts = changeCountsOf(snapshot, read);
    if (!slot.value || slot.counts != counts) {
        slot.value = build();
        slot.counts = std::move(counts);
        ++builds;
    }
    return slot.value;
}

}  // namespace

LibraryQuestions::LibraryQuestions() = default;
LibraryQuestions::~LibraryQuestions() = default;

LibraryQuestions::Held& LibraryQuestions::heldFor(const Snapshot& snapshot,
                                                  const LibraryRoles& roles) {
    if (structure_ != snapshot.structure) {
        held_.clear();
        structure_ = snapshot.structure;
    }

    const Roles wanted{roles.title,      roles.artist,    roles.albumArtist,  roles.album,
                       roles.artists,    roles.artistIds, roles.albumArtists, roles.albumArtistIds,
                       roles.artistSort, roles.genre,     roles.discNumber,   roles.trackNumber};
    const auto found =
        std::find_if(held_.begin(), held_.end(),
                     [&](const std::shared_ptr<Held>& held) { return held->roles == wanted; });
    if (found != held_.end()) {
        std::rotate(found, std::next(found), held_.end());
        return *held_.back();
    }

    if (held_.size() >= kHeldRoleSets)
        held_.erase(held_.begin());
    held_.push_back(std::make_shared<Held>());
    held_.back()->roles = wanted;
    return *held_.back();
}

namespace {

std::shared_ptr<const AlbumGrouping> groupingIn(LibraryQuestions::Held& held,
                                                const Snapshot& snapshot, const LibraryRoles& roles,
                                                std::atomic<size_t>& builds) {
    return keep(held.grouping, snapshot, {roles.album, roles.albumArtist, roles.artist}, builds,
                [&] { return groupingOf(snapshot, roles); });
}

std::shared_ptr<const CreditLessons> lessonsIn(LibraryQuestions::Held& held,
                                               const Snapshot& snapshot, const LibraryRoles& roles,
                                               std::atomic<size_t>& builds) {
    return keep(held.lessons, snapshot,
                {roles.artist, roles.albumArtist, roles.artistIds, roles.albumArtistIds}, builds,
                [&] { return std::make_shared<const CreditLessons>(lessonsOf(snapshot, roles)); });
}

}  // namespace

std::shared_ptr<const AlbumGrouping> LibraryQuestions::groupingFor(const Snapshot& snapshot,
                                                                   const LibraryRoles& roles) {
    const std::lock_guard<std::mutex> lock(mutex_);
    return groupingIn(heldFor(snapshot, roles), snapshot, roles, groupingBuilds_);
}

std::shared_ptr<const CreditLessons> LibraryQuestions::lessonsFor(const Snapshot& snapshot,
                                                                  const LibraryRoles& roles) {
    const std::lock_guard<std::mutex> lock(mutex_);
    return lessonsIn(heldFor(snapshot, roles), snapshot, roles, groupingBuilds_);
}

SearchParts LibraryQuestions::searchPartsFor(const Snapshot& snapshot, const LibraryRoles& roles,
                                             bool splitsCredits) {
    const std::lock_guard<std::mutex> lock(mutex_);
    Held& held = heldFor(snapshot, roles);

    const Roles albumColumns{roles.album, roles.albumArtist, roles.artist, roles.discNumber,
                             roles.trackNumber};
    Roles artistColumns = albumColumns;
    artistColumns.insert(artistColumns.end(), {roles.artists, roles.artistIds, roles.albumArtists,
                                               roles.albumArtistIds, roles.artistSort});

    const auto searched = searchedColumns(roles);
    SearchParts parts;
    parts.text = keep(held.text, snapshot, Roles(searched.begin(), searched.end()), groupingBuilds_,
                      [&] { return searchTextOf(snapshot, roles); });
    const auto grouping = groupingIn(held, snapshot, roles, groupingBuilds_);
    parts.albums = keep(held.albums, snapshot, albumColumns, groupingBuilds_,
                        [&] { return albumEntitiesOf(snapshot, roles, *grouping); });
    const auto lessons = lessonsIn(held, snapshot, roles, groupingBuilds_);
    parts.artists =
        keep(held.artists[splitsCredits ? 1 : 0], snapshot, artistColumns, groupingBuilds_, [&] {
            return artistEntitiesOf(snapshot, roles, *grouping, *parts.albums, *lessons,
                                    splitsCredits);
        });
    parts.genres = keep(held.genres, snapshot, {roles.genre}, groupingBuilds_,
                        [&] { return genreEntitiesOf(snapshot, roles); });
    return parts;
}

std::shared_ptr<const SearchText> LibraryQuestions::glyphTextFor(const Snapshot& snapshot,
                                                                 const LibraryRoles& roles) {
    const std::lock_guard<std::mutex> lock(mutex_);
    Held& held = heldFor(snapshot, roles);
    const auto searched = searchedColumns(roles);
    return keep(held.glyphs, snapshot, Roles(searched.begin(), searched.end()), groupingBuilds_,
                [&] { return glyphTextOf(snapshot, roles); });
}

json LibraryQuestions::album(const Snapshot& snapshot, const LibraryRoles& roles,
                             std::string_view name, const std::optional<std::string>& by) {
    json answer = pairOf(snapshot);
    const auto nothing = [&] {
        answer["album"] = std::string(name);
        answer["artist"] = nullptr;
        return withSet(std::move(answer), "refs", {}, snapshot);
    };

    const std::string wantedAlbum = tagKey(name);
    if (wantedAlbum.empty())
        return nothing();

    const auto grouping = groupingFor(snapshot, roles);
    const auto albumFound = grouping->albums.byKey.find(wantedAlbum);
    if (albumFound == grouping->albums.byKey.end())
        return nothing();
    const int32_t albumGroup = albumFound->second;

    // A missing or empty `by` asks for the album credited to nobody, which is no group: a blank
    // credited name is a group of its own, and looking up "" would find it.
    int32_t artistGroup = -1;
    if (by && !by->empty()) {
        const auto artistFound = grouping->artists.byKey.find(tagKey(*by));
        if (artistFound != grouping->artists.byKey.end())
            artistGroup = artistFound->second;
    }

    const auto albumOf = perValue(snapshot, roles.album, grouping->albumOfId, int32_t{-1});
    const auto albumArtistOf =
        perValue(snapshot, roles.albumArtist, grouping->albumArtistOfId, int32_t{-1});
    const auto artistOf = perValue(snapshot, roles.artist, grouping->artistOfId, int32_t{-1});

    std::vector<uint32_t> refs;
    for (size_t row = 0; row < snapshot.trackCount(); ++row) {
        if (albumOf.of(row) != albumGroup)
            continue;
        const int32_t albumArtist = albumArtistOf.of(row);
        if ((albumArtist >= 0 ? albumArtist : artistOf.of(row)) == artistGroup)
            refs.push_back(static_cast<uint32_t>(row));
    }
    if (refs.empty())
        return nothing();

    answer["album"] = grouping->albums.names[static_cast<size_t>(albumGroup)];
    answer["artist"] = artistGroup < 0
                           ? json(nullptr)
                           : json(grouping->artists.names[static_cast<size_t>(artistGroup)]);
    return withSet(std::move(answer), "refs", refs, snapshot);
}

json LibraryQuestions::artist(const Snapshot& snapshot, const LibraryRoles& roles,
                              std::string_view name, bool splitsCredits) {
    const std::string wanted = tagKey(name);
    const ArtistSets sets = wanted.empty() ? ArtistSets{}
                                           : classifyArtist(snapshot, roles, wanted, splitsCredits,
                                                            *lessonsFor(snapshot, roles));

    json answer = pairOf(snapshot);
    answer = withSet(std::move(answer), "own", sets.own, snapshot);
    answer = withSet(std::move(answer), "shared", sets.shared, snapshot);
    return withSet(std::move(answer), "guest", sets.guest, snapshot);
}

json LibraryQuestions::genre(const Snapshot& snapshot, const LibraryRoles& roles,
                             std::string_view name) {
    std::vector<uint32_t> refs;
    const std::string wanted = tagKey(name);
    if (!wanted.empty() && roles.genre) {
        const std::vector<char> carries =
            flagged(snapshot, roles.genre, [&](const std::string& raw) {
                const auto values = splitOnValues(raw);
                return std::any_of(values.begin(), values.end(),
                                   [&](std::string_view one) { return tagKey(one) == wanted; });
            });
        const auto carriedBy = perValue(snapshot, roles.genre, carries, char{0});
        for (size_t row = 0; row < snapshot.trackCount(); ++row) {
            if (carriedBy.of(row) != 0)
                refs.push_back(static_cast<uint32_t>(row));
        }
    }
    return withSet(pairOf(snapshot), "refs", refs, snapshot);
}

}  // namespace jean
