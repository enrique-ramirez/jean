#include "core/playlist_runs.h"

#include "core/library_groups.h"
#include "core/library_summary.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <bit>
#include <iterator>
#include <mutex>
#include <string_view>
#include <unordered_set>

namespace jean {

namespace {

enum Slot : size_t {
    kAlbum,
    kAlbumArtist,
    kArtist,
    kPlays,
    kLocalPlays,
    kDuration,
    kYear,
    kSlotCount,
};

using Slots = std::array<std::optional<size_t>, kSlotCount>;

Slots slotsOf(const LibraryRoles& roles) {
    return {roles.album,          roles.albumArtist, roles.artist, roles.playCount,
            roles.playCountLocal, roles.duration,    roles.year};
}

std::string_view libraryText(const Snapshot& snapshot, std::optional<size_t> role,
                             uint32_t ordinal) {
    if (!role)
        return kUnresolved;

    const Column& column = snapshot.columns[*role];
    return column.dictionary.values[column.ids[ordinal]];
}

std::string_view outsideText(const PlaylistTrack& row, Slot slot) {
    return slot < row.columns.size() ? std::string_view(row.columns[slot])
                                     : std::string_view(kUnresolved);
}

int32_t groupOf(TagGroups& groups, std::string_view value) {
    return isPresent(value) ? groups.add(tagKey(value), value) : -1;
}

class LibraryGroups {
public:
    LibraryGroups(const Snapshot& snapshot, std::optional<size_t> role, TagGroups& groups)
        : snapshot_(snapshot), role_(role), groups_(groups) {
        if (role_)
            groupOfId_.assign(snapshot.columns[*role_].dictionary.values.size(), kUnknown);
    }

    int32_t of(uint32_t ordinal) {
        if (!role_)
            return -1;

        const uint32_t id = snapshot_.columns[*role_].ids[ordinal];
        if (groupOfId_[id] == kUnknown)
            groupOfId_[id] = groupOf(groups_, snapshot_.columns[*role_].dictionary.values[id]);
        return groupOfId_[id];
    }

private:
    static constexpr int32_t kUnknown = -2;

    const Snapshot& snapshot_;
    const std::optional<size_t> role_;
    TagGroups& groups_;
    std::vector<int32_t> groupOfId_;
};

struct RunKey {
    int32_t album = -1;
    int64_t artist = -1;

    bool operator==(const RunKey&) const = default;
};

std::optional<double> releaseYear(std::string_view raw) {
    const auto year = readNumber(raw);
    return year && *year > kFirstRealYear ? year : std::nullopt;
}

}  // namespace

std::vector<std::string> playlistRunsColumns(const Snapshot& snapshot, const LibraryRoles& roles) {
    const Slots slots = slotsOf(roles);

    std::vector<std::string> columns;
    columns.reserve(slots.size());
    std::transform(slots.begin(), slots.end(), std::back_inserter(columns),
                   [&snapshot](std::optional<size_t> role) {
                       return role ? snapshot.columns[*role].name : std::string();
                   });
    return columns;
}

PlaylistRuns playlistRunsOf(const Snapshot& snapshot, const LibraryRoles& roles,
                            const std::vector<PlaylistTrack>& rows) {
    TagGroups albums;
    TagGroups artists;
    LibraryGroups libraryAlbums(snapshot, roles.album, albums);
    LibraryGroups libraryAlbumArtists(snapshot, roles.albumArtist, artists);
    LibraryGroups libraryArtists(snapshot, roles.artist, artists);
    const Slots slots = slotsOf(roles);

    PlaylistRuns runs;
    runs.trackCount = rows.size();

    std::unordered_set<uint64_t> albumPairs;
    std::optional<RunKey> current;
    for (const PlaylistTrack& row : rows) {
        int32_t album = 0;
        int32_t albumArtist = 0;
        int32_t artist = 0;
        std::array<std::string_view, kSlotCount> text{};
        if (row.ordinal) {
            album = libraryAlbums.of(*row.ordinal);
            albumArtist = libraryAlbumArtists.of(*row.ordinal);
            artist = libraryArtists.of(*row.ordinal);
            for (size_t slot = kPlays; slot < kSlotCount; ++slot)
                text[slot] = libraryText(snapshot, slots[slot], *row.ordinal);
        } else {
            album = groupOf(albums, outsideText(row, kAlbum));
            albumArtist = groupOf(artists, outsideText(row, kAlbumArtist));
            artist = groupOf(artists, outsideText(row, kArtist));
            for (size_t slot = kPlays; slot < kSlotCount; ++slot)
                text[slot] = outsideText(row, static_cast<Slot>(slot));
        }

        const int32_t credited = albumArtist >= 0 ? albumArtist : artist;
        const bool somebody = credited >= 0 && !artists.blank[static_cast<size_t>(credited)];
        const RunKey key{album, somebody ? credited : -1};
        if (current == key) {
            ++runs.lengths.back();
        } else {
            current = key;
            runs.lengths.push_back(1);
        }

        if (album >= 0)
            albumPairs.insert(albumPairOf(album, key.artist));

        const auto plays = higherOf(readPlayCount(text[kPlays]), readPlayCount(text[kLocalPlays]));
        runs.mostPlays = std::max(runs.mostPlays, plays.value_or(0));
        runs.seconds += readNumber(text[kDuration]).value_or(0);

        if (const auto year = releaseYear(text[kYear])) {
            runs.earliestYear = runs.earliestYear ? std::min(*runs.earliestYear, *year) : *year;
            runs.latestYear = runs.latestYear ? std::max(*runs.latestYear, *year) : *year;
        }
    }

    runs.albumCount = albumPairs.size();
    return runs;
}

uint64_t playlistRunsHash(const PlaylistRuns& runs) {
    ValueDigest digest;
    const auto mix = [&digest](uint64_t value) { digest.mix(value); };
    const auto mixNumber = [&mix](double value) { mix(std::bit_cast<uint64_t>(value)); };
    const auto mixYear = [&](const std::optional<double>& year) {
        mix(year ? 1 : 0);
        mixNumber(year.value_or(0));
    };

    mix(runs.lengths.size());
    for (const uint32_t length : runs.lengths)
        mix(length);
    mixNumber(runs.mostPlays);
    mix(runs.albumCount);
    mix(runs.trackCount);
    mixNumber(runs.seconds);
    mixYear(runs.earliestYear);
    mixYear(runs.latestYear);
    return digest.digest();
}

namespace {

constexpr size_t kHeldPlaylists = 8;

struct Reading {
    uint64_t structure = 0;
    uint64_t revision = 0;
    uint64_t libraryStructure = 0;
    Slots slots;
    std::array<uint64_t, kSlotCount> changeCounts{};

    bool operator==(const Reading&) const = default;
};

Reading readingOf(const PlaylistTracksRead& read, const Snapshot& snapshot,
                  const LibraryRoles& roles) {
    Reading reading;
    reading.structure = read.structure;
    reading.revision = read.revision;
    reading.libraryStructure = snapshot.structure;
    reading.slots = slotsOf(roles);
    std::transform(reading.slots.begin(), reading.slots.end(), reading.changeCounts.begin(),
                   [&snapshot](std::optional<size_t> role) {
                       return role ? snapshot.columns[*role].changeCount : uint64_t{0};
                   });
    return reading;
}

}  // namespace

struct HeldPlaylistRuns::Held {
    struct Answer {
        std::string playlistId;
        Reading reading;
        std::shared_ptr<const PlaylistRuns> runs;
    };

    std::mutex lock;
    std::vector<Answer> answers;
    size_t builds = 0;
};

HeldPlaylistRuns::HeldPlaylistRuns() : held_(std::make_unique<Held>()) {}
HeldPlaylistRuns::~HeldPlaylistRuns() = default;

std::shared_ptr<const PlaylistRuns> HeldPlaylistRuns::of(const std::string& playlistId,
                                                         const PlaylistTracksRead& read,
                                                         const Snapshot& snapshot,
                                                         const LibraryRoles& roles) {
    const Reading reading = readingOf(read, snapshot, roles);
    const auto sameKey = [&](const Held::Answer& held) { return held.playlistId == playlistId; };

    {
        const std::lock_guard<std::mutex> lock(held_->lock);
        const auto found = std::find_if(held_->answers.begin(), held_->answers.end(), sameKey);
        if (found != held_->answers.end() && found->reading == reading)
            return found->runs;
    }

    // Built outside the lock, so one playlist's pass does not hold up another's. A second request
    // for the same key that arrives meanwhile builds again rather than waits, and the later swap
    // wins.
    auto runs = std::make_shared<const PlaylistRuns>(playlistRunsOf(snapshot, roles, read.rows));

    const std::lock_guard<std::mutex> lock(held_->lock);
    auto& answers = held_->answers;
    ++held_->builds;
    const auto found = std::find_if(answers.begin(), answers.end(), sameKey);
    if (found == answers.end()) {
        if (answers.size() >= kHeldPlaylists)
            answers.erase(answers.begin());
        answers.push_back({playlistId, reading, runs});
    } else {
        found->reading = reading;
        found->runs = runs;
    }
    return runs;
}

size_t HeldPlaylistRuns::builds() const {
    const std::lock_guard<std::mutex> lock(held_->lock);
    return held_->builds;
}

}  // namespace jean
