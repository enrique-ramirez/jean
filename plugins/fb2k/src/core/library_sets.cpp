#include "core/library_sets.h"

#include "core/text.h"

#include <algorithm>
#include <numeric>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace jean {

namespace {

using Json = nlohmann::ordered_json;

constexpr size_t kTopGenres = 4;
constexpr size_t kCoversPerTile = 2;
constexpr double kPercent = 100;
constexpr std::string_view kUnknownArtist = "Unknown";

template <class Read>
std::optional<double> readAt(const Snapshot& snapshot, std::optional<size_t> role, size_t row,
                             Read read) {
    if (!role)
        return std::nullopt;
    const Column& column = snapshot.columns[*role];
    return read(column.dictionary.values[column.ids[row]]);
}

std::optional<double> playsAt(const Snapshot& snapshot, const LibraryRoles& roles, size_t row) {
    return higherOf(readAt(snapshot, roles.playCount, row, readPlayCount),
                    readAt(snapshot, roles.playCountLocal, row, readPlayCount));
}

std::optional<double> lastPlayedAt(const Snapshot& snapshot, const LibraryRoles& roles, size_t row,
                                   const LocalTime& local) {
    const auto moment = [&local](std::string_view raw) { return readPlayMoment(raw, local); };
    return higherOf(readAt(snapshot, roles.lastPlayed, row, moment),
                    readAt(snapshot, roles.lastPlayedLocal, row, moment));
}

std::optional<double> releaseYearAt(const Snapshot& snapshot, const LibraryRoles& roles,
                                    size_t row) {
    const auto year = readAt(snapshot, roles.year, row, readNumber);
    return year && *year > kFirstRealYear ? year : std::nullopt;
}

std::string titleAt(const Snapshot& snapshot, const LibraryRoles& roles, size_t row) {
    const auto title = cellOf(snapshot, roles.title, idAt(roles.title, snapshot, row));
    return title ? std::string(*title) : std::string();
}

std::optional<uint64_t> albumPairAt(const Credits& credits, size_t row) {
    const int32_t group = credits.albumGroup.of(row);
    if (group < 0)
        return std::nullopt;
    return albumPairOf(group, artistKeyOf(credits, row));
}

Json textJson(const std::optional<std::string>& text) {
    return text ? Json(*text) : Json(nullptr);
}

}  // namespace

std::optional<double> earliestOf(std::optional<double> held, double value) {
    return held ? std::min(*held, value) : value;
}

std::optional<double> latestOf(std::optional<double> held, double value) {
    return held ? std::max(*held, value) : value;
}

SetFigures figuresOver(const Snapshot& snapshot, const LibraryRoles& roles, const Credits& credits,
                       std::span<const uint32_t> ordinals) {
    SetFigures figures;
    figures.trackCount = ordinals.size();

    std::unordered_set<uint64_t> albums;
    for (const uint32_t row : ordinals) {
        figures.seconds += readAt(snapshot, roles.duration, row, readNumber).value_or(0);

        if (const auto year = releaseYearAt(snapshot, roles, row)) {
            figures.earliestYear = earliestOf(figures.earliestYear, *year);
            figures.latestYear = latestOf(figures.latestYear, *year);
        }

        if (const auto pair = albumPairAt(credits, row))
            albums.insert(*pair);
    }
    figures.albumCount = albums.size();
    return figures;
}

SetFigures figuresOver(const Snapshot& snapshot, const LibraryRoles& roles,
                       std::span<const uint32_t> ordinals) {
    if (ordinals.empty())
        return {};
    return figuresOver(snapshot, roles, creditsOf(snapshot, roles), ordinals);
}

std::vector<GenreShare> topGenresOf(const std::vector<std::string>& names,
                                    const std::vector<size_t>& counts, std::vector<int32_t> order,
                                    size_t total, size_t limit) {
    std::stable_sort(order.begin(), order.end(), [&counts](int32_t a, int32_t b) {
        return counts[static_cast<size_t>(a)] > counts[static_cast<size_t>(b)];
    });

    std::vector<GenreShare> top;
    for (size_t at = 0; at < std::min(limit, order.size()); ++at) {
        const auto group = static_cast<size_t>(order[at]);
        top.push_back({names[group], counts[group],
                       static_cast<int>(roundHalfUp(static_cast<double>(counts[group]) /
                                                    static_cast<double>(total) * kPercent))});
    }
    return top;
}

ArtistCards cardsOver(const Snapshot& snapshot, const LibraryRoles& roles,
                      std::span<const uint32_t> ordinals, const LocalTime& local) {
    ArtistCards cards;
    if (ordinals.empty())
        return cards;

    const GenreGroups genres = genreGroupsOf(snapshot, roles.genre);
    std::vector<size_t> counts(genres.tags.names.size(), 0);
    std::vector<int32_t> seen;

    for (const uint32_t row : ordinals) {
        const double count = playsAt(snapshot, roles, row).value_or(0);
        cards.plays += count;
        if (count == 0)
            ++cards.neverPlayed;
        else if (count > 0 && (!cards.mostPlayed || count > cards.mostPlayed->plays))
            cards.mostPlayed = MostPlayedTrack{row, titleAt(snapshot, roles, row), count};

        if (const auto played = lastPlayedAt(snapshot, roles, row, local))
            cards.lastPlayed = latestOf(cards.lastPlayed, *played);

        for (const int32_t group : genres.of.of(row)) {
            if (counts[static_cast<size_t>(group)]++ == 0)
                seen.push_back(group);
        }
    }

    const auto size = static_cast<double>(ordinals.size());
    cards.playedShare = (size - static_cast<double>(cards.neverPlayed)) / size;

    cards.topGenres =
        topGenresOf(genres.tags.names, counts, std::move(seen), ordinals.size(), kTopGenres);
    return cards;
}

std::vector<RecordInSet> recordsOver(const Snapshot& snapshot, const LibraryRoles& roles,
                                     std::span<const uint32_t> ordinals) {
    if (ordinals.empty())
        return {};
    return recordsOver(snapshot, roles, creditsOf(snapshot, roles), ordinals);
}

std::vector<RecordInSet> recordsOver(const Snapshot& snapshot, const LibraryRoles& roles,
                                     const Credits& credits, std::span<const uint32_t> ordinals) {
    std::vector<RecordInSet> records;
    std::unordered_map<uint64_t, size_t> recordOf;
    for (const uint32_t row : ordinals) {
        const auto pair = albumPairAt(credits, row);
        if (!pair)
            continue;

        const auto [at, fresh] = recordOf.try_emplace(*pair, records.size());
        if (fresh) {
            const int32_t artist = credits.creditedArtist(row);
            RecordInSet record;
            record.album = credits.albums.names[static_cast<size_t>(credits.albumGroup.of(row))];
            if (artist >= 0)
                record.artist = credits.artists.names[static_cast<size_t>(artist)];
            record.cover = row;
            records.push_back(std::move(record));
        }

        RecordInSet& record = records[at->second];
        ++record.trackCount;
        if (const auto year = releaseYearAt(snapshot, roles, row))
            record.year = earliestOf(record.year, *year);
    }

    std::stable_sort(records.begin(), records.end(),
                     [](const RecordInSet& a, const RecordInSet& b) {
                         return b.year.value_or(0) < a.year.value_or(0);
                     });
    return records;
}

std::vector<GenreTile> genreTilesOf(const Snapshot& snapshot, const LibraryRoles& roles,
                                    const Credits& credits) {
    const GenreGroups genres = genreGroupsOf(snapshot, roles.genre);
    if (genres.tags.names.empty())
        return {};

    struct Album {
        uint32_t first = 0;
        size_t tracks = 0;
    };
    struct Draft {
        size_t count = 0;
        std::vector<Album> albums;
        std::unordered_map<uint32_t, size_t> albumOf;
        std::unordered_set<int32_t> artists;
    };
    std::vector<Draft> drafts(genres.tags.names.size());

    std::unordered_map<std::string, uint32_t> recordIds;
    std::unordered_map<uint64_t, uint32_t> recordOfPair;
    const auto recordAt = [&](size_t row) -> std::optional<uint32_t> {
        const int32_t album = credits.albumGroup.of(row);
        if (album < 0)
            return std::nullopt;

        const int32_t artist = credits.creditedArtist(row);
        const auto [known, fresh] = recordOfPair.try_emplace(albumPairOf(album, artist), 0);
        if (fresh) {
            const std::string_view credited =
                artist < 0 ? kUnknownArtist : credits.artists.names[static_cast<size_t>(artist)];
            const std::string key = tagKey(std::string(credited) + " " +
                                           credits.albums.names[static_cast<size_t>(album)]);
            known->second =
                recordIds.try_emplace(key, static_cast<uint32_t>(recordIds.size())).first->second;
        }
        return known->second;
    };

    for (size_t row = 0; row < snapshot.trackCount(); ++row) {
        const auto& groups = genres.of.of(row);
        if (groups.empty())
            continue;

        const auto record = recordAt(row);
        const int32_t artist = credits.creditedArtist(row);
        for (const int32_t group : groups) {
            Draft& draft = drafts[static_cast<size_t>(group)];
            ++draft.count;
            if (artist >= 0)
                draft.artists.insert(artist);
            if (!record)
                continue;

            const auto [at, fresh] = draft.albumOf.try_emplace(*record, draft.albums.size());
            if (fresh)
                draft.albums.push_back({static_cast<uint32_t>(row), 0});
            ++draft.albums[at->second].tracks;
        }
    }

    std::vector<size_t> order(drafts.size());
    std::iota(order.begin(), order.end(), size_t{0});
    order.erase(std::remove_if(order.begin(), order.end(),
                               [&drafts](size_t group) { return drafts[group].count == 0; }),
                order.end());
    std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        return drafts[a].count != drafts[b].count ? drafts[a].count > drafts[b].count
                                                  : utf16Before(genres.keys[a], genres.keys[b]);
    });

    std::vector<GenreTile> tiles;
    tiles.reserve(order.size());
    for (const size_t group : order) {
        std::vector<Album>& albums = drafts[group].albums;
        std::stable_sort(albums.begin(), albums.end(),
                         [](const Album& a, const Album& b) { return a.tracks > b.tracks; });

        GenreTile tile{genres.tags.names[group],
                       drafts[group].count,
                       albums.size(),
                       drafts[group].artists.size(),
                       {}};
        for (size_t at = 0; at < std::min(kCoversPerTile, albums.size()); ++at)
            tile.covers.push_back(albums[at].first);
        tiles.push_back(std::move(tile));
    }
    return tiles;
}

Json figuresDocument(const SetFigures& figures) {
    Json document = Json::object();
    document["albumCount"] = figures.albumCount;
    document["trackCount"] = figures.trackCount;
    document["seconds"] = numberJson(figures.seconds);
    document["earliestYear"] = optionalNumberJson(figures.earliestYear);
    document["latestYear"] = optionalNumberJson(figures.latestYear);
    return document;
}

Json cardsDocument(const ArtistCards& cards) {
    Json topGenres = Json::array();
    for (const GenreShare& genre : cards.topGenres) {
        Json shown = Json::object();
        shown["name"] = genre.name;
        shown["count"] = genre.count;
        shown["share"] = genre.share;
        topGenres.push_back(std::move(shown));
    }

    Json mostPlayed = nullptr;
    if (cards.mostPlayed) {
        mostPlayed = Json::object();
        mostPlayed["ordinal"] = cards.mostPlayed->ordinal;
        mostPlayed["title"] = cards.mostPlayed->title;
        mostPlayed["plays"] = numberJson(cards.mostPlayed->plays);
    }

    Json document = Json::object();
    document["playedShare"] = numberJson(cards.playedShare);
    document["plays"] = numberJson(cards.plays);
    document["neverPlayed"] = cards.neverPlayed;
    document["lastPlayed"] = optionalNumberJson(cards.lastPlayed);
    document["mostPlayed"] = std::move(mostPlayed);
    document["topGenres"] = std::move(topGenres);
    return document;
}

Json recordsDocument(const Snapshot& snapshot, const std::vector<RecordInSet>& records) {
    Json listed = Json::array();
    for (const RecordInSet& record : records) {
        Json shown = Json::object();
        shown["album"] = record.album;
        shown["artist"] = textJson(record.artist);
        shown["year"] = optionalNumberJson(record.year);
        shown["cover"] = pathOf(snapshot, record.cover);
        shown["trackCount"] = record.trackCount;
        listed.push_back(std::move(shown));
    }
    return listed;
}

Json genresDocument(const Snapshot& snapshot, const std::vector<GenreTile>& tiles) {
    Json listed = Json::array();
    for (const GenreTile& tile : tiles) {
        Json covers = Json::array();
        for (const uint32_t cover : tile.covers)
            covers.push_back(pathOf(snapshot, cover));

        Json shown = Json::object();
        shown["name"] = tile.name;
        shown["count"] = tile.count;
        shown["albumCount"] = tile.albumCount;
        shown["artistCount"] = tile.artistCount;
        shown["covers"] = std::move(covers);
        listed.push_back(std::move(shown));
    }
    return listed;
}

}  // namespace jean
