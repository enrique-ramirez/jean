#include "core/routes_library.h"

#include "core/artwork.h"
#include "core/documents.h"
#include "core/http_responses.h"
#include "core/tag_write.h"
#include "core/text.h"

#include <algorithm>
#include <chrono>
#include <limits>
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
                  clock) {}

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

void LibraryRoutes::exportSnapshot(const httplib::Request& req, httplib::Response& res) {
    const auto request = columnsDeclared(req);
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
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

    sendIfChanged(
        req, res, snapshotTag(state, runId_), kLibraryBytes,
        [this] { return library_->exported().bytes; }, packedExport_);
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

    server.Get("/api/library/changes", [this](const httplib::Request& req, httplib::Response& res) {
        const auto request =
            req.has_param("since")
                ? parseLibraryRequest({}, req.get_param_value("since"))
                : refused<LibraryRequest>(LibraryRefusal::badSince, "'since' is required");
        if (!request.ok()) {
            respondRefusal(res, request.refusal, request.detail);
            return;
        }

        if (!library_) {
            respondUnavailable(res, kNoLibrary);
            return;
        }

        const auto state = library_->state();
        const auto changes = library_->changes(request.since);
        if (changes.outcome != DeltaOutcome::ok) {
            respondOutcome(res, changes.outcome);
            return;
        }

        const auto name = snapshotTag(state, runId_) + "-f" + std::to_string(request.since);
        sendIfChanged(req, res, name, kLibraryBytes,
                      [&changes] { return serialiseDelta(changes.delta); });
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

        if (tagWrites_.refuses()) {
            respondTooFast(res, tagWrites_, tagFailureDocument(TagWriteOutcome::tooFast));
            return;
        }

        const auto outcome =
            askIfAvailable(calls_.writeTags, TagWriteOutcome::unavailable, request.write);
        if (outcome != TagWriteOutcome::written) {
            respondOutcome(res, outcome);
            return;
        }

        respond(res, 200, tagWrittenDocument(request.write));
    });
}

}  // namespace jean
