#include "core/routes_library.h"

#include "core/artwork.h"
#include "core/documents.h"
#include "core/http_responses.h"
#include "core/library_entities.h"
#include "core/library_roles.h"
#include "core/library_rows.h"
#include "core/local_time.h"
#include "core/ordinal_sets.h"
#include "core/playlist_find.h"
#include "core/tag_write.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <functional>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string_view>
#include <utility>

namespace jean {

namespace {

// A refresh walks every track in the player's library, so this is a rate a person at a
// button can keep up with and a looping client cannot.
constexpr int kRefreshBurst = 3;
constexpr auto kRefreshRefill = std::chrono::seconds(30);

// Rating a box set is a couple of hundred writes one after another, each rewriting a file, so
// what this bounds is a client stuck in a loop.
constexpr int kTagWriteBurst = 200;
constexpr auto kTagWriteRefill = std::chrono::milliseconds(50);

// Jean reads a track back only after a rating write timed out, one read per write, so this
// budget is the tag writes' own: what it bounds is a client stuck in a loop, each read of which
// evaluates columns the client wrote.
constexpr int kTrackReadBurst = kTagWriteBurst;
constexpr auto kTrackReadRefill = kTagWriteRefill;

constexpr int kLibraryReadBurst = 200;
constexpr auto kLibraryReadRefill = std::chrono::milliseconds(50);

// Opaque bytes with a magic number of their own, so nothing on the way to the client sniffs,
// transcodes or reformats them; contract/openapi.yaml is the only description of what is inside.
constexpr char kLibraryBytes[] = "application/octet-stream";

// Order is the client's to choose and does not make two declarations different: it decides
// only where a column lands in the snapshot's own array.
bool sameDeclaration(std::vector<std::string> a, std::vector<std::string> b) {
    std::sort(a.begin(), a.end());
    std::sort(b.begin(), b.end());

    return a == b;
}

struct RowsRead {
    enum class Kind { rows, structureMoved, badOrdinals, declarationMoved } kind = Kind::rows;
    std::string bytes;
};

RowsRead rowsFrom(const Snapshot& snapshot, const RowsRequest& asked) {
    if (snapshot.structure != asked.structure)
        return {RowsRead::Kind::structureMoved, {}};

    std::vector<std::string> held;
    for (size_t field = kSpineFieldCount; field < snapshot.columns.size(); ++field)
        held.push_back(snapshot.columns[field].name);
    if (!sameDeclaration(held, asked.declaration.columns))
        return {RowsRead::Kind::declarationMoved, {}};

    const size_t tracks = snapshot.trackCount();
    if (std::any_of(asked.ordinals.begin(), asked.ordinals.end(),
                    [tracks](uint32_t ordinal) { return ordinal >= tracks; }))
        return {RowsRead::Kind::badOrdinals, {}};

    return {RowsRead::Kind::rows, serialiseRows(snapshot, asked.ordinals)};
}

struct RunsRead {
    std::shared_ptr<const LibraryRuns> runs;
    uint64_t structure = 0;
    uint64_t revision = 0;
};

std::string runsDocument(const RunsRead& read) {
    return nlohmann::json{{"structure", read.structure},
                          {"revision", read.revision},
                          {"lengths", read.runs->lengths},
                          {"covers", read.runs->covers},
                          {"untagged", read.runs->untagged}}
        .dump();
}

std::optional<uint32_t> subsongAsked(const httplib::Request& req) {
    if (!req.has_param("subsong"))
        return 0;

    uint64_t asked = 0;
    if (!readDecimal(req.get_param_value("subsong"), asked) ||
        asked > std::numeric_limits<uint32_t>::max())
        return std::nullopt;

    return static_cast<uint32_t>(asked);
}

int64_t systemNowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

struct OrdinalAsked {
    OrdinalTrackRef ref;
    std::string refusal;

    bool ok() const { return refusal.empty(); }
};

// The query-string reading of the pair core/tag_write.cpp's readOrdinalAddress parses from a
// JSON body; kBadOrdinal and kBadOrdinalStructure are the one refusal text for both.
OrdinalAsked ordinalAsked(const httplib::Request& req) {
    OrdinalAsked asked;

    uint64_t ordinal = 0;
    if (!readDecimal(req.get_param_value("ordinal"), ordinal) ||
        ordinal > std::numeric_limits<uint32_t>::max()) {
        asked.refusal = kBadOrdinal;
        return asked;
    }
    asked.ref.ordinal = static_cast<uint32_t>(ordinal);

    if (!req.has_param("structure") ||
        !readDecimal(req.get_param_value("structure"), asked.ref.structure)) {
        asked.refusal = kBadOrdinalStructure;
        return asked;
    }

    return asked;
}

void respondTrackRead(httplib::Response& res, const LibraryTrackRead& read) {
    if (failed(read, res))
        return;

    if (!read.held) {
        respondError(res, 404, kNoSuchLibraryTrack);
        return;
    }

    respond(res, 200, libraryTrackDocument(read.columns));
}

struct QuestionParameters {
    std::span<const std::string_view> owned;
    std::span<const std::string_view> required;
};

constexpr std::array<std::string_view, 2> kAlbumOwned{"name", "by"};
constexpr std::array<std::string_view, 1> kAlbumRequired{"name"};
constexpr std::array<std::string_view, 2> kArtistOwned{"name", "splitsCredits"};
constexpr std::array<std::string_view, 2> kArtistRequired{"name", "splitsCredits"};
constexpr std::array<std::string_view, 1> kGenreOwned{"name"};
constexpr std::array<std::string_view, 1> kGenreRequired{"name"};
constexpr std::array<std::string_view, 4> kSearchOwned{"query", "limit", "entityLimit",
                                                       "splitsCredits"};

constexpr std::array<std::string_view, 3> kCreditsOwned{"splitsCredits", "structure", "ordinal"};
constexpr std::array<std::string_view, 3> kValuesOwned{"field", "prefix", "limit"};

constexpr std::array<std::string_view, 1> kPlaylistRunsOwned{"structure"};
constexpr std::array<std::string_view, 2> kPlaylistFindOwned{"query", "structure"};

constexpr size_t kMaxQueryBytes = 1024;

constexpr std::array<std::pair<std::string_view, ValueField>, 4> kValueFields{{
    {"artist", ValueField::artist},
    {"albumArtist", ValueField::albumArtist},
    {"album", ValueField::album},
    {"genre", ValueField::genre},
}};

QuestionParameters parametersOf(const LibraryRoutes::Question kind) {
    switch (kind) {
        case LibraryRoutes::Question::album:
            return {kAlbumOwned, kAlbumRequired};
        case LibraryRoutes::Question::artist:
            return {kArtistOwned, kArtistRequired};
        case LibraryRoutes::Question::genre:
            return {kGenreOwned, kGenreRequired};
        case LibraryRoutes::Question::search:
            return {kSearchOwned, kSearchOwned};
        case LibraryRoutes::Question::credits:
            return {kCreditsOwned, kCreditsOwned};
        case LibraryRoutes::Question::values:
            return {kValuesOwned, kValuesOwned};
    }
    return {};
}

constexpr std::array<std::string_view, 1> kSummaryOwned{"genres"};

std::optional<bool> genresAsked(const httplib::Request& req) {
    if (!req.has_param("genres"))
        return false;

    const std::string value = req.get_param_value("genres");
    if (value != "true" && value != "false")
        return std::nullopt;
    return value == "true";
}

bool listsName(std::span<const std::string_view> names, const std::string_view name) {
    return std::find(names.begin(), names.end(), name) != names.end();
}

struct QuestionAsked {
    LibraryRefusal refusal = LibraryRefusal::none;
    std::string detail;
    std::string name;
    std::optional<std::string> by;
    bool splitsCredits = false;
    std::string query;
    size_t limit = 0;
    size_t entityLimit = 0;
    uint64_t structure = 0;
    size_t ordinal = 0;
    ValueField field = ValueField::artist;
    std::string prefix;

    bool ok() const { return refusal == LibraryRefusal::none; }
};

using ParameterReader = std::optional<std::string> (*)(const std::string& value,
                                                       QuestionAsked& asked);

struct OwnedParameter {
    std::string_view name;
    ParameterReader read;
};

std::optional<std::string> readCount(const std::string_view name, const std::string& value,
                                     size_t& count) {
    uint64_t parsed = 0;
    if (!readDecimal(value, parsed))
        return "'" + std::string(name) + "' must be a whole number of 0 or more";

    count = static_cast<size_t>(parsed);
    return std::nullopt;
}

constexpr std::array kOwnedParameters{
    OwnedParameter{"name",
                   [](const std::string& value, QuestionAsked& asked) {
                       asked.name = value;
                       return std::optional<std::string>{};
                   }},
    OwnedParameter{"by",
                   [](const std::string& value, QuestionAsked& asked) {
                       if (!value.empty())
                           asked.by = value;
                       return std::optional<std::string>{};
                   }},
    OwnedParameter{
        "query",
        [](const std::string& value, QuestionAsked& asked) -> std::optional<std::string> {
            if (value.size() > kMaxQueryBytes)
                return "'query' must be at most " + std::to_string(kMaxQueryBytes) + " bytes";

            asked.query = value;
            return std::nullopt;
        }},
    OwnedParameter{
        "prefix",
        [](const std::string& value, QuestionAsked& asked) -> std::optional<std::string> {
            if (value.size() > kMaxQueryBytes)
                return "'prefix' must be at most " + std::to_string(kMaxQueryBytes) + " bytes";

            asked.prefix = value;
            return std::nullopt;
        }},
    OwnedParameter{
        "field",
        [](const std::string& value, QuestionAsked& asked) -> std::optional<std::string> {
            const auto named =
                std::find_if(kValueFields.begin(), kValueFields.end(),
                             [&value](const auto& candidate) { return candidate.first == value; });
            if (named == kValueFields.end())
                return "'field' must be artist, albumArtist, album or genre";

            asked.field = named->second;
            return std::nullopt;
        }},
    OwnedParameter{
        "structure",
        [](const std::string& value, QuestionAsked& asked) -> std::optional<std::string> {
            if (!readDecimal(value, asked.structure))
                return "'structure' must be a string of decimal digits";
            return std::nullopt;
        }},
    OwnedParameter{"ordinal",
                   [](const std::string& value, QuestionAsked& asked) {
                       return readCount("ordinal", value, asked.ordinal);
                   }},
    OwnedParameter{"limit",
                   [](const std::string& value, QuestionAsked& asked) {
                       return readCount("limit", value, asked.limit);
                   }},
    OwnedParameter{"entityLimit",
                   [](const std::string& value, QuestionAsked& asked) {
                       return readCount("entityLimit", value, asked.entityLimit);
                   }},
    OwnedParameter{
        "splitsCredits",
        [](const std::string& value, QuestionAsked& asked) -> std::optional<std::string> {
            if (value != "true" && value != "false")
                return "'splitsCredits' must be true or false";

            asked.splitsCredits = value == "true";
            return std::nullopt;
        }},
};

const OwnedParameter& ownedParameterNamed(const std::string_view name) {
    return *std::find_if(kOwnedParameters.begin(), kOwnedParameters.end(),
                         [name](const OwnedParameter& held) { return held.name == name; });
}

QuestionAsked questionAsked(const httplib::Request& req, const QuestionParameters& parameters) {
    QuestionAsked asked;
    const auto refuse = [&asked](LibraryRefusal refusal, std::string detail) {
        asked.refusal = refusal;
        asked.detail = std::move(detail);
        return asked;
    };

    for (const auto name : parameters.required) {
        if (!req.has_param(std::string(name)))
            return refuse(LibraryRefusal::unacceptableQuestion,
                          "'" + std::string(name) + "' is required");
    }

    for (const auto name : parameters.owned) {
        const auto refusal =
            ownedParameterNamed(name).read(req.get_param_value(std::string(name)), asked);
        if (refusal)
            return refuse(LibraryRefusal::unacceptableQuestion, *refusal);
    }

    for (const auto& [name, value] : req.params) {
        if (listsName(parameters.owned, name) && req.get_param_value_count(name) > 1)
            return refuse(LibraryRefusal::duplicateQuestion, "'" + name + "' is named twice");
    }

    return asked;
}

}  // namespace

LibraryRoutes::LibraryRoutes(const LibraryCalls& calls, const Library* library,
                             const LiveSettings& settings, uint64_t runId,
                             const RateLimitClock& clock)
    : calls_(calls),
      library_(library),
      settings_(settings),
      runId_(runId),
      rebuilds_(kRefreshBurst, kRefreshRefill, {"library rebuilds", "build"}, clock),
      tagWrites_(kTagWriteBurst, kTagWriteRefill, {"tag writes", "make"}, clock),
      trackReads_(kTrackReadBurst, kTrackReadRefill, {"library track reads"}, clock),
      summaryReads_(kLibraryReadBurst, kLibraryReadRefill, {"library summary reads"}, clock),
      questionReads_(kLibraryReadBurst, kLibraryReadRefill, {"library questions"}, clock),
      runReads_(kLibraryReadBurst, kLibraryReadRefill, {"library run reads"}, clock),
      playlistRunReads_(kLibraryReadBurst, kLibraryReadRefill, {"playlist run reads"}, clock),
      playlistSearches_(kLibraryReadBurst, kLibraryReadRefill, {"playlist searches"}, clock),
      rowReads_(kRowsBurst, kRowsRefill),
      clock_(clock),
      summaryNow_(systemNowMs) {}

void LibraryRoutes::summaryClock(std::function<int64_t()> nowMs) {
    summaryNow_ = std::move(nowMs);
}

void LibraryRoutes::declare(std::vector<std::string> columns) {
    const std::lock_guard<std::mutex> lock(declarationLock_);
    declared_ = std::move(columns);
}

std::vector<std::string> LibraryRoutes::declaration() const {
    const std::lock_guard<std::mutex> lock(declarationLock_);
    return declared_;
}

// The set asked for is not the one that is ready. Say what is ready, start building what was
// asked for, and let the client poll GET /state.
void LibraryRoutes::startBuilding(httplib::Response& res, const std::vector<std::string>& columns,
                                  const Library::State& state) {
    if (unavailable(calls_.refresh, res, kNoLibrary))
        return;

    if (!sameDeclaration(declaration(), columns) || !state.build) {
        if (tooFast(rebuilds_, res, kRefreshingTooFast))
            return;

        declare(columns);
        calls_.refresh(columns, RebuildReason::columnsDeclared);
    }

    respond(res, 202, libraryDocument(state));
}

std::shared_ptr<LibraryRoutes::HeldSummary> LibraryRoutes::heldSummaryFor(const SummaryKey& key) {
    const std::lock_guard<std::mutex> lock(heldSummariesLock_);

    const auto held = std::find_if(heldSummaries_.begin(), heldSummaries_.end(),
                                   [&key](const auto& entry) { return entry->key == key; });
    if (held != heldSummaries_.end())
        return *held;

    heldSummaries_.push_back(std::make_shared<HeldSummary>(key));
    while (heldSummaries_.size() > kHeldSummaries)
        heldSummaries_.pop_front();

    return heldSummaries_.back();
}

SharedBytes LibraryRoutes::summaryOf(HeldSummary& held,
                                     const std::map<std::string, std::string>& roles,
                                     int64_t nowMs) {
    std::call_once(held.computed, [this, &held, &roles, nowMs] {
        held.bytes = library_->read([this, &held, &roles, nowMs](const Snapshot& snapshot) {
            if (snapshot.structure != held.key.structure || snapshot.revision != held.key.revision)
                return SharedBytes();

            const auto indices = rolesIn(snapshot, roles);
            if (!indices)
                return SharedBytes();

            ++summaryComputations_;
            return std::make_shared<const std::string>(
                summariseLibrary(snapshot, *indices, nowMs, systemLocalTime(),
                                 SummaryParts{.genres = held.key.genres}));
        });
    });
    return held.bytes;
}

std::optional<Library::State> LibraryRoutes::stateForRoles(httplib::Response& res,
                                                           const RolesAsked& roles) {
    auto state = library_->state();
    const auto verdict = rolesVerdict(state, declaration(), roles.expressions);
    if (verdict.kind == RolesVerdict::notYet) {
        respond(res, 202, libraryDocument(state));
        return std::nullopt;
    }

    if (verdict.kind == RolesVerdict::undeclared) {
        respondError(res, 409, undeclaredColumnMessage(verdict.expression));
        return std::nullopt;
    }

    return state;
}

void LibraryRoutes::summarise(const httplib::Request& req, httplib::Response& res) {
    const auto roles = rolesAsked(req, kSummaryRoleNames, kSummaryOwned);
    if (!roles.ok()) {
        respondRefusal(res, roles.refusal, roles.detail);
        return;
    }

    const auto genres = genresAsked(req);
    if (!genres) {
        respondRefusal(res, LibraryRefusal::unacceptableQuestion, "'genres' must be true or false");
        return;
    }

    if (unavailable(library_, res, kNoLibrary))
        return;

    if (tooFast(summaryReads_, res, kReadingSummariesTooFast))
        return;

    const auto state = stateForRoles(res, roles);
    if (!state)
        return;

    const int64_t nowMs = summaryNow_();
    const uint32_t date = systemLocalTime().date(nowMs);
    const std::string key = rolesKey(roles.expressions);

    const auto name = snapshotTag(*state, runId_) + "-d" + std::to_string(date) + "-h" +
                      std::to_string(std::hash<std::string>{}(key)) + (*genres ? "-g" : "");

    if (alreadyHoldsCurrent(req, name)) {
        sendIfChanged(req, res, name, "application/json", [] { return SharedBytes(); });
        return;
    }

    const auto held = heldSummaryFor({state->structure, state->revision, date, key, *genres});
    if (!summaryOf(*held, roles.expressions, nowMs)) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    sendIfChanged(
        req, res, name, "application/json", [&held] { return held->bytes; }, held->packing);
}

void LibraryRoutes::readRuns(const httplib::Request& req, httplib::Response& res) {
    const auto roles = rolesAsked(req, kAllRoleNames, {});
    if (!roles.ok()) {
        respondRefusal(res, roles.refusal, roles.detail);
        return;
    }

    if (unavailable(library_, res, kNoLibrary))
        return;

    if (tooFast(runReads_, res, kReadingRunsTooFast))
        return;

    if (!stateForRoles(res, roles))
        return;

    const auto read = library_->read([&](const Snapshot& snapshot) -> std::optional<RunsRead> {
        const auto indices = rolesIn(snapshot, roles.expressions);
        if (!indices)
            return std::nullopt;
        return RunsRead{runs_.of(snapshot, *indices), snapshot.structure, snapshot.revision};
    });
    if (!read) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    const auto name = "r" + std::to_string(runsHash(*read->runs));
    sendIfChanged(req, res, name, "application/json", [&read] { return runsDocument(*read); });
}

namespace {

using PlaylistColumns = LibraryRoutes::PlaylistColumns;

std::optional<LibraryRoles> rolesOfCopy(const Snapshot& snapshot, const RolesAsked& asked,
                                        const PlaylistTracksRead& read,
                                        const std::vector<std::string>& columns,
                                        PlaylistColumns columnsOf) {
    if (snapshot.structure != read.libraryStructure)
        return std::nullopt;

    const auto roles = rolesIn(snapshot, asked.expressions);
    if (!roles || columnsOf(snapshot, *roles) != columns)
        return std::nullopt;

    return roles;
}

nlohmann::ordered_json playlistCounters(const PlaylistTracksRead& read) {
    return {{"structure", std::to_string(read.structure)},
            {"revision", std::to_string(read.revision)}};
}

std::string playlistRunsDocument(const PlaylistTracksRead& read, const PlaylistRuns& runs) {
    auto document = playlistCounters(read);
    document["lengths"] = runs.lengths;
    document["mostPlays"] = numberJson(runs.mostPlays);
    document["albumCount"] = runs.albumCount;
    document["trackCount"] = runs.trackCount;
    document["seconds"] = numberJson(runs.seconds);
    document["earliestYear"] = optionalNumberJson(runs.earliestYear);
    document["latestYear"] = optionalNumberJson(runs.latestYear);
    return document.dump();
}

}  // namespace

struct LibraryRoutes::PlaylistCopy {
    PlaylistTracksRead read;
    std::vector<std::string> columns;
};

// The copy cannot be taken inside Library::read: the player's reader may wait on the main thread,
// which a rebuild waiting to replace the snapshot would then be stalled behind.
std::optional<LibraryRoutes::PlaylistCopy> LibraryRoutes::copyPlaylist(
    httplib::Response& res, const std::string& playlistId, uint64_t structure,
    const RolesAsked& roles, const PlaylistTrackReader& readTracks, PlaylistColumns columnsOf) {
    if (!stateForRoles(res, roles))
        return std::nullopt;

    auto columns =
        library_->read([&](const Snapshot& snapshot) -> std::optional<std::vector<std::string>> {
            const auto indices = rolesIn(snapshot, roles.expressions);
            if (!indices)
                return std::nullopt;
            return columnsOf(snapshot, *indices);
        });
    if (!columns) {
        respond(res, 202, libraryDocument(library_->state()));
        return std::nullopt;
    }

    PlaylistCopy copy{readTracks(playlistId, *columns), std::move(*columns)};
    if (failed(copy.read, res))
        return std::nullopt;

    if (copy.read.structure != structure) {
        respondOutcome(res, PlayerOutcome::rowsMoved);
        return std::nullopt;
    }

    return copy;
}

void LibraryRoutes::readPlaylistRuns(const httplib::Request& req, httplib::Response& res,
                                     const PlaylistTrackReader& readTracks) {
    const auto id = req.matches[1].str();
    if (playlistIdRefused(id, res))
        return;

    const auto roles = rolesAsked(req, kAllRoleNames, kPlaylistRunsOwned);
    if (!roles.ok()) {
        respondRefusal(res, roles.refusal, roles.detail);
        return;
    }

    const auto asked = questionAsked(req, {kPlaylistRunsOwned, kPlaylistRunsOwned});
    if (!asked.ok()) {
        respondRefusal(res, asked.refusal, asked.detail);
        return;
    }

    if (unavailable(readTracks, res, kNoPlaylistRows))
        return;

    if (unavailable(library_, res, kNoLibrary))
        return;

    if (tooFast(playlistRunReads_, res, kReadingPlaylistRunsTooFast))
        return;

    const auto copy =
        copyPlaylist(res, id, asked.structure, roles, readTracks, playlistRunsColumns);
    if (!copy)
        return;

    const auto runs =
        library_->read([&](const Snapshot& snapshot) -> std::shared_ptr<const PlaylistRuns> {
            const auto indices =
                rolesOfCopy(snapshot, roles, copy->read, copy->columns, playlistRunsColumns);
            if (!indices)
                return nullptr;
            return playlistRuns_.of(id, copy->read, snapshot, *indices);
        });
    if (!runs) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    const auto name = "p" + std::to_string(playlistRunsHash(*runs));
    sendIfChanged(req, res, name, "application/json",
                  [&] { return playlistRunsDocument(copy->read, *runs); });
}

void LibraryRoutes::findInPlaylist(const httplib::Request& req, httplib::Response& res,
                                   const PlaylistTrackReader& readTracks) {
    const auto id = req.matches[1].str();
    if (playlistIdRefused(id, res))
        return;

    const auto roles = rolesAsked(req, kAllRoleNames, kPlaylistFindOwned);
    if (!roles.ok()) {
        respondRefusal(res, roles.refusal, roles.detail);
        return;
    }

    const auto asked = questionAsked(req, {kPlaylistFindOwned, kPlaylistFindOwned});
    if (!asked.ok()) {
        respondRefusal(res, asked.refusal, asked.detail);
        return;
    }

    if (unavailable(readTracks, res, kNoPlaylistRows))
        return;

    if (unavailable(library_, res, kNoLibrary))
        return;

    if (tooFast(playlistSearches_, res, kSearchingPlaylistsTooFast))
        return;

    const auto copy =
        copyPlaylist(res, id, asked.structure, roles, readTracks, playlistFindColumns);
    if (!copy)
        return;

    const auto matched =
        library_->read([&](const Snapshot& snapshot) -> std::optional<std::vector<uint32_t>> {
            const auto indices =
                rolesOfCopy(snapshot, roles, copy->read, copy->columns, playlistFindColumns);
            if (!indices)
                return std::nullopt;

            const auto folded = questions_.searchTextFor(snapshot, *indices);
            const auto glyphText =
                searchesMarks(asked.query) ? questions_.glyphTextFor(snapshot, *indices) : folded;
            return playlistMatches(snapshot, *indices, *folded, *glyphText, copy->read.rows,
                                   asked.query);
        });
    if (!matched) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    auto document = playlistCounters(copy->read);
    document["matched"] = ordinalSetDocument(*matched, copy->read.rows.size());
    respond(res, 200, document.dump());
    res.set_header("Cache-Control", kAskEveryTime);
    res.set_header("Vary", "Accept-Encoding");
}

namespace {

struct QuestionRead {
    enum class Kind { answered, structureMoved, pastTheEnd } kind = Kind::answered;
    std::string body;
};

}  // namespace

void LibraryRoutes::answerQuestion(const Question kind, const httplib::Request& req,
                                   httplib::Response& res) {
    const auto parameters = parametersOf(kind);
    const auto roles = rolesAsked(req, kAllRoleNames, parameters.owned);
    if (!roles.ok()) {
        respondRefusal(res, roles.refusal, roles.detail);
        return;
    }

    const auto asked = questionAsked(req, parameters);
    if (!asked.ok()) {
        respondRefusal(res, asked.refusal, asked.detail);
        return;
    }

    if (unavailable(library_, res, kNoLibrary))
        return;

    if (tooFast(questionReads_, res, kReadingQuestionsTooFast))
        return;

    const auto state = stateForRoles(res, roles);
    if (!state)
        return;
    const auto read = library_->read([&](const Snapshot& snapshot) -> std::optional<QuestionRead> {
        const auto indices = rolesIn(snapshot, roles.expressions);
        if (!indices)
            return std::nullopt;

        nlohmann::json answer;
        switch (kind) {
            case Question::album:
                answer = questions_.album(snapshot, *indices, asked.name, asked.by);
                break;
            case Question::artist:
                answer = questions_.artist(snapshot, *indices, asked.name, asked.splitsCredits);
                break;
            case Question::genre:
                answer = questions_.genre(snapshot, *indices, asked.name);
                break;
            case Question::search:
                answer = questions_.search(snapshot, *indices, asked.query, asked.limit,
                                           asked.entityLimit, asked.splitsCredits);
                break;
            case Question::credits:
                if (snapshot.structure != asked.structure)
                    return QuestionRead{QuestionRead::Kind::structureMoved, {}};
                if (asked.ordinal >= snapshot.trackCount())
                    return QuestionRead{QuestionRead::Kind::pastTheEnd, {}};
                answer = questions_.credits(
                    snapshot, *indices, static_cast<uint32_t>(asked.ordinal), asked.splitsCredits);
                break;
            case Question::values:
                answer =
                    questions_.values(snapshot, *indices, asked.field, asked.prefix, asked.limit);
                break;
        }
        return QuestionRead{QuestionRead::Kind::answered,
                            answer.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace)};
    });
    if (!read) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    switch (read->kind) {
        case QuestionRead::Kind::structureMoved:
            respondOutcome(res, ReadOutcome::structureMoved);
            return;
        case QuestionRead::Kind::pastTheEnd:
            respondRefusal(res, LibraryRefusal::unacceptableQuestion,
                           "'ordinal' is past the last track");
            return;
        case QuestionRead::Kind::answered:
            break;
    }

    respond(res, 200, read->body);
    res.set_header("Cache-Control", kAskEveryTime);
    res.set_header("Vary", "Accept-Encoding");
}

bool LibraryRoutes::readingRowsTooFast(httplib::Response& res, const std::string& client) {
    return perClientTooFast(rowReads_, client, clock_(), kReadingRowsTooFast, res);
}

void LibraryRoutes::readRows(const httplib::Request& req, httplib::Response& res) {
    const auto asked = parseRowsRequest(req.body);
    if (asked.refusal != PlaylistRefusal::none) {
        respondRefusal(res, asked.refusal);
        return;
    }
    if (!asked.declaration.ok()) {
        respondRefusal(res, asked.declaration.refusal, asked.declaration.detail);
        return;
    }

    if (unavailable(library_, res, kNoLibrary))
        return;

    if (readingRowsTooFast(res, req.remote_addr))
        return;

    const auto state = library_->state();
    if (!state.ready || !sameDeclaration(state.columns, asked.declaration.columns)) {
        startBuilding(res, asked.declaration.columns, state);
        return;
    }

    auto read =
        library_->read([&asked](const Snapshot& snapshot) { return rowsFrom(snapshot, asked); });
    switch (read.kind) {
        case RowsRead::Kind::structureMoved:
            respondOutcome(res, ReadOutcome::structureMoved);
            return;
        case RowsRead::Kind::badOrdinals:
            respondRefusal(res, PlaylistRefusal::badOrdinals);
            return;
        case RowsRead::Kind::declarationMoved:
            respond(res, 202, libraryDocument(library_->state()));
            return;
        case RowsRead::Kind::rows:
            break;
    }

    sendUnvalidated(req, res, std::make_shared<const std::string>(std::move(read.bytes)),
                    kLibraryBytes);
}

void LibraryRoutes::readTrack(const httplib::Request& req, httplib::Response& res) {
    // 'subsong' names a track only alongside 'track', but on its own it still announces the
    // library form the way POST /api/tags' kLibraryAddressFields does, so an ordinal sent beside
    // it is refused as two forms rather than silently picked over.
    const bool namesTrack = req.has_param("track") || req.has_param("subsong");
    const bool namesOrdinal = req.has_param("ordinal");

    if (namesTrack && namesOrdinal) {
        respondError(res, 400, kTwoTrackAddressForms);
        return;
    }

    if (namesOrdinal) {
        const auto asked = ordinalAsked(req);
        if (!asked.ok()) {
            respondError(res, 400, asked.refusal);
            return;
        }

        const auto declared = columnsDeclared(req);
        if (!declared.ok()) {
            respondRefusal(res, declared.refusal, declared.detail);
            return;
        }

        if (unavailable(calls_.readOrdinal, res, kNoLibrary))
            return;

        if (tooFast(trackReads_, res, kReadingTracksTooFast))
            return;

        respondTrackRead(res, calls_.readOrdinal(asked.ref, declared.columns));
        return;
    }

    if (!namesTrack) {
        respondError(res, 400, kNoTrackAddressForm);
        return;
    }

    const auto track = req.get_param_value("track");
    if (const auto refusal = trackAddressRefusal(track); !refusal.empty()) {
        respondError(res, 400, refusal);
        return;
    }

    const auto subsong = subsongAsked(req);
    if (!subsong) {
        respondError(res, 400, kBadSubsong);
        return;
    }

    const auto declared = columnsDeclared(req);
    if (!declared.ok()) {
        respondRefusal(res, declared.refusal, declared.detail);
        return;
    }

    if (unavailable(calls_.readTrack, res, kNoLibrary))
        return;

    if (tooFast(trackReads_, res, kReadingTracksTooFast))
        return;

    respondTrackRead(res, calls_.readTrack(track, *subsong, declared.columns));
}

void LibraryRoutes::addTo(httplib::Server& server) {
    server.Get("/api/library/summary", [this](const httplib::Request& req, httplib::Response& res) {
        summarise(req, res);
    });

    server.Get("/api/library/runs",
               [this](const httplib::Request& req, httplib::Response& res) { readRuns(req, res); });

    server.Get("/api/library/album", [this](const httplib::Request& req, httplib::Response& res) {
        answerQuestion(Question::album, req, res);
    });

    server.Get("/api/library/artist", [this](const httplib::Request& req, httplib::Response& res) {
        answerQuestion(Question::artist, req, res);
    });

    server.Get("/api/library/genre", [this](const httplib::Request& req, httplib::Response& res) {
        answerQuestion(Question::genre, req, res);
    });

    server.Get("/api/library/search", [this](const httplib::Request& req, httplib::Response& res) {
        answerQuestion(Question::search, req, res);
    });

    server.Get("/api/library/credits", [this](const httplib::Request& req, httplib::Response& res) {
        answerQuestion(Question::credits, req, res);
    });

    server.Get("/api/library/values", [this](const httplib::Request& req, httplib::Response& res) {
        answerQuestion(Question::values, req, res);
    });

    server.Post("/api/library/rows", [this](const httplib::Request& req, httplib::Response& res) {
        readRows(req, res);
    });

    server.Post("/api/library/refresh", [this](const httplib::Request&, httplib::Response& res) {
        if (!library_ || !calls_.refresh) {
            respondUnavailable(res, kNoLibrary);
            return;
        }

        if (tooFast(rebuilds_, res, kRefreshingTooFast))
            return;

        const auto state = library_->state();
        const auto columns = declaration();

        calls_.refresh(columns.empty() ? state.columns : columns, RebuildReason::dataChanged);
        respond(res, 202, libraryDocument(state));
    });

    server.Get("/api/track/library", [this](const httplib::Request& req, httplib::Response& res) {
        readTrack(req, res);
    });

    server.Post("/api/tags", [this](const httplib::Request& req, httplib::Response& res) {
        const auto request = parseTagWrite(req.body, *settings_.current());
        if (!request.ok()) {
            respondRefusal(res, request.refusal, request.detail);
            return;
        }

        if (!calls_.writeTags) {
            respondOutcome(res, TagWriteOutcome::unavailable);
            return;
        }

        if (tooFast(tagWrites_, res, [] { return tagFailureDocument(TagWriteOutcome::tooFast); }))
            return;

        const auto& ordinal = request.write.track.ordinal;
        if (ordinal && library_ && ordinal->structure != library_->state().structure) {
            respondOutcome(res, TagWriteOutcome::libraryRebuilt);
            return;
        }

        const auto outcome = calls_.writeTags(request.write);
        if (outcome != TagWriteOutcome::written) {
            respondOutcome(res, outcome);
            return;
        }

        respond(res, 200, tagWrittenDocument(request.write));
    });
}

}  // namespace jean
