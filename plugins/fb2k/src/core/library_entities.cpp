#include "core/library_entities.h"

#include "core/text.h"

#include <algorithm>
#include <iterator>
#include <numeric>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace jean {

namespace {

EntityKey entityKeyOf(std::string_view name) {
    EntityKey key;
    key.squashed = nameKey(name);
    key.length = utf16Length(key.squashed);
    key.words = nameWords(name);
    return key;
}

using Spelling = std::string (*)(std::string_view);

std::shared_ptr<const SearchText> spelledTextOf(const Snapshot& snapshot, const LibraryRoles& roles,
                                                Spelling spell) {
    auto text = std::make_shared<SearchText>();
    const auto searched = searchedColumns(roles);
    for (size_t at = 0; at < searched.size(); ++at) {
        std::vector<std::string>& spelled = text->folded[at];
        const std::optional<size_t> role = searched[at];
        if (!role) {
            spelled.emplace_back();
            continue;
        }
        const auto& values = snapshot.columns[*role].dictionary.values;
        spelled.reserve(values.size());
        std::transform(values.begin(), values.end(), std::back_inserter(spelled),
                       [spell](const std::string& value) {
                           return value == kUnresolved ? std::string() : spell(value);
                       });
    }
    return text;
}

}  // namespace

std::array<std::optional<size_t>, kSearchedColumnCount> searchedColumns(const LibraryRoles& roles) {
    return {roles.title, roles.artist, roles.albumArtist, roles.album, roles.artistSort};
}

std::shared_ptr<const SearchText> searchTextOf(const Snapshot& snapshot,
                                               const LibraryRoles& roles) {
    return spelledTextOf(snapshot, roles, fold);
}

std::shared_ptr<const SearchText> glyphTextOf(const Snapshot& snapshot, const LibraryRoles& roles) {
    return spelledTextOf(snapshot, roles, glyphs);
}

std::shared_ptr<const AlbumEntities> albumEntitiesOf(const Snapshot& snapshot,
                                                     const LibraryRoles& roles,
                                                     const AlbumGrouping& grouping) {
    struct Record {
        double disc = 0;
        double track = 0;
    };

    const auto discs = resolve<std::optional<double>>(snapshot, roles.discNumber, readOrdinal);
    const auto tracks = resolve<std::optional<double>>(snapshot, roles.trackNumber, readOrdinal);
    const auto albumOf = perValue(snapshot, roles.album, grouping.albumOfId, int32_t{-1});
    const auto albumArtistOf =
        perValue(snapshot, roles.albumArtist, grouping.albumArtistOfId, int32_t{-1});
    const auto artistOf = perValue(snapshot, roles.artist, grouping.artistOfId, int32_t{-1});

    auto albums = std::make_shared<AlbumEntities>();
    albums->recordOfRow.assign(snapshot.trackCount(), -1);
    std::unordered_map<uint64_t, int32_t> byPair;
    std::vector<Record> lowest;
    for (size_t row = 0; row < snapshot.trackCount(); ++row) {
        const int32_t group = albumOf.of(row);
        if (group < 0)
            continue;

        const int32_t credited = albumArtistOf.of(row);
        const int32_t artist = credited >= 0 ? credited : artistOf.of(row);
        const uint64_t pair =
            (static_cast<uint64_t>(group) << 32U) | static_cast<uint32_t>(artist + 1);
        const auto [at, fresh] =
            byPair.try_emplace(pair, static_cast<int32_t>(albums->entities.size()));
        if (fresh) {
            AlbumEntities::Entity entity;
            entity.album = grouping.albums.names[static_cast<size_t>(group)];
            if (artist >= 0)
                entity.artist = grouping.artists.names[static_cast<size_t>(artist)];
            entity.match = entityKeyOf(entity.album);
            entity.coverRow = static_cast<uint32_t>(row);
            albums->entities.push_back(std::move(entity));
            lowest.push_back({discs.of(row).value_or(0), tracks.of(row).value_or(0)});
        }
        albums->recordOfRow[row] = at->second;

        const auto record = static_cast<size_t>(at->second);
        AlbumEntities::Entity& entity = albums->entities[record];
        ++entity.trackCount;
        const double disc = discs.of(row).value_or(0);
        const double track = tracks.of(row).value_or(0);
        if (disc < lowest[record].disc ||
            (disc == lowest[record].disc && track < lowest[record].track)) {
            lowest[record] = {disc, track};
            entity.coverRow = static_cast<uint32_t>(row);
        }
    }
    return albums;
}

namespace {

bool namesAnArtist(const std::string& key) {
    return !key.empty() && key != "various artists" && key != "various" && key != "va";
}

struct ArtistDraft {
    ArtistEntities::Entity entity;
    std::unordered_set<int32_t> albums;
    std::optional<uint32_t> firstAlbumRow;
};

struct ArtistCredit {
    uint32_t draft = 0;
    bool isGuest = false;
};

using ArtistTags = std::array<uint32_t, 6>;

struct ArtistTagsHash {
    size_t operator()(const ArtistTags& tags) const {
        uint64_t hash = 0;
        for (const uint32_t id : tags)
            hash = splitMixFinalised(hash ^ id);
        return static_cast<size_t>(hash);
    }
};

class ArtistCredits {
public:
    ArtistCredits(const Snapshot& snapshot, const LibraryRoles& roles, const CreditLessons& lessons,
                  bool splitsCredits)
        : snapshot_(snapshot), roles_(roles), lessons_(lessons), splitsCredits_(splitsCredits) {}

    std::vector<ArtistDraft>& drafts() { return drafts_; }

    const std::vector<ArtistCredit>& of(const ArtistTags& tags) {
        const auto found = recipes_.find(tags);
        return found != recipes_.end() ? found->second
                                       : recipes_.emplace(tags, recipeOf(tags)).first->second;
    }

private:
    uint32_t draftFor(const Named& named) {
        const auto [at, fresh] =
            draftOfKey_.try_emplace(named.key, static_cast<uint32_t>(drafts_.size()));
        if (fresh) {
            ArtistDraft draft;
            draft.entity.name = named.name;
            draft.entity.match = entityKeyOf(named.name);
            drafts_.push_back(std::move(draft));
        }
        return at->second;
    }

    static Named namedBy(std::string_view name) { return {std::string(name), tagKey(name)}; }

    std::vector<ArtistCredit> recipeOf(const ArtistTags& tags) {
        const auto artist = cellOf(snapshot_, roles_.artist, tags[0]);
        const auto artistNames = cellOf(snapshot_, roles_.artists, tags[1]);
        const auto artistIds = cellOf(snapshot_, roles_.artistIds, tags[2]);
        const auto albumArtist = cellOf(snapshot_, roles_.albumArtist, tags[3]);
        const auto albumArtistNames = cellOf(snapshot_, roles_.albumArtists, tags[4]);
        const auto albumArtistIds = cellOf(snapshot_, roles_.albumArtistIds, tags[5]);
        const bool guesses = splitsCredits_ && !artistIds && !albumArtistIds;

        std::vector<Named> leads;
        std::vector<Named> guests;
        const CreditedArtists credited = artist ? creditedArtists(*artist) : CreditedArtists{};
        if (credited.lead && namesAnArtist(tagKey(*credited.lead)))
            leads.push_back(namedBy(*credited.lead));
        for (const std::string& guest : credited.guests) {
            if (namesAnArtist(tagKey(guest)))
                guests.push_back(namedBy(guest));
        }
        if (albumArtist) {
            const std::string act = collapseRepeatedTag(*albumArtist);
            if (namesAnArtist(tagKey(act)))
                leads.push_back(namedBy(act));
        }

        std::vector<Member> shared;
        if (artist)
            shared = membersOf(*artist, artistNames, artistIds, lessons_, guesses);
        if (albumArtist) {
            const std::vector<Member> more =
                membersOf(*albumArtist, albumArtistNames, albumArtistIds, lessons_, guesses);
            shared.insert(shared.end(), more.begin(), more.end());
        }
        for (const Member& member : shared) {
            if (!member.isGuest)
                leads.push_back({member.name, member.key});
        }

        std::vector<ArtistCredit> credits;
        std::unordered_set<std::string> seen;
        for (const Named& lead : leads) {
            if (seen.insert(lead.key).second)
                credits.push_back({draftFor(lead), false});
        }
        for (const Member& member : shared) {
            if (member.isGuest)
                guests.push_back({member.name, member.key});
        }
        for (const Named& guest : guests) {
            if (seen.insert(guest.key).second)
                credits.push_back({draftFor(guest), true});
        }
        return credits;
    }

    const Snapshot& snapshot_;
    const LibraryRoles& roles_;
    const CreditLessons& lessons_;
    bool splitsCredits_;

    std::vector<ArtistDraft> drafts_;
    std::unordered_map<std::string, uint32_t> draftOfKey_;
    std::unordered_map<ArtistTags, std::vector<ArtistCredit>, ArtistTagsHash> recipes_;
};

}  // namespace

std::shared_ptr<const ArtistEntities> artistEntitiesOf(
    const Snapshot& snapshot, const LibraryRoles& roles, const AlbumGrouping& grouping,
    const AlbumEntities& albums, const CreditLessons& lessons, bool splitsCredits) {
    ArtistCredits credits(snapshot, roles, lessons, splitsCredits);
    const std::array<std::optional<size_t>, 6> columns{roles.artist,       roles.artists,
                                                       roles.artistIds,    roles.albumArtist,
                                                       roles.albumArtists, roles.albumArtistIds};
    const auto albumOf = perValue(snapshot, roles.album, grouping.albumOfId, int32_t{-1});

    for (size_t row = 0; row < snapshot.trackCount(); ++row) {
        ArtistTags tags{};
        for (size_t at = 0; at < columns.size(); ++at)
            tags[at] = idAt(columns[at], snapshot, row);

        const int32_t album = albumOf.of(row);
        const bool albumed = album >= 0 && !grouping.albums.blank[static_cast<size_t>(album)];
        const std::vector<ArtistCredit>& credited = credits.of(tags);
        for (const ArtistCredit& credit : credited) {
            ArtistDraft& draft = credits.drafts()[credit.draft];
            ++(credit.isGuest ? draft.entity.guestCount : draft.entity.trackCount);
            if (albumed && draft.albums.insert(album).second && draft.albums.size() == 1)
                draft.firstAlbumRow = static_cast<uint32_t>(row);
        }

        if (credited.size() != 1 || credited.front().isGuest)
            continue;
        ArtistDraft& sole = credits.drafts()[credited.front().draft];
        if (sole.entity.sortMatch)
            continue;
        const auto sortName =
            cellOf(snapshot, roles.artistSort, idAt(roles.artistSort, snapshot, row));
        if (sortName)
            sole.entity.sortMatch = entityKeyOf(*sortName);
    }

    auto artists = std::make_shared<ArtistEntities>();
    artists->entities.reserve(credits.drafts().size());
    for (ArtistDraft& draft : credits.drafts()) {
        draft.entity.albumCount = static_cast<uint32_t>(draft.albums.size());
        if (draft.firstAlbumRow)
            draft.entity.coverRow = albums.coverRowOf(*draft.firstAlbumRow);
        artists->entities.push_back(std::move(draft.entity));
    }
    std::stable_sort(artists->entities.begin(), artists->entities.end(),
                     [](const ArtistEntities::Entity& a, const ArtistEntities::Entity& b) {
                         return a.trackCount > b.trackCount;
                     });
    return artists;
}

std::shared_ptr<const GenreEntities> genreEntitiesOf(const Snapshot& snapshot,
                                                     const LibraryRoles& roles) {
    auto genres = std::make_shared<GenreEntities>();
    if (!roles.genre)
        return genres;

    const Column& column = snapshot.columns[*roles.genre];
    const auto& values = column.dictionary.values;

    TagGroups groups;
    std::vector<std::vector<int32_t>> groupsOfId(values.size());
    std::vector<uint32_t> rowsOfId(values.size(), 0);
    for (const uint32_t id : column.ids)
        ++rowsOfId[id];

    for (size_t id = 0; id < values.size(); ++id) {
        if (rowsOfId[id] == 0 || !isPresent(values[id]))
            continue;
        for (const std::string_view one : splitOnValues(values[id])) {
            const std::string key = tagKey(one);
            if (key.empty())
                continue;
            const int32_t group = groups.add(key, one);
            std::vector<int32_t>& own = groupsOfId[id];
            if (std::find(own.begin(), own.end(), group) == own.end())
                own.push_back(group);
        }
    }

    std::vector<std::string> keys(groups.names.size());
    for (const auto& [key, group] : groups.byKey)
        keys[static_cast<size_t>(group)] = key;

    genres->entities.resize(groups.names.size());
    for (size_t group = 0; group < groups.names.size(); ++group) {
        genres->entities[group].name = groups.names[group];
        genres->entities[group].match = entityKeyOf(groups.names[group]);
    }
    for (size_t id = 0; id < values.size(); ++id) {
        for (const int32_t group : groupsOfId[id])
            genres->entities[static_cast<size_t>(group)].trackCount += rowsOfId[id];
    }

    std::vector<size_t> order(keys.size());
    std::iota(order.begin(), order.end(), size_t{0});
    std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        const uint32_t one = genres->entities[a].trackCount;
        const uint32_t other = genres->entities[b].trackCount;
        return one != other ? one > other : utf16Before(keys[a], keys[b]);
    });
    std::vector<GenreEntities::Entity> sorted;
    sorted.reserve(order.size());
    for (const size_t group : order)
        sorted.push_back(std::move(genres->entities[group]));
    genres->entities = std::move(sorted);
    return genres;
}

}  // namespace jean
