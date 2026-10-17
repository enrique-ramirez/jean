#include "core/routes_library.h"

#include "core/artwork.h"
#include "core/documents.h"
#include "core/http_responses.h"
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

using RoleField = std::optional<size_t> SummaryRoles::*;

struct RoleName {
    const char* name;
    RoleField field;
};

constexpr std::array kRoleNames{
    RoleName{"trackNumber", &SummaryRoles::trackNumber},
    RoleName{"discNumber", &SummaryRoles::discNumber},
    RoleName{"title", &SummaryRoles::title},
    RoleName{"artist", &SummaryRoles::artist},
    RoleName{"album", &SummaryRoles::album},
    RoleName{"albumArtist", &SummaryRoles::albumArtist},
    RoleName{"duration", &SummaryRoles::duration},
    RoleName{"playCount", &SummaryRoles::playCount},
    RoleName{"lastPlayed", &SummaryRoles::lastPlayed},
    RoleName{"rating", &SummaryRoles::rating},
    RoleName{"year", &SummaryRoles::year},
    RoleName{"genre", &SummaryRoles::genre},
    RoleName{"codec", &SummaryRoles::codec},
    RoleName{"bitrate", &SummaryRoles::bitrate},
    RoleName{"playCountLocal", &SummaryRoles::playCountLocal},
    RoleName{"lastPlayedLocal", &SummaryRoles::lastPlayedLocal},
    RoleName{"added", &SummaryRoles::added},
};

const RoleName* roleNamed(const std::string& name) {
    for (const RoleName& role : kRoleNames) {
        if (name == role.name)
            return &role;
    }
    return nullptr;
}

// Role name to the expression the client says it reads, ordered by name so that the order the
// client wrote them in does not make two requests different.
struct RolesAsked {
    LibraryRefusal refusal = LibraryRefusal::none;
    std::string detail;
    std::map<std::string, std::string> expressions;

    bool ok() const { return refusal == LibraryRefusal::none; }
};

RolesAsked rolesAsked(const httplib::Request& req) {
    RolesAsked asked;
    const auto refuse = [&asked](LibraryRefusal refusal, std::string detail) {
        asked.refusal = refusal;
        asked.detail = std::move(detail);
        return asked;
    };

    for (const auto& [name, expression] : req.params) {
        if (roleNamed(name) == nullptr)
            return refuse(LibraryRefusal::badRole, "'" + name + "' is not a role");

        if (expression.empty() || expression.size() > kMaxColumnLength ||
            !isPrintable(expression)) {
            return refuse(LibraryRefusal::badRole,
                          "role '" + name + "' must be printable text of 1 to " +
                              std::to_string(kMaxColumnLength) + " characters");
        }

        if (!asked.expressions.emplace(name, expression).second)
            return refuse(LibraryRefusal::duplicateRole, "role '" + name + "' is named twice");
    }

    return asked;
}

std::string rolesKey(const std::map<std::string, std::string>& roles) {
    std::string key;
    for (const auto& [name, expression] : roles) {
        key += name;
        key += '\0';
        key += expression;
        key += '\0';
    }
    return key;
}

std::optional<SummaryRoles> rolesIn(const Snapshot& snapshot,
                                    const std::map<std::string, std::string>& roles) {
    SummaryRoles found;
    for (const auto& [name, expression] : roles) {
        const auto column =
            std::find_if(snapshot.columns.begin() + kSpineFieldCount, snapshot.columns.end(),
                         [&expression](const Column& held) { return held.name == expression; });
        if (column == snapshot.columns.end())
            return std::nullopt;

        found.*roleNamed(name)->field = static_cast<size_t>(column - snapshot.columns.begin());
    }
    return found;
}

struct SummaryVerdict {
    enum Kind { answerable, notYet, undeclared } kind = answerable;
    std::string expression;
};

SummaryVerdict summaryVerdict(const Library::State& state, const std::vector<std::string>& declared,
                              const std::map<std::string, std::string>& expressions) {
    if (!state.ready)
        return {SummaryVerdict::notYet, {}};

    const auto& wanted = declared.empty() ? state.columns : declared;
    const auto holds = [](const std::vector<std::string>& columns, const std::string& expression) {
        return std::find(columns.begin(), columns.end(), expression) != columns.end();
    };

    const bool stale = std::any_of(expressions.begin(), expressions.end(), [&](const auto& role) {
        return !holds(state.columns, role.second) && holds(wanted, role.second);
    });
    if (stale)
        return {SummaryVerdict::notYet, {}};

    const auto missing =
        std::find_if(expressions.begin(), expressions.end(),
                     [&](const auto& role) { return !holds(state.columns, role.second); });
    if (missing != expressions.end())
        return {SummaryVerdict::undeclared, missing->second};

    return {};
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

void LibraryRoutes::summarise(const httplib::Request& req, httplib::Response& res) {
    const auto roles = rolesAsked(req);
    if (!roles.ok()) {
        respondRefusal(res, roles.refusal, roles.detail);
        return;
    }

    if (!library_) {
        respondUnavailable(res, kNoLibrary);
        return;
    }

    if (summarisingTooFast(res))
        return;

    const auto state = library_->state();
    const auto verdict = summaryVerdict(state, declaration(), roles.expressions);
    if (verdict.kind == SummaryVerdict::notYet) {
        respond(res, 202, libraryDocument(state));
        return;
    }

    if (verdict.kind == SummaryVerdict::undeclared) {
        respondError(res, 409, undeclaredColumnMessage(verdict.expression));
        return;
    }

    const int64_t nowMs = summaryNow_();
    const uint32_t date = systemLocalTime().date(nowMs);
    const std::string key = rolesKey(roles.expressions);

    const auto name = snapshotTag(state, runId_) + "-d" + std::to_string(date) + "-h" +
                      std::to_string(std::hash<std::string>{}(key));

    if (alreadyHoldsCurrent(req, name)) {
        sendIfChanged(req, res, name, "application/json", [] { return SharedBytes(); });
        return;
    }

    const auto held = heldSummaryFor({state.structure, state.revision, date, key});
    if (!summaryOf(*held, roles.expressions, nowMs)) {
        respond(res, 202, libraryDocument(library_->state()));
        return;
    }

    sendIfChanged(
        req, res, name, "application/json", [&held] { return held->bytes; }, held->packing);
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
