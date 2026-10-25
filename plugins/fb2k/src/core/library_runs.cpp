#include "core/library_runs.h"

#include "core/library_groups.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <iterator>
#include <mutex>
#include <optional>
#include <utility>

namespace jean {

namespace {

using Roles = std::array<std::optional<size_t>, 5>;

Roles rolesRead(const LibraryRoles& roles) {
    return {roles.album, roles.albumArtist, roles.artist, roles.discNumber, roles.trackNumber};
}

struct RunKey {
    int64_t album = -1;
    int64_t untaggedArtist = -1;

    bool operator==(const RunKey&) const = default;
};

RunKey runKeyOf(const Credits& credits, const AlbumIndex& index, size_t row) {
    if (const auto album = index.of(credits, row))
        return {static_cast<int64_t>(*album), -1};

    return {-1, artistKeyOf(credits, row)};
}

}  // namespace

LibraryRuns libraryRunsOf(const Snapshot& snapshot, const LibraryRoles& roles) {
    const Credits credits = creditsOf(snapshot, roles);
    const AlbumRecords albums = albumRecordsOf(snapshot, roles, credits);

    LibraryRuns runs;
    std::optional<RunKey> current;
    for (size_t row = 0; row < snapshot.trackCount(); ++row) {
        const RunKey key = runKeyOf(credits, albums.index, row);
        if (current == key) {
            ++runs.lengths.back();
            continue;
        }

        current = key;
        if (key.album < 0)
            runs.untagged.push_back(static_cast<uint32_t>(runs.lengths.size()));
        runs.lengths.push_back(1);
        runs.covers.push_back(key.album >= 0 ? albums.list[static_cast<size_t>(key.album)].cover
                                             : static_cast<uint32_t>(row));
    }
    return runs;
}

uint64_t runsHash(const LibraryRuns& runs) {
    ValueDigest digest;
    digest.mix(runs.lengths.size());
    for (const uint32_t length : runs.lengths)
        digest.mix(length);
    for (const uint32_t cover : runs.covers)
        digest.mix(cover);
    digest.mix(runs.untagged.size());
    for (const uint32_t run : runs.untagged)
        digest.mix(run);
    return digest.digest();
}

struct HeldLibraryRuns::Held {
    struct Answer {
        Roles roles;
        std::array<uint64_t, 5> changeCounts{};
        std::shared_ptr<const LibraryRuns> runs;
    };

    std::mutex lock;
    uint64_t structure = 0;
    std::vector<Answer> answers;
    size_t builds = 0;
};

HeldLibraryRuns::HeldLibraryRuns() : held_(std::make_unique<Held>()) {}
HeldLibraryRuns::~HeldLibraryRuns() = default;

std::shared_ptr<const LibraryRuns> HeldLibraryRuns::of(const Snapshot& snapshot,
                                                       const LibraryRoles& roles) {
    const std::lock_guard<std::mutex> lock(held_->lock);
    auto& answers = held_->answers;

    if (held_->structure != snapshot.structure) {
        answers.clear();
        held_->structure = snapshot.structure;
    }

    const Roles read = rolesRead(roles);
    std::array<uint64_t, 5> counts{};
    std::transform(read.begin(), read.end(), counts.begin(), [&](std::optional<size_t> role) {
        return role ? snapshot.columns[*role].changeCount : uint64_t{0};
    });

    auto found = std::find_if(answers.begin(), answers.end(),
                              [&](const Held::Answer& held) { return held.roles == read; });
    if (found == answers.end()) {
        if (answers.size() >= kHeldRoleSets)
            answers.erase(answers.begin());
        answers.push_back({read, {}, nullptr});
        found = std::prev(answers.end());
    }

    if (!found->runs || found->changeCounts != counts) {
        found->runs = std::make_shared<const LibraryRuns>(libraryRunsOf(snapshot, roles));
        found->changeCounts = counts;
        ++held_->builds;
    }
    return found->runs;
}

size_t HeldLibraryRuns::builds() const {
    const std::lock_guard<std::mutex> lock(held_->lock);
    return held_->builds;
}

}  // namespace jean
