#include "core/library_questions.h"

#include "core/library.h"
#include "core/library_credits.h"
#include "core/library_entities.h"
#include "core/library_groups.h"
#include "core/library_sets.h"
#include "core/local_time.h"
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

    void reset() { value.reset(); }
};

}  // namespace

struct HeldCredits {
    Credits credits;
    std::array<const void*, 3> boundTo{};
};

struct HeldAlbums {
    std::shared_ptr<const HeldCredits> credits;
    AlbumRecords records;
};

struct CompletionValues {
    struct Value {
        std::string name;
        std::string folded;
    };

    std::vector<Value> sorted;
};

struct LibraryQuestions::Held {
    Roles roles;

    Kept<AlbumGrouping> grouping;
    Kept<HeldCredits> credits;
    Kept<HeldAlbums> albumRecords;
    Kept<CreditLessons> lessons;
    Kept<SearchText> text;
    Kept<SearchText> glyphs;
    Kept<AlbumEntities> albums;
    std::array<Kept<ArtistEntities>, 2> artists;
    Kept<GenreEntities> genres;
    std::array<Kept<CompletionValues>, 4> completions;
};

namespace {

json pairOf(const Snapshot& snapshot) {
    return {{"structure", snapshot.structure}, {"revision", snapshot.revision}};
}

json withSet(json answer, const char* key, const std::vector<uint32_t>& ordinals,
             const Snapshot& snapshot) {
    answer[key] = ordinalSetDocument(ordinals, snapshot.trackCount());
    return answer;
}

json withFigures(json answer, const Snapshot& snapshot, const LibraryRoles& roles,
                 const Credits& credits, const std::vector<uint32_t>& ordinals) {
    answer["figures"] = figuresDocument(figuresOver(snapshot, roles, credits, ordinals));
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
    std::vector<uint64_t> counts;
    counts.reserve(read.size());
    changeCountsOf(snapshot, read, std::back_inserter(counts));
    if (!slot.value || slot.counts != counts) {
        slot.value = build();
        slot.counts = std::move(counts);
        ++builds;
    }
    return slot.value;
}

}  // namespace

LibraryQuestions::LibraryQuestions() : LibraryQuestions(systemLocalTime()) {}
LibraryQuestions::LibraryQuestions(LocalTime local) : local_(std::move(local)) {}
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

std::shared_ptr<const HeldCredits> creditsIn(LibraryQuestions::Held& held, const Snapshot& snapshot,
                                             const LibraryRoles& roles,
                                             std::atomic<size_t>& builds) {
    const auto idsOf = [&](std::optional<size_t> role) -> const void* {
        return role ? &snapshot.columns[*role].ids : nullptr;
    };
    const std::array<const void*, 3> where{idsOf(roles.album), idsOf(roles.albumArtist),
                                           idsOf(roles.artist)};
    const auto build = [&] {
        auto built = std::make_shared<HeldCredits>();
        built->credits = creditsOf(snapshot, roles);
        built->boundTo = where;
        return std::shared_ptr<const HeldCredits>(std::move(built));
    };
    const Roles read{roles.album, roles.albumArtist, roles.artist};

    auto kept = keep(held.credits, snapshot, read, builds, build);
    if (kept->boundTo != where) {
        held.credits.reset();
        kept = keep(held.credits, snapshot, read, builds, build);
    }
    return kept;
}

std::shared_ptr<const HeldAlbums> albumRecordsIn(LibraryQuestions::Held& held,
                                                 const Snapshot& snapshot,
                                                 const LibraryRoles& roles,
                                                 std::atomic<size_t>& creditBuilds,
                                                 std::atomic<size_t>& albumBuilds) {
    const auto credits = creditsIn(held, snapshot, roles, creditBuilds);
    const Roles read{roles.album, roles.albumArtist, roles.artist, roles.discNumber,
                     roles.trackNumber};
    const auto build = [&] {
        auto built = std::make_shared<HeldAlbums>();
        built->credits = credits;
        built->records = albumRecordsOf(snapshot, roles, credits->credits);
        return std::shared_ptr<const HeldAlbums>(std::move(built));
    };

    auto kept = keep(held.albumRecords, snapshot, read, albumBuilds, build);
    if (kept->credits != credits) {
        held.albumRecords.reset();
        kept = keep(held.albumRecords, snapshot, read, albumBuilds, build);
    }
    return kept;
}

std::shared_ptr<const SearchText> textIn(LibraryQuestions::Held& held, const Snapshot& snapshot,
                                         const LibraryRoles& roles, std::atomic<size_t>& builds) {
    const auto searched = searchedColumns(roles);
    return keep(held.text, snapshot, Roles(searched.begin(), searched.end()), builds,
                [&] { return searchTextOf(snapshot, roles); });
}

}  // namespace

std::shared_ptr<const HeldCredits> LibraryQuestions::creditsFor(const Snapshot& snapshot,
                                                                const LibraryRoles& roles) {
    const std::lock_guard<std::mutex> lock(mutex_);
    return creditsIn(heldFor(snapshot, roles), snapshot, roles, creditBuilds_);
}

std::vector<uint32_t> LibraryQuestions::coverOrdinals(const Snapshot& snapshot,
                                                      const LibraryRoles& roles,
                                                      const std::vector<uint32_t>& ordinals) {
    std::shared_ptr<const HeldAlbums> held;
    {
        const std::lock_guard<std::mutex> lock(mutex_);
        held =
            albumRecordsIn(heldFor(snapshot, roles), snapshot, roles, creditBuilds_, albumBuilds_);
    }

    std::vector<uint32_t> covers;
    covers.reserve(ordinals.size());
    std::transform(ordinals.begin(), ordinals.end(), std::back_inserter(covers),
                   [&](uint32_t ordinal) {
                       const auto record = held->records.index.of(held->credits->credits, ordinal);
                       return record ? held->records.list[*record].cover : ordinal;
                   });
    return covers;
}

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

    SearchParts parts;
    parts.text = textIn(held, snapshot, roles, groupingBuilds_);
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

std::shared_ptr<const SearchText> LibraryQuestions::searchTextFor(const Snapshot& snapshot,
                                                                  const LibraryRoles& roles) {
    const std::lock_guard<std::mutex> lock(mutex_);
    return textIn(heldFor(snapshot, roles), snapshot, roles, groupingBuilds_);
}

std::shared_ptr<const SearchText> LibraryQuestions::glyphTextFor(const Snapshot& snapshot,
                                                                 const LibraryRoles& roles) {
    const std::lock_guard<std::mutex> lock(mutex_);
    Held& held = heldFor(snapshot, roles);
    const auto searched = searchedColumns(roles);
    return keep(held.glyphs, snapshot, Roles(searched.begin(), searched.end()), groupingBuilds_,
                [&] { return glyphTextOf(snapshot, roles); });
}

namespace {

Roles completionColumns(const LibraryRoles& roles, ValueField field) {
    switch (field) {
        case ValueField::artist:
            return {roles.artist};
        case ValueField::albumArtist:
            return {roles.albumArtist};
        case ValueField::album:
            return {roles.album};
        case ValueField::genre:
            return {roles.genre};
    }
    return {};
}

std::optional<SearchedColumn> searchedColumnOf(ValueField field) {
    switch (field) {
        case ValueField::artist:
            return kSearchedArtist;
        case ValueField::albumArtist:
            return kSearchedAlbumArtist;
        case ValueField::album:
            return kSearchedAlbum;
        case ValueField::genre:
            return std::nullopt;
    }
    return std::nullopt;
}

std::shared_ptr<CompletionValues> completionOfTags(const Snapshot& snapshot,
                                                   std::optional<size_t> role,
                                                   const std::vector<std::string>& folded) {
    auto completion = std::make_shared<CompletionValues>();
    TagGroups groups;
    const std::vector<int32_t> groupOfId = groups.over(snapshot, role);
    std::vector<char> offered(groups.names.size(), 0);
    for (size_t id = 0; id < groupOfId.size(); ++id) {
        const int32_t group = groupOfId[id];
        if (group < 0 || groups.blank[static_cast<size_t>(group)] ||
            offered[static_cast<size_t>(group)] != 0)
            continue;
        offered[static_cast<size_t>(group)] = 1;
        completion->sorted.push_back({groups.names[static_cast<size_t>(group)], folded[id]});
    }
    return completion;
}

std::shared_ptr<CompletionValues> completionOfGenres(const Snapshot& snapshot,
                                                     std::optional<size_t> role) {
    auto completion = std::make_shared<CompletionValues>();
    const GenreGroups genres = genreGroupsOf(snapshot, role);
    for (const std::string& name : genres.tags.names)
        completion->sorted.push_back({name, fold(name)});
    return completion;
}

}  // namespace

std::shared_ptr<const CompletionValues> LibraryQuestions::completionFor(const Snapshot& snapshot,
                                                                        const LibraryRoles& roles,
                                                                        ValueField field) {
    const std::lock_guard<std::mutex> lock(mutex_);
    Held& held = heldFor(snapshot, roles);
    const auto build = [&]() -> std::shared_ptr<const CompletionValues> {
        std::shared_ptr<CompletionValues> built;
        if (const auto folded = searchedColumnOf(field)) {
            const auto text = textIn(held, snapshot, roles, groupingBuilds_);
            built = completionOfTags(snapshot, completionColumns(roles, field).front(),
                                     text->folded[*folded]);
        } else {
            built = completionOfGenres(snapshot, roles.genre);
        }
        std::sort(built->sorted.begin(), built->sorted.end(),
                  [](const auto& a, const auto& b) { return a.name < b.name; });
        return built;
    };
    return keep(held.completions[static_cast<size_t>(field)], snapshot,
                completionColumns(roles, field), groupingBuilds_, build);
}

json LibraryQuestions::album(const Snapshot& snapshot, const LibraryRoles& roles,
                             std::string_view name, const std::optional<std::string>& by) {
    json answer = pairOf(snapshot);
    const auto nothing = [&] {
        answer["album"] = std::string(name);
        answer["artist"] = nullptr;
        answer["figures"] = figuresDocument({});
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
    return withFigures(withSet(std::move(answer), "refs", refs, snapshot), snapshot, roles,
                       creditsFor(snapshot, roles)->credits, refs);
}

json LibraryQuestions::artist(const Snapshot& snapshot, const LibraryRoles& roles,
                              std::string_view name, bool splitsCredits) {
    const std::string wanted = tagKey(name);
    const ArtistSets sets = wanted.empty() ? ArtistSets{}
                                           : classifyArtist(snapshot, roles, wanted, splitsCredits,
                                                            *lessonsFor(snapshot, roles));

    std::vector<uint32_t> all;
    all.reserve(sets.own.size() + sets.shared.size() + sets.guest.size());
    for (const auto* part : {&sets.own, &sets.shared, &sets.guest})
        all.insert(all.end(), part->begin(), part->end());
    std::sort(all.begin(), all.end());

    const auto held = creditsFor(snapshot, roles);
    const Credits& credits = held->credits;
    json answer = pairOf(snapshot);
    answer = withSet(std::move(answer), "own", sets.own, snapshot);
    answer = withSet(std::move(answer), "shared", sets.shared, snapshot);
    answer = withSet(std::move(answer), "guest", sets.guest, snapshot);
    answer["figures"] = figuresDocument(figuresOver(snapshot, roles, credits, all));
    answer["cards"] = cardsDocument(cardsOver(snapshot, roles, all, local_));
    answer["records"] = {
        {"own", recordsDocument(snapshot, recordsOver(snapshot, roles, credits, sets.own))},
        {"shared", recordsDocument(snapshot, recordsOver(snapshot, roles, credits, sets.shared))}};
    return answer;
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
    return withFigures(withSet(pairOf(snapshot), "refs", refs, snapshot), snapshot, roles,
                       creditsFor(snapshot, roles)->credits, refs);
}

json LibraryQuestions::credits(const Snapshot& snapshot, const LibraryRoles& roles,
                               uint32_t ordinal, bool splitsCredits) {
    const auto lessons = lessonsFor(snapshot, roles);
    const auto cellAt = [&](std::optional<size_t> role) {
        return cellOf(snapshot, role, idAt(role, snapshot, ordinal));
    };

    const bool guesses = splitsCredits && !cellAt(roles.artistIds) && !cellAt(roles.albumArtistIds);
    const auto membersOfCredit = [&](std::optional<size_t> credit, std::optional<size_t> names,
                                     std::optional<size_t> ids) {
        json members = json::array();
        const auto named = cellAt(credit);
        if (!named)
            return members;
        for (const Member& member :
             membersOf(*named, cellAt(names), cellAt(ids), *lessons, guesses))
            members.push_back(
                {{"name", member.name}, {"key", member.key}, {"isGuest", member.isGuest}});
        return members;
    };

    json answer = pairOf(snapshot);
    answer["artist"] = membersOfCredit(roles.artist, roles.artists, roles.artistIds);
    answer["albumArtist"] =
        membersOfCredit(roles.albumArtist, roles.albumArtists, roles.albumArtistIds);
    return answer;
}

json LibraryQuestions::values(const Snapshot& snapshot, const LibraryRoles& roles, ValueField field,
                              std::string_view prefix, size_t limit) {
    const auto offered = completionFor(snapshot, roles, field);
    const std::string folded = fold(prefix);

    json names = json::array();
    for (const auto& value : offered->sorted) {
        if (names.size() >= limit)
            break;
        if (value.folded.starts_with(folded))
            names.push_back(value.name);
    }

    json answer = pairOf(snapshot);
    answer["values"] = std::move(names);
    return answer;
}

}  // namespace jean
