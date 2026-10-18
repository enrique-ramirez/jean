#include "core/routes_library.h"

#include "core/artwork.h"
#include "core/documents.h"
#include "core/http_responses.h"
#include "core/library_roles.h"
#include "core/local_time.h"
#include "core/tag_write.h"
#include "core/text.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <functional>
#include <limits>
#include <map>
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

// A delta is asked for once per revision a client sees move, so the track read's depth is ample.
constexpr int kDeltaReadBurst = kTrackReadBurst;
constexpr auto kDeltaReadRefill = kTrackReadRefill;

constexpr int kSummaryReadBurst = kDeltaReadBurst;
constexpr auto kSummaryReadRefill = kDeltaReadRefill;

constexpr int kLibraryQuestionBurst = kDeltaReadBurst;
constexpr auto kLibraryQuestionRefill = kDeltaReadRefill;

// The snapshot and the deltas. Opaque bytes with a magic number of their own, so nothing on
// the way to the client sniffs, transcodes or reformats them; contract/openapi.yaml is the
// only description of what is inside.
constexpr char kLibraryBytes[] = "application/octet-stream";

// Order is the client's to choose and does not make two declarations different: it decides
// only where a column lands in the snapshot's own array.
bool sameColumns(std::vector<std::string> a, std::vector<std::string> b) {
    std::sort(a.begin(), a.end());
    std::sort(b.begin(), b.end());

    return a == b;
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

struct ChangesAsked {
    LibraryRequest request;
    uint64_t structure = 0;
};

ChangesAsked changesAsked(const httplib::Request& req) {
    ChangesAsked asked;
    if (!req.has_param("since")) {
        asked.request = refused<LibraryRequest>(LibraryRefusal::badSince, "'since' is required");
        return asked;
    }

    asked.request = parseLibraryRequest({}, req.get_param_value("since"));
    if (!asked.request.ok())
        return asked;

    if (!req.has_param("structure"))
        asked.request =
            refused<LibraryRequest>(LibraryRefusal::badSince, "'structure' is required");
    else if (!readDecimal(req.get_param_value("structure"), asked.structure))
        asked.request =
            refused<LibraryRequest>(LibraryRefusal::badSince, "'structure' must be a whole number");
    return asked;
}

void respondTrackRead(httplib::Response& res, const LibraryTrackRead& read) {
    if (read.outcome != PlayerOutcome::done) {
        respondOutcome(res, read.outcome);
        return;
    }

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

constexpr size_t kMaxQueryBytes = 1024;

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
    }
    return {};
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
      rebuilds_(kRefreshBurst, kRefreshRefill,
                "refusing library rebuilds: they are arriving faster than this component will "
                "build them, which usually means a client is looping",
                clock),
      tagWrites_(kTagWriteBurst, kTagWriteRefill,
                 "refusing tag writes: they are arriving faster than this component will make "
                 "them, which usually means a client is looping",
                 clock),
      trackReads_(kTrackReadBurst, kTrackReadRefill,
                  "refusing library track reads: they are arriving faster than this component "
                  "will answer them, which usually means a client is looping",
                  clock),
      deltaReads_(kDeltaReadBurst, kDeltaReadRefill,
                  "refusing library delta reads: they are arriving faster than this component "
                  "will answer them, which usually means a client is looping",
                  clock),
      summaryReads_(kSummaryReadBurst, kSummaryReadRefill,
                    "refusing library summary reads: they are arriving faster than this "
                    "component will answer them, which usually means a client is looping",
                    clock),
      questionReads_(kLibraryQuestionBurst, kLibraryQuestionRefill,
                     "refusing library questions: they are arriving faster than this component "
                     "will answer them, which usually means a client is looping",
                     clock),
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

// Shared with POST /library/refresh, because a build is a build however it was asked for.
bool LibraryRoutes::rebuildingTooFast(httplib::Response& res) {
    if (!rebuilds_.refuses())
        return false;

    respondTooFast(res, rebuilds_, errorDocument(kRefreshingTooFast));
    return true;
}

bool LibraryRoutes::readingTooFast(httplib::Response& res) {
    if (!trackReads_.refuses())
        return false;

    respondTooFast(res, trackReads_, errorDocument(kReadingTracksTooFast));
    return true;
}

bool LibraryRoutes::readingChangesTooFast(httplib::Response& res) {
    if (!deltaReads_.refuses())
        return false;

    respondTooFast(res, deltaReads_, errorDocument(kReadingChangesTooFast));
    return true;
}

bool LibraryRoutes::summarisingTooFast(httplib::Response& res) {
    if (!summaryReads_.refuses())
        return false;

    respondTooFast(res, summaryReads_, errorDocument(kReadingSummariesTooFast));
    return true;
}

bool LibraryRoutes::questioningTooFast(httplib::Response& res) {
    if (!questionReads_.refuses())
        return false;

    respondTooFast(res, questionReads_, errorDocument(kReadingQuestionsTooFast));
    return true;
}

bool LibraryRoutes::writingTagsTooFast(httplib::Response& res) {
    if (!tagWrites_.refuses())
        return false;

    respondTooFast(res, tagWrites_, tagFailureDocument(TagWriteOutcome::tooFast));
    return true;
}

// The set asked for is not the one that is ready. Say what is ready, start building what was
// asked for, and let the client poll GET /state.
void LibraryRoutes::startBuilding(httplib::Response& res, const std::vector<std::string>& columns,
                                  const Library::State& state) {
    if (!calls_.refresh) {
        respondUnavailable(res, kNoLibrary);
        return;
    }

    if (!sameColumns(declaration(), columns) || !state.build) {
        if (rebuildingTooFast(res))
            return;

        declare(columns);
        calls_.refresh(columns, RebuildReason::columnsDeclared);
    }

    respond(res, 202, libraryDocument(state));
}

std::shared_ptr<GzipOnce> LibraryRoutes::packingFor(const Library::State& state,
                                                    const std::string& partKey) {
    const std::lock_guard<std::mutex> lock(packedPartsLock_);

    if (packedPartsStructure_ != state.structure || packedPartsRevision_ != state.revision) {
        packedParts_.clear();
        packedPartsStructure_ = state.structure;
        packedPartsRevision_ = state.revision;
    }

    const auto held =
        std::find_if(packedParts_.begin(), packedParts_.end(),
                     [&partKey](const PackedPart& part) { return part.key == partKey; });
    if (held != packedParts_.end())
        return held->packing;

    packedParts_.push_back({partKey, std::make_shared<GzipOnce>()});
    while (packedParts_.size() > kHeldParts)
        packedParts_.pop_front();

    return packedParts_.back().packing;
}

void LibraryRoutes::exportSnapshot(const httplib::Request& req, httplib::Response& res) {
    const auto request = columnsDeclared(req);
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
        return;
    }

    const auto part = parseExportPart(
        request.columns, req.get_param_values("only"),
        req.has_param("spine") ? std::optional(req.get_param_value("spine")) : std::nullopt);
    if (!part.ok()) {
        respondRefusal(res, part.refusal, part.detail);
        return;
    }

    if (!library_) {
        respondUnavailable(res, kNoLibrary);
        return;
    }

    const auto state = library_->state();
    if (!state.ready || !sameColumns(state.columns, request.columns)) {
        startBuilding(res, request.columns, state);
        return;
    }

    const auto key = carryingOf(state.columns, part.part).key();
    const auto produce = [this, &part] { return library_->exported(part.part).bytes; };
    const auto name = snapshotTag(state, runId_) + (key.empty() ? std::string() : "-" + key);

    if (key.empty()) {
        sendIfChanged(req, res, name, kLibraryBytes, produce, packedExport_);
        return;
    }

    const auto packing = packingFor(state, key);
    sendIfChanged(req, res, name, kLibraryBytes, produce, *packing);
}

std::shared_ptr<LibraryRoutes::HeldSummary> LibraryRoutes::heldSummaryFor(const SummaryKey& key) {
    const std::lock_guard<std::mutex> lock(heldSummariesLock_);

    const auto held = std::find_if(heldSummaries_.begin(), heldSummaries_.end(),
                                   [&key](const auto& entry) { return entry->key == key; });
    if (held != heldSummaries_.end())
        return *held;

    heldSummaries_.push_back(std::make_shared<HeldSummary>(key));
    while (heldSummaries_.size() > kHeldParts)
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
                summariseLibrary(snapshot, *indices, nowMs, systemLocalTime()));
        });
    });
    return held.bytes;
}

std::optional<Library::State> LibraryRoutes::stateForRoles(
    httplib::Response& res, const RolesAsked& roles,
    bool (LibraryRoutes::*tooFast)(httplib::Response&)) {
    if (!library_) {
        respondUnavailable(res, kNoLibrary);
        return std::nullopt;
    }

    if ((this->*tooFast)(res))
        return std::nullopt;

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
    const auto roles = rolesAsked(req, kSummaryRoleNames, {});
    if (!roles.ok()) {
        respondRefusal(res, roles.refusal, roles.detail);
        return;
    }

    const auto state = stateForRoles(res, roles, &LibraryRoutes::summarisingTooFast);
    if (!state)
        return;

    const int64_t nowMs = summaryNow_();
    const uint32_t date = systemLocalTime().date(nowMs);
    const std::string key = rolesKey(roles.expressions);

    const auto name = snapshotTag(*state, runId_) + "-d" + std::to_string(date) + "-h" +
                      std::to_string(std::hash<std::string>{}(key));

    if (alreadyHoldsCurrent(req, name)) {
        sendIfChanged(req, res, name, "application/json", [] { return SharedBytes(); });
        return;
    }

    const auto held = heldSummaryFor({state->structure, state->revision, date, key});
    if (!summaryOf(*held, roles.expressions, nowMs)) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    sendIfChanged(
        req, res, name, "application/json", [&held] { return held->bytes; }, held->packing);
}

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

    const auto state = stateForRoles(res, roles, &LibraryRoutes::questioningTooFast);
    if (!state)
        return;
    const auto body = library_->read([&](const Snapshot& snapshot) -> std::optional<std::string> {
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
                answer = LibraryQuestions::genre(snapshot, *indices, asked.name);
                break;
            case Question::search:
                answer = questions_.search(snapshot, *indices, asked.query, asked.limit,
                                           asked.entityLimit, asked.splitsCredits);
                break;
        }
        return answer.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
    });
    if (!body) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    respond(res, 200, *body);
    res.set_header("Cache-Control", kAskEveryTime);
    res.set_header("Vary", "Accept-Encoding");
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

        if (!calls_.readOrdinal) {
            respondUnavailable(res, kNoLibrary);
            return;
        }

        if (readingTooFast(res))
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

    if (!calls_.readTrack) {
        respondUnavailable(res, kNoLibrary);
        return;
    }

    if (readingTooFast(res))
        return;

    respondTrackRead(res, calls_.readTrack(track, *subsong, declared.columns));
}

void LibraryRoutes::addTo(httplib::Server& server) {
    server.Get("/api/library/export", [this](const httplib::Request& req, httplib::Response& res) {
        exportSnapshot(req, res);
    });

    server.Get("/api/library/summary", [this](const httplib::Request& req, httplib::Response& res) {
        summarise(req, res);
    });

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

    server.Get("/api/library/changes", [this](const httplib::Request& req, httplib::Response& res) {
        const auto asked = changesAsked(req);
        if (!asked.request.ok()) {
            respondRefusal(res, asked.request.refusal, asked.request.detail);
            return;
        }

        if (!library_) {
            respondUnavailable(res, kNoLibrary);
            return;
        }

        if (readingChangesTooFast(res))
            return;

        const auto state = library_->state();
        const auto name = snapshotTag(state, runId_) + "-f" + std::to_string(asked.request.since) +
                          "-g" + std::to_string(asked.structure);

        std::optional<Library::Changes> missed;
        if (!alreadyHoldsCurrent(req, name)) {
            missed = library_->changes(asked.structure, asked.request.since);
            if (missed->outcome != DeltaOutcome::ok) {
                respondOutcome(res, missed->outcome);
                return;
            }
        }

        sendIfChanged(req, res, name, kLibraryBytes, [this, &missed]() -> SharedBytes {
            auto body = serialiseDeltaWithin(missed->delta, library_->maxBytes());
            return body ? std::make_shared<const std::string>(std::move(*body)) : nullptr;
        });
    });

    server.Post("/api/library/refresh", [this](const httplib::Request&, httplib::Response& res) {
        if (!library_ || !calls_.refresh) {
            respondUnavailable(res, kNoLibrary);
            return;
        }

        if (rebuildingTooFast(res))
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

        if (writingTagsTooFast(res))
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
