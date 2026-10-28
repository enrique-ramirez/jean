#include "support/fake_player.h"

#include "core/library_groups.h"
#include "core/refusal_order.h"
#include "support/fixtures.h"

#include <algorithm>
#include <functional>
#include <iterator>
#include <numeric>
#include <set>
#include <tuple>
#include <utility>

namespace jean::testing {

namespace {

using Lock = std::lock_guard<std::mutex>;

PlaylistRow formatted(const FakeRow& row, const std::vector<std::string>& columns) {
    PlaylistRow answer;
    answer.libraryPath = row.libraryPath;
    answer.subsong = row.subsong;

    std::transform(columns.begin(), columns.end(), std::back_inserter(answer.columns),
                   [&row](const std::string& column) {
                       const auto found = row.fields.find(column);
                       return found == row.fields.end() ? std::string(kUnresolved) : found->second;
                   });

    return answer;
}

QueuedTrack queuedFrom(const FakeRow& row) {
    QueuedTrack queued;
    const auto field = [&row](const char* name) {
        const auto found = row.fields.find(name);
        return found == row.fields.end() ? std::string() : found->second;
    };

    queued.title = field("%title%");
    queued.artist = field("%artist%");
    queued.album = field("%album%");
    queued.libraryPath = row.libraryPath;
    return queued;
}

bool anyPastEnd(const std::vector<uint32_t>& positions, size_t count) {
    return std::any_of(positions.begin(), positions.end(),
                       [count](uint32_t position) { return position >= count; });
}

std::vector<size_t> positionsFrom(size_t base, size_t count) {
    std::vector<size_t> positions(count);
    std::iota(positions.begin(), positions.end(), base);
    return positions;
}

using Track = std::tuple<std::optional<std::string>, uint32_t, std::map<std::string, std::string>>;

Track trackOf(const FakeRow& row) {
    if (row.libraryPath)
        return {row.libraryPath, row.subsong, {}};
    return {std::nullopt, row.subsong, row.fields};
}

std::vector<bool> alreadyHeld(const std::vector<FakeRow>& held, const std::vector<FakeRow>& rows,
                              Duplicates duplicates) {
    if (duplicates == Duplicates::added)
        return std::vector<bool>(rows.size(), false);

    std::set<Track> tracks;
    std::transform(held.begin(), held.end(), std::inserter(tracks, tracks.end()), trackOf);

    std::vector<bool> answer;
    std::transform(rows.begin(), rows.end(), std::back_inserter(answer),
                   [&tracks](const FakeRow& row) { return tracks.contains(trackOf(row)); });
    return answer;
}

std::vector<FakeRow> rowsAt(const std::vector<FakeRow>& rows, const std::vector<size_t>& indices) {
    std::vector<FakeRow> chosen;
    std::transform(indices.begin(), indices.end(), std::back_inserter(chosen),
                   [&rows](size_t at) { return rows[at]; });
    return chosen;
}

template <typename Result>
Result failed(PlayerOutcome outcome) {
    Result result;
    result.outcome = outcome;
    return result;
}

// Where the snapshot holds the row's track, as fb2k/library.cpp's handle map finds it: the same
// library-relative path at the same subsong.
std::optional<uint32_t> ordinalIn(const Snapshot& snapshot, const FakeRow& row) {
    if (!row.libraryPath || snapshot.columns.size() < kSpineFieldCount)
        return std::nullopt;

    const std::string subsong = std::to_string(row.subsong);
    const Column& subsongs = snapshot.columns[kSpineFieldCount - 1];
    for (size_t ordinal = 0; ordinal < snapshot.trackCount(); ++ordinal) {
        if (pathOf(snapshot, ordinal) == *row.libraryPath &&
            subsongs.dictionary.values[subsongs.ids[ordinal]] == subsong)
            return static_cast<uint32_t>(ordinal);
    }
    return std::nullopt;
}

}  // namespace

FakeRow titled(const std::string& title) {
    FakeRow row;
    row.fields = {{"%title%", title}};
    return row;
}

std::vector<FakeRow> titledRows(const std::vector<std::string>& titles) {
    std::vector<FakeRow> rows;
    std::transform(titles.begin(), titles.end(), std::back_inserter(rows), titled);
    return rows;
}

FakeRow libraryTrack(uint32_t ordinal) {
    FakeRow row = titled(builtTrackTitle(ordinal));
    row.libraryPath = builtTrackPath(ordinal);
    return row;
}

FakePlayer::FakePlayer(Library* library, PlayerStateStore* store)
    : library_(library), store_(store) {}

std::string FakePlayer::madeId(size_t nth) {
    const auto digits = std::to_string(nth + 1);
    return "00000000-0000-4000-8000-" + std::string(12 - digits.size(), '0') + digits;
}

std::vector<FakePlayer::Held>::iterator FakePlayer::find(const std::string& id) {
    return std::find_if(playlists_.begin(), playlists_.end(),
                        [&id](const Held& held) { return held.entry.id == id; });
}

std::vector<FakePlayer::Held>::const_iterator FakePlayer::find(const std::string& id) const {
    return std::find_if(playlists_.begin(), playlists_.end(),
                        [&id](const Held& held) { return held.entry.id == id; });
}

PlaylistAnnotation FakePlayer::annotate(size_t position) const {
    auto entry = playlists_[position].entry;
    entry.index = static_cast<int>(position);
    entry.itemCount = playlists_[position].rows.size();
    return entry;
}

std::vector<PlaylistAnnotation> FakePlayer::listing() const {
    std::vector<PlaylistAnnotation> entries;
    entries.reserve(playlists_.size());
    for (size_t position = 0; position < playlists_.size(); ++position)
        entries.push_back(annotate(position));
    return entries;
}

void FakePlayer::ask(Call call, const std::string& playlistId) {
    asked_.push_back({call, playlistId});
}

std::optional<PlayerOutcome> FakePlayer::refusal(Call call) const {
    const auto found = refusals_.find(call);
    if (found == refusals_.end())
        return std::nullopt;
    return found->second;
}

bool FakePlayer::libraryAt(uint64_t structure) {
    if (!library_)
        return false;

    if (libraryRebuildsFirst_)
        moveLibraryStructure(*library_);

    return library_->state().structure == structure;
}

FakePlayer::Held& FakePlayer::make(const std::string& title) {
    Held held;
    held.entry.id = madeId(made_++);
    held.entry.title = title;
    held.entry.structure = kMadeVersion;
    held.entry.revision = kMadeVersion;
    playlists_.push_back(std::move(held));
    return playlists_.back();
}

void FakePlayer::landed(Held& held) {
    held.entry.structure++;
}

void FakePlayer::reordered(Held& held, const std::vector<uint32_t>& order) {
    if (std::is_sorted(order.begin(), order.end()))
        return;

    std::vector<FakeRow> rows;
    std::transform(order.begin(), order.end(), std::back_inserter(rows),
                   [&held](uint32_t old) { return held.rows[old]; });
    held.rows = std::move(rows);
    landed(held);
}

uint64_t FakePlayer::queueRevision() const {
    return store_ ? store_->read().queueRevision : queueRevision_;
}

void FakePlayer::queueChanged() {
    if (!store_) {
        ++queueRevision_;
        return;
    }

    std::vector<QueueEntry> entries;
    std::transform(queue_.begin(), queue_.end(), std::back_inserter(entries),
                   [](const QueuedTrack& track) {
                       QueueEntry entry;
                       entry.path = track.libraryPath.value_or(track.title);
                       entry.location = track.location;
                       return entry;
                   });
    store_->queueChanged(std::move(entries));
}

void FakePlayer::changeTheQueueIfAsked() {
    if (!queueChangesFirst_)
        return;

    queue_.push_back(queuedFrom(titled("Queued at the player " + std::to_string(queue_.size()))));
    queueChanged();
}

std::optional<PlayerOutcome> FakePlayer::queueRefusal(Call call, std::optional<uint64_t> revision,
                                                      bool positionPastEnd) {
    if (const auto refused = refusal(call))
        return refused;

    QueueEditFacts facts;
    facts.queueMoved = revision && *revision != queueRevision();
    facts.positionPastEnd = positionPastEnd;

    const auto outcome = queueEditRefusal(facts);
    if (outcome == PlayerOutcome::done)
        return std::nullopt;
    return outcome;
}

void FakePlayer::insertIntoQueue(std::vector<QueuedTrack> entries,
                                 std::optional<QueuePosition> at) {
    const auto where = at ? queue_.begin() + static_cast<std::ptrdiff_t>(at->index) : queue_.end();
    queue_.insert(where, entries.begin(), entries.end());
    queueChanged();
}

void FakePlayer::add(PlaylistAnnotation entry, std::vector<FakeRow> rows) {
    const Lock guard(mutex_);

    Held held;
    held.entry = std::move(entry);
    held.rows = std::move(rows);
    playlists_.push_back(std::move(held));
}

void FakePlayer::queue(std::vector<QueuedTrack> entries) {
    const Lock guard(mutex_);
    queue_ = std::move(entries);
    queueChanged();
}

void FakePlayer::retag(const std::string& id, const std::map<uint32_t, FakeRow>& rows) {
    const Lock guard(mutex_);

    auto& held = *find(id);
    held.entry.revision++;

    for (const auto& [position, row] : rows) {
        held.rows.at(position) = row;
        held.changedAt[position] = held.entry.revision;
    }
}

void FakePlayer::retainRevisionsFrom(const std::string& id, uint64_t revision) {
    const Lock guard(mutex_);
    find(id)->oldestRetained = revision;
}

void FakePlayer::answerPreview(const std::string& query, PreviewResult answer) {
    const Lock guard(mutex_);
    previews_[query] = std::move(answer);
}

void FakePlayer::refuse(Call call, PlayerOutcome outcome) {
    const Lock guard(mutex_);
    refusals_[call] = outcome;
}

void FakePlayer::lock(const std::string& id) {
    const Lock guard(mutex_);
    find(id)->locked = true;
}

void FakePlayer::removeAtThePlayer(const std::string& id) {
    const Lock guard(mutex_);
    playlists_.erase(find(id));
}

void FakePlayer::changeTheQueueBeforeEachEdit() {
    const Lock guard(mutex_);
    queueChangesFirst_ = true;
}

void FakePlayer::rebuildTheLibraryBeforeEachJob() {
    const Lock guard(mutex_);
    libraryRebuildsFirst_ = true;
}

std::vector<PlaylistAnnotation> FakePlayer::playlists() const {
    const Lock guard(mutex_);
    return listing();
}

std::optional<PlaylistAnnotation> FakePlayer::playlist(const std::string& id) const {
    const Lock guard(mutex_);

    const auto found = find(id);
    if (found == playlists_.end())
        return std::nullopt;
    return annotate(static_cast<size_t>(found - playlists_.begin()));
}

std::vector<FakeRow> FakePlayer::rowsOf(const std::string& id) const {
    const Lock guard(mutex_);

    const auto found = find(id);
    return found == playlists_.end() ? std::vector<FakeRow>{} : found->rows;
}

std::vector<std::string> FakePlayer::titlesOf(const std::string& id) const {
    const auto rows = rowsOf(id);

    std::vector<std::string> titles;
    std::transform(rows.begin(), rows.end(), std::back_inserter(titles), [](const FakeRow& row) {
        const auto found = row.fields.find("%title%");
        return found == row.fields.end() ? std::string() : found->second;
    });
    return titles;
}

std::vector<QueuedTrack> FakePlayer::queued() const {
    const Lock guard(mutex_);
    return queue_;
}

std::optional<PlayingLocation> FakePlayer::playing() const {
    const Lock guard(mutex_);
    return playing_;
}

int FakePlayer::count(Call call) const {
    const Lock guard(mutex_);
    return static_cast<int>(std::count_if(
        asked_.begin(), asked_.end(), [call](const Asked& asked) { return asked.call == call; }));
}

int FakePlayer::writes() const {
    static const std::set<Call> reads{Call::listPlaylists,   Call::readRole,   Call::readRows,
                                      Call::readChangedRows, Call::readTracks, Call::previewQuery,
                                      Call::readQueue};

    const Lock guard(mutex_);
    return static_cast<int>(std::count_if(asked_.begin(), asked_.end(), [](const Asked& asked) {
        return !reads.contains(asked.call);
    }));
}

int FakePlayer::total() const {
    const Lock guard(mutex_);
    return static_cast<int>(asked_.size());
}

std::vector<bool> FakePlayer::previewsAskingRows() const {
    const Lock guard(mutex_);
    return previewsAskingRows_;
}

std::vector<std::string> FakePlayer::askedAbout(Call call) const {
    const Lock guard(mutex_);

    std::vector<std::string> ids;
    for (const auto& asked : asked_)
        if (asked.call == call)
            ids.push_back(asked.playlistId);
    return ids;
}

Player FakePlayer::player() {
    Player player = servingPlayer();

    player.playlists.list = [this] {
        const Lock guard(mutex_);
        ask(Call::listPlaylists);

        if (const auto refused = refusal(Call::listPlaylists))
            return PlaylistsResult{*refused, {}};

        return PlaylistsResult{PlayerOutcome::done, listing()};
    };

    player.playlists.readRole = [this](const std::string& id) {
        const Lock guard(mutex_);
        ask(Call::readRole, id);

        if (const auto refused = refusal(Call::readRole))
            return PlaylistRoleRead{*refused, std::nullopt};

        const auto found = find(id);
        return PlaylistRoleRead{PlayerOutcome::done,
                                found == playlists_.end() ? std::nullopt : found->entry.role};
    };

    player.playlists.readRows = [this](const std::string& id, const PlaylistRowsAsked& rows,
                                       const std::vector<std::string>& columns) {
        const Lock guard(mutex_);
        ask(Call::readRows, id);

        if (const auto refused = refusal(Call::readRows))
            return failed<PlaylistRowsRead>(*refused);

        const auto found = find(id);
        if (found == playlists_.end())
            return failed<PlaylistRowsRead>(PlayerOutcome::noSuchPlaylist);

        PlaylistRowsRead read;
        read.structure = found->entry.structure;
        read.revision = found->entry.revision;
        read.totalCount = found->rows.size();

        const auto row = [&columns](const FakeRow& held) { return formatted(held, columns); };
        if (rows.positions) {
            if (std::any_of(rows.positions->begin(), rows.positions->end(),
                            [&found](uint32_t position) { return position >= found->rows.size(); }))
                return failed<PlaylistRowsRead>(PlayerOutcome::positionPastEnd);
            std::transform(
                rows.positions->begin(), rows.positions->end(), std::back_inserter(read.rows),
                [&found, &row](uint32_t position) { return row(found->rows[position]); });
            return read;
        }

        const auto first = std::min<size_t>(rows.offset, found->rows.size());
        const auto last = std::min<size_t>(first + rows.count, found->rows.size());
        std::transform(found->rows.begin() + static_cast<std::ptrdiff_t>(first),
                       found->rows.begin() + static_cast<std::ptrdiff_t>(last),
                       std::back_inserter(read.rows), row);
        return read;
    };

    player.playlists.readChangedRows = [this](const std::string& id, uint64_t structure,
                                              uint64_t since,
                                              const std::vector<std::string>& columns) {
        const Lock guard(mutex_);
        ask(Call::readChangedRows, id);

        if (const auto refused = refusal(Call::readChangedRows))
            return failed<PlaylistChangesRead>(*refused);

        const auto found = find(id);
        if (found == playlists_.end())
            return failed<PlaylistChangesRead>(PlayerOutcome::noSuchPlaylist);

        PlaylistChangesRead read;
        if (structure != found->entry.structure) {
            read.catchUp = ReadOutcome::structureMoved;
            return read;
        }

        if (since < found->oldestRetained) {
            read.catchUp = ReadOutcome::revisionTooOld;
            return read;
        }

        read.revision = found->entry.revision;
        for (const auto& [position, revision] : found->changedAt)
            if (revision > since)
                read.rows.push_back({position, formatted(found->rows.at(position), columns)});
        return read;
    };

    player.playlists.readTracks = [this](const std::string& id,
                                         const std::vector<std::string>& columns) {
        const Lock guard(mutex_);
        ask(Call::readTracks, id);

        if (const auto refused = refusal(Call::readTracks))
            return failed<PlaylistTracksRead>(*refused);

        const auto found = find(id);
        if (found == playlists_.end())
            return failed<PlaylistTracksRead>(PlayerOutcome::noSuchPlaylist);

        PlaylistTracksRead read;
        read.structure = found->entry.structure;
        read.revision = found->entry.revision;

        const auto copy = [&](const Snapshot* snapshot) {
            for (const FakeRow& row : found->rows) {
                const auto ordinal = snapshot ? ordinalIn(*snapshot, row) : std::nullopt;
                if (ordinal)
                    read.rows.push_back({ordinal, {}});
                else
                    read.rows.push_back({std::nullopt, formatted(row, columns).columns});
            }
        };

        if (!library_) {
            copy(nullptr);
            return read;
        }

        library_->read([&](const Snapshot& snapshot) {
            read.libraryStructure = snapshot.structure;
            copy(&snapshot);
            return 0;
        });
        return read;
    };

    player.playlists.create = [this](const std::string& title, const NewPlaylistRows& rows) {
        const Lock guard(mutex_);
        ask(Call::createPlaylist, rows.sourcePlaylistId);

        if (const auto refused = refusal(Call::createPlaylist))
            return playlistFailure(*refused);

        std::vector<FakeRow> gathered;
        if (!rows.sourcePlaylistId.empty()) {
            const auto source = find(rows.sourcePlaylistId);

            PlaylistEditFacts facts;
            facts.noSuchPlaylist = source == playlists_.end();
            facts.positionPastEnd =
                !facts.noSuchPlaylist && anyPastEnd(rows.positions, source->rows.size());
            if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
                return playlistFailure(outcome);

            std::transform(rows.positions.begin(), rows.positions.end(),
                           std::back_inserter(gathered),
                           [&source](uint32_t position) { return source->rows[position]; });
        } else if (!rows.ordinals.empty()) {
            PlaylistEditFacts facts;
            facts.libraryMoved = !libraryAt(rows.structure);
            if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
                return playlistFailure(outcome);

            std::transform(rows.ordinals.begin(), rows.ordinals.end(), std::back_inserter(gathered),
                           libraryTrack);
        }

        make(title).rows = std::move(gathered);

        PlaylistResult result;
        result.playlist = annotate(playlists_.size() - 1);
        return result;
    };

    player.playlists.rename = [this](const std::string& id, const std::string& title) {
        const Lock guard(mutex_);
        ask(Call::renamePlaylist, id);

        if (const auto refused = refusal(Call::renamePlaylist))
            return playlistFailure(*refused);

        const auto found = find(id);

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        facts.ownPlaylist = !facts.noSuchPlaylist && found->entry.role.has_value();
        facts.locked = !facts.noSuchPlaylist && found->locked;
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return playlistFailure(outcome);

        found->entry.title = title;
        return PlaylistResult{};
    };

    player.playlists.remove = [this](const std::string& id) {
        const Lock guard(mutex_);
        ask(Call::removePlaylist, id);

        if (const auto refused = refusal(Call::removePlaylist))
            return playlistFailure(*refused);

        const auto found = find(id);

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        facts.ownPlaylist = !facts.noSuchPlaylist && found->entry.role.has_value();
        facts.locked = !facts.noSuchPlaylist && found->locked;
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return playlistFailure(outcome);

        playlists_.erase(found);
        return PlaylistResult{};
    };

    player.playlists.move = [this](const std::string& id, uint32_t index) {
        const Lock guard(mutex_);
        ask(Call::movePlaylist, id);

        if (const auto refused = refusal(Call::movePlaylist))
            return playlistFailure(*refused);

        const auto found = find(id);

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        facts.ownPlaylist = !facts.noSuchPlaylist && found->entry.role.has_value();
        facts.positionPastEnd = index >= playlists_.size();
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return playlistFailure(outcome);

        auto moved = std::move(*found);
        playlists_.erase(found);
        playlists_.insert(playlists_.begin() + static_cast<std::ptrdiff_t>(index),
                          std::move(moved));
        return PlaylistResult{};
    };

    // The target alone is checked for a role and a lock: a source is read rather than changed.
    player.playlists.copyRows = [this](const std::string& id, const std::string& sourceId,
                                       const std::vector<uint32_t>& positions,
                                       Duplicates duplicates) {
        const Lock guard(mutex_);
        ask(Call::copyRows, id);

        const auto target = find(id);

        if (const auto refused = refusal(Call::copyRows)) {
            const auto base = target == playlists_.end() ? 0 : target->rows.size();
            return RowsEdited{*refused, 0, positionsFrom(base, positions.size()), {}};
        }

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = target == playlists_.end();
        facts.ownPlaylist = !facts.noSuchPlaylist && target->entry.role.has_value();
        facts.locked = !facts.noSuchPlaylist && target->locked;
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return failed<RowsEdited>(outcome);

        const auto source = find(sourceId);

        PlaylistEditFacts read;
        read.noSuchPlaylist = source == playlists_.end();
        read.positionPastEnd = !read.noSuchPlaylist && anyPastEnd(positions, source->rows.size());
        if (const auto outcome = playlistEditRefusal(read); outcome != PlayerOutcome::done)
            return failed<RowsEdited>(outcome);

        std::vector<FakeRow> named;
        std::transform(positions.begin(), positions.end(), std::back_inserter(named),
                       [&source](uint32_t position) { return source->rows[position]; });

        auto split = splitDuplicates(positions, alreadyHeld(target->rows, named, duplicates));
        const auto copied = rowsAt(named, split.inserted);

        RowsEdited edited;
        edited.positions = positionsFrom(target->rows.size(), copied.size());
        target->rows.insert(target->rows.end(), copied.begin(), copied.end());
        if (!copied.empty())
            landed(*target);

        edited.structure = target->entry.structure;
        edited.skipped = std::move(split.skipped);
        return edited;
    };

    player.playlists.removeRows = [this](const std::string& id, uint64_t structure,
                                         const std::vector<uint32_t>& positions) {
        const Lock guard(mutex_);
        ask(Call::removeRows, id);

        if (const auto refused = refusal(Call::removeRows))
            return failed<RowsEdited>(*refused);

        const auto found = find(id);

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        if (!facts.noSuchPlaylist) {
            facts.ownPlaylist = found->entry.role.has_value();
            facts.locked = found->locked;
            facts.rowsMoved = structure != found->entry.structure;
            facts.positionPastEnd = anyPastEnd(positions, found->rows.size());
        }
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return RowsEdited{outcome, facts.noSuchPlaylist ? 0 : found->entry.structure, {}, {}};

        auto descending = positions;
        std::sort(descending.begin(), descending.end(), std::greater<>());
        descending.erase(std::unique(descending.begin(), descending.end()), descending.end());

        for (const uint32_t position : descending)
            found->rows.erase(found->rows.begin() + static_cast<std::ptrdiff_t>(position));

        if (!descending.empty())
            landed(*found);

        return RowsEdited{PlayerOutcome::done, found->entry.structure, {}, {}};
    };

    player.playlists.moveRows = [this](const std::string& id, uint64_t structure,
                                       const std::vector<uint32_t>& positions, uint32_t to) {
        const Lock guard(mutex_);
        ask(Call::moveRows, id);

        if (const auto refused = refusal(Call::moveRows))
            return failed<RowsEdited>(*refused);

        const auto found = find(id);

        auto moving = positions;
        std::sort(moving.begin(), moving.end());
        moving.erase(std::unique(moving.begin(), moving.end()), moving.end());

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        if (!facts.noSuchPlaylist) {
            facts.ownPlaylist = found->entry.role.has_value();
            facts.locked = found->locked;
            facts.rowsMoved = structure != found->entry.structure;
            facts.positionPastEnd =
                anyPastEnd(moving, found->rows.size()) || to > found->rows.size() - moving.size();
        }
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return RowsEdited{outcome, facts.noSuchPlaylist ? 0 : found->entry.structure, {}, {}};

        std::vector<uint32_t> order;
        for (uint32_t position = 0; position < found->rows.size(); ++position)
            if (!std::binary_search(moving.begin(), moving.end(), position))
                order.push_back(position);
        order.insert(order.begin() + to, moving.begin(), moving.end());

        reordered(*found, order);
        return RowsEdited{PlayerOutcome::done, found->entry.structure, {}, {}};
    };

    // Ascending on what `pattern` formats for each row, and stable, as foobar2000's sort is.
    // Byte order stands in for foobar2000's comparison, so a case's values must sort the same
    // under both.
    player.playlists.sortRows = [this](const std::string& id, uint64_t structure,
                                       const std::string& pattern) {
        const Lock guard(mutex_);
        ask(Call::sortRows, id);

        if (const auto refused = refusal(Call::sortRows))
            return SortedRows{*refused, 0, {}};

        const auto found = find(id);

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        if (!facts.noSuchPlaylist) {
            facts.ownPlaylist = found->entry.role.has_value();
            facts.locked = found->locked;
            facts.rowsMoved = structure != found->entry.structure;
        }
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return SortedRows{outcome, facts.noSuchPlaylist ? 0 : found->entry.structure, {}};

        const auto keyOf = [&found, &pattern](uint32_t position) {
            return formatted(found->rows[position], {pattern}).columns.front();
        };

        std::vector<uint32_t> order(found->rows.size());
        std::iota(order.begin(), order.end(), 0);
        std::stable_sort(order.begin(), order.end(), [&keyOf](uint32_t left, uint32_t right) {
            return keyOf(left) < keyOf(right);
        });

        reordered(*found, order);
        return SortedRows{PlayerOutcome::done, found->entry.structure, order};
    };

    // No role check, as fb2k/playlist_edits.cpp has none: a fill is how the scratch gets its rows.
    player.playlists.fill = [this](const std::string& id, const std::string& title,
                                   uint64_t structure, const std::vector<uint32_t>& ordinals,
                                   ExistingRows existing, Duplicates duplicates) {
        const Lock guard(mutex_);
        ask(Call::fill, id);

        const auto found = find(id);

        if (const auto refused = refusal(Call::fill)) {
            const auto base = found == playlists_.end() ? 0 : found->rows.size();
            return FillResult{*refused, positionsFrom(base, ordinals.size()), 0, {}};
        }

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        facts.locked = !facts.noSuchPlaylist && found->locked;
        facts.libraryMoved = !libraryAt(structure);
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return failed<FillResult>(outcome);

        if (!title.empty())
            found->entry.title = title;

        std::vector<FakeRow> named;
        std::transform(ordinals.begin(), ordinals.end(), std::back_inserter(named), libraryTrack);

        auto split = splitDuplicates(ordinals, alreadyHeld(found->rows, named, duplicates));
        const auto inserted = rowsAt(named, split.inserted);

        const bool emptied = existing == ExistingRows::replaced && !found->rows.empty();
        if (existing == ExistingRows::replaced)
            found->rows.clear();

        const auto base = found->rows.size();
        found->rows.insert(found->rows.end(), inserted.begin(), inserted.end());

        if (emptied || !inserted.empty())
            landed(*found);

        return FillResult{PlayerOutcome::done, positionsFrom(base, inserted.size()),
                          found->entry.structure, std::move(split.skipped)};
    };

    player.playlists.resolveOwn = [this](OwnPlaylistRole role, const std::string& title) {
        const Lock guard(mutex_);
        ask(Call::resolveOwn);

        if (const auto refused = refusal(Call::resolveOwn))
            return playlistFailure(*refused);

        auto found = std::find_if(playlists_.begin(), playlists_.end(),
                                  [role](const Held& held) { return held.entry.role == role; });

        if (found == playlists_.end()) {
            make(title).entry.role = role;
            found = playlists_.end() - 1;
        }

        PlaylistResult result;
        result.playlist = annotate(static_cast<size_t>(found - playlists_.begin()));
        return result;
    };

    player.playlists.emptyOwn = [this](OwnPlaylistRole role) {
        const Lock guard(mutex_);
        ask(Call::emptyOwn);

        if (const auto refused = refusal(Call::emptyOwn))
            return playlistFailure(*refused);

        const auto found =
            std::find_if(playlists_.begin(), playlists_.end(),
                         [role](const Held& held) { return held.entry.role == role; });
        if (found == playlists_.end())
            return PlaylistResult{};

        if (!found->rows.empty()) {
            found->rows.clear();
            landed(*found);
        }

        PlaylistResult result;
        result.playlist = annotate(static_cast<size_t>(found - playlists_.begin()));
        return result;
    };

    player.autoPlaylists.create = [this](const AutoPlaylistSpec& spec, int maxAutoPlaylists) {
        const Lock guard(mutex_);
        ask(Call::createAutoPlaylist);

        if (const auto refused = refusal(Call::createAutoPlaylist))
            return playlistFailure(*refused);

        const auto existing = listing();

        if (auto room = roomForAnotherAutoPlaylist(existing, maxAutoPlaylists);
            room.outcome != PlayerOutcome::done)
            return room;

        if (keyTaken(existing, spec.key, {}))
            return playlistFailure(PlayerOutcome::keyInUse, spec.key);

        if (const auto preview = previews_.find(spec.query);
            preview != previews_.end() && !preview->second.valid)
            return playlistFailure(PlayerOutcome::queryInvalid, preview->second.error);

        auto& made = make(spec.title);
        made.entry.isAutoPlaylist = true;
        made.entry.managed = spec;

        PlaylistResult result;
        result.playlist = annotate(playlists_.size() - 1);
        return result;
    };

    player.autoPlaylists.update = [this](const std::string& id, const AutoPlaylistSpec& spec) {
        const Lock guard(mutex_);
        ask(Call::updateAutoPlaylist, id);

        if (const auto refused = refusal(Call::updateAutoPlaylist))
            return playlistFailure(*refused);

        const auto found = find(id);

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        facts.ownPlaylist = !facts.noSuchPlaylist && found->entry.role.has_value();
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return playlistFailure(outcome);

        if (!found->entry.isAutoPlaylist)
            return playlistFailure(PlayerOutcome::notAnAutoPlaylist);

        if (!found->entry.managed) {
            if (!spec.key.empty())
                return playlistFailure(PlayerOutcome::keyRefused);
        } else {
            if (keyTaken(listing(), spec.key, id))
                return playlistFailure(PlayerOutcome::keyInUse, spec.key);

            if (const auto preview = previews_.find(spec.query);
                preview != previews_.end() && !preview->second.valid)
                return playlistFailure(PlayerOutcome::queryInvalid, preview->second.error);

            found->entry.managed = spec;
        }

        if (!spec.title.empty())
            found->entry.title = spec.title;

        PlaylistResult result;
        result.playlist = annotate(static_cast<size_t>(found - playlists_.begin()));
        return result;
    };

    player.autoPlaylists.remove = [this](const std::string& id) {
        const Lock guard(mutex_);
        ask(Call::removeAutoPlaylist, id);

        if (const auto refused = refusal(Call::removeAutoPlaylist))
            return playlistFailure(*refused);

        const auto found = find(id);

        PlaylistEditFacts facts;
        facts.noSuchPlaylist = found == playlists_.end();
        facts.ownPlaylist = !facts.noSuchPlaylist && found->entry.role.has_value();
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return playlistFailure(outcome);

        if (!found->entry.isAutoPlaylist)
            return playlistFailure(PlayerOutcome::notAnAutoPlaylist);

        facts.locked = found->locked;
        if (const auto outcome = playlistEditRefusal(facts); outcome != PlayerOutcome::done)
            return playlistFailure(outcome);

        playlists_.erase(found);

        PlaylistResult result;
        result.playlist.id = id;
        return result;
    };

    player.autoPlaylists.preview = [this](const std::string& query, bool withRows) {
        const Lock guard(mutex_);
        ask(Call::previewQuery);
        previewsAskingRows_.push_back(withRows);

        if (const auto refused = refusal(Call::previewQuery))
            return failed<PreviewResult>(*refused);

        PreviewResult answer;
        answer.valid = true;
        answer.libraryEnabled = true;

        if (const auto found = previews_.find(query); found != previews_.end())
            answer = found->second;

        answer.hasRows = withRows && answer.valid;
        if (!answer.hasRows) {
            answer.structure = 0;
            answer.ordinals.clear();
        }
        return answer;
    };

    player.queue.read = [this] {
        const Lock guard(mutex_);
        ask(Call::readQueue);

        if (const auto refused = refusal(Call::readQueue))
            return failed<QueueRead>(*refused);

        QueueRead read;
        read.revision = queueRevision();
        read.entries = queue_;
        return read;
    };

    player.queue.addPlaylistRows = [this](const std::string& id,
                                          const std::vector<uint32_t>& positions,
                                          std::optional<QueuePosition> at) {
        const Lock guard(mutex_);
        ask(Call::queueRows, id);
        changeTheQueueIfAsked();

        const auto found = find(id);

        if (const auto refused = refusal(Call::queueRows))
            return *refused;

        QueueEditFacts facts;
        facts.queueMoved = at && at->revision != queueRevision();
        facts.noSuchPlaylist = found == playlists_.end();
        facts.positionPastEnd =
            !facts.noSuchPlaylist &&
            (anyPastEnd(positions, found->rows.size()) || (at && at->index > queue_.size()));
        if (const auto outcome = queueEditRefusal(facts); outcome != PlayerOutcome::done)
            return outcome;

        std::vector<QueuedTrack> entries;
        for (const uint32_t position : positions) {
            auto entry = queuedFrom(found->rows[position]);
            entry.location = PlayingLocation{id, position};
            entries.push_back(std::move(entry));
        }

        insertIntoQueue(std::move(entries), at);
        return PlayerOutcome::done;
    };

    player.queue.addLibraryTracks = [this](uint64_t structure,
                                           const std::vector<uint32_t>& ordinals,
                                           std::optional<QueuePosition> at) {
        const Lock guard(mutex_);
        ask(Call::queueTracks);
        changeTheQueueIfAsked();

        if (const auto refused = refusal(Call::queueTracks))
            return *refused;

        QueueEditFacts facts;
        facts.queueMoved = at && at->revision != queueRevision();
        facts.libraryMoved = !libraryAt(structure);
        facts.positionPastEnd = at && at->index > queue_.size();
        if (const auto outcome = queueEditRefusal(facts); outcome != PlayerOutcome::done)
            return outcome;

        std::vector<QueuedTrack> entries;
        std::transform(ordinals.begin(), ordinals.end(), std::back_inserter(entries),
                       [](uint32_t ordinal) { return queuedFrom(libraryTrack(ordinal)); });

        insertIntoQueue(std::move(entries), at);
        return PlayerOutcome::done;
    };

    player.queue.moveEntry = [this](uint32_t from, uint32_t to, uint64_t revision) {
        const Lock guard(mutex_);
        ask(Call::moveQueueEntry);
        changeTheQueueIfAsked();

        if (const auto refused = queueRefusal(Call::moveQueueEntry, revision,
                                              from >= queue_.size() || to >= queue_.size()))
            return *refused;

        auto entry = queue_[from];
        queue_.erase(queue_.begin() + from);
        queue_.insert(queue_.begin() + to, std::move(entry));
        queueChanged();
        return PlayerOutcome::done;
    };

    player.queue.removeEntry = [this](uint32_t index, uint64_t revision) {
        const Lock guard(mutex_);
        ask(Call::removeQueueEntry);
        changeTheQueueIfAsked();

        if (const auto refused =
                queueRefusal(Call::removeQueueEntry, revision, index >= queue_.size()))
            return *refused;

        queue_.erase(queue_.begin() + index);
        queueChanged();
        return PlayerOutcome::done;
    };

    player.queue.clear = [this] {
        const Lock guard(mutex_);
        ask(Call::clearQueue);

        if (const auto refused = refusal(Call::clearQueue))
            return *refused;

        queue_.clear();
        queueChanged();
        return PlayerOutcome::done;
    };

    player.playback.playPlaylistRow = [this](const std::string& id, uint32_t index) {
        const Lock guard(mutex_);
        ask(Call::playRow, id);

        if (const auto refused = refusal(Call::playRow))
            return *refused;

        const auto found = find(id);
        if (found == playlists_.end())
            return PlayerOutcome::noSuchPlaylist;
        if (index >= found->rows.size())
            return PlayerOutcome::positionPastEnd;

        playing_ = PlayingLocation{id, index};
        return PlayerOutcome::done;
    };

    return player;
}

}  // namespace jean::testing
