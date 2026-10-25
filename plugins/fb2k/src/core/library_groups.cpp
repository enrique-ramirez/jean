#include "core/library_groups.h"

#include "core/library_credits.h"
#include "core/text.h"

#include <algorithm>
#include <utility>

namespace jean {

namespace {

constexpr size_t kPathFields = 2;

}  // namespace

bool isPresent(std::string_view raw) {
    return !raw.empty() && raw != kUnresolved && raw != "N/A";
}

bool isDigit(char c) {
    return c >= '0' && c <= '9';
}

bool isAsciiSpace(char c) {
    return c == ' ' || (c >= '\t' && c <= '\r');
}

std::optional<double> readOrdinal(std::string_view raw) {
    if (!isPresent(raw))
        return std::nullopt;

    size_t at = endOfEcmaWhitespace(raw, 0);
    if (at < raw.size() && raw[at] == '+')
        ++at;

    double parsed = 0;
    const size_t from = at;
    for (; at < raw.size() && isDigit(raw[at]); ++at)
        parsed = (parsed * 10) + (raw[at] - '0');

    return at > from && parsed > 0 ? std::optional<double>(parsed) : std::nullopt;
}

int32_t TagGroups::add(const std::string& key, std::string_view raw) {
    const auto [at, fresh] = byKey.try_emplace(key, static_cast<int32_t>(names.size()));
    if (fresh) {
        names.emplace_back(raw);
        blank.push_back(key.empty());
    }
    return at->second;
}

std::vector<int32_t> TagGroups::over(const Snapshot& snapshot, std::optional<size_t> role) {
    std::vector<int32_t> groups;
    if (!role)
        return groups;

    for (const std::string& value : snapshot.columns[*role].dictionary.values)
        groups.push_back(isPresent(value) ? add(tagKey(value), value) : -1);
    return groups;
}

GenreGroups genreGroupsOf(const Snapshot& snapshot, std::optional<size_t> role) {
    GenreGroups genres;
    if (!role)
        return genres;

    const Column& column = snapshot.columns[*role];
    genres.of.ids = &column.ids;
    for (const std::string& value : column.dictionary.values) {
        std::vector<int32_t> groups;
        if (isPresent(value)) {
            for (const std::string_view part : splitOnValues(value)) {
                std::string key = tagKey(part);
                if (key.empty())
                    continue;
                const size_t known = genres.tags.names.size();
                const int32_t group = genres.tags.add(key, part);
                if (static_cast<size_t>(group) == known)
                    genres.keys.push_back(std::move(key));
                if (std::find(groups.begin(), groups.end(), group) == groups.end())
                    groups.push_back(group);
            }
        }
        genres.of.answers.push_back(std::move(groups));
    }
    return genres;
}

uint32_t idAt(std::optional<size_t> role, const Snapshot& snapshot, size_t row) {
    return role ? snapshot.columns[*role].ids[row] : kNoId;
}

std::optional<std::string_view> cellOf(const Snapshot& snapshot, std::optional<size_t> role,
                                       uint32_t id) {
    if (!role || id == kNoId)
        return std::nullopt;
    const std::string& value = snapshot.columns[*role].dictionary.values[id];
    return isPresent(value) ? std::optional<std::string_view>(value) : std::nullopt;
}

int32_t Credits::creditedArtist(size_t row) const {
    const int32_t credited = albumArtistGroup.of(row);
    return credited >= 0 ? credited : artistGroup.of(row);
}

Credits creditsOf(const Snapshot& snapshot, const LibraryRoles& roles) {
    Credits credits;
    std::vector<int32_t> albumNames = credits.albums.over(snapshot, roles.album);
    std::vector<int32_t> albumArtists = credits.artists.over(snapshot, roles.albumArtist);
    std::vector<int32_t> trackArtists = credits.artists.over(snapshot, roles.artist);
    credits.albumGroup = perValue(snapshot, roles.album, std::move(albumNames), int32_t{-1});
    credits.albumArtistGroup =
        perValue(snapshot, roles.albumArtist, std::move(albumArtists), int32_t{-1});
    credits.artistGroup = perValue(snapshot, roles.artist, std::move(trackArtists), int32_t{-1});
    return credits;
}

int64_t artistKeyOf(const Credits& credits, size_t row) {
    const int32_t artist = credits.creditedArtist(row);
    return artist >= 0 && !credits.artists.blank[static_cast<size_t>(artist)] ? artist : -1;
}

uint64_t albumPairOf(int32_t albumGroup, int64_t artistKey) {
    return (static_cast<uint64_t>(albumGroup) << 32U) | static_cast<uint32_t>(artistKey + 1);
}

std::optional<size_t> AlbumIndex::of(const Credits& credits, size_t row) const {
    const int32_t group = credits.albumGroup.of(row);
    if (group < 0)
        return std::nullopt;
    return byPair.at(albumPairOf(group, artistKeyOf(credits, row)));
}

AlbumRecords albumRecordsOf(const Snapshot& snapshot, const LibraryRoles& roles,
                            const Credits& credits) {
    const auto discs = resolve<std::optional<double>>(snapshot, roles.discNumber, readOrdinal);
    const auto tracks = resolve<std::optional<double>>(snapshot, roles.trackNumber, readOrdinal);

    AlbumRecords albums;
    for (size_t row = 0; row < snapshot.trackCount(); ++row) {
        const int32_t group = credits.albumGroup.of(row);
        if (group < 0)
            continue;

        const int64_t artistKey = artistKeyOf(credits, row);
        const auto [at, fresh] = albums.index.byPair.try_emplace(
            albumPairOf(group, artistKey), static_cast<uint32_t>(albums.list.size()));
        if (fresh) {
            const int32_t artist = credits.creditedArtist(row);
            AlbumRecord album;
            album.name = credits.albums.names[static_cast<size_t>(group)];
            album.artistKey = artistKey;
            album.artist = artist >= 0
                               ? std::optional(credits.artists.names[static_cast<size_t>(artist)])
                               : std::nullopt;
            albums.list.push_back(std::move(album));
        }

        AlbumRecord& album = albums.list[at->second];
        album.ordinals.push_back(static_cast<uint32_t>(row));

        const double disc = discs.of(row).value_or(0);
        const double track = tracks.of(row).value_or(0);
        if (album.ordinals.size() == 1 || disc < album.coverDisc ||
            (disc == album.coverDisc && track < album.coverTrack)) {
            album.coverDisc = disc;
            album.coverTrack = track;
            album.cover = static_cast<uint32_t>(row);
        }
    }

    return albums;
}

std::string pathOf(const Snapshot& snapshot, size_t row) {
    std::string path;
    for (size_t field = 0; field < kPathFields; ++field) {
        const Column& column = snapshot.columns[field];
        path += column.dictionary.values[column.ids[row]];
    }
    return path;
}

}  // namespace jean
