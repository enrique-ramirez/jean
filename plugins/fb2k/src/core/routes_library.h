#pragma once

#include "third_party/httplib.h"

#include "core/http_responses.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/library_summary.h"
#include "core/player.h"
#include "core/rate_limit.h"

#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

// The media library: the snapshot and its deltas, a rebuild, one track read back, and a tag
// written to one.
namespace jean {

class LibraryRoutes {
public:
    // A null `library` is how an install with the feature off says so, and every route here
    // but POST /api/tags then answers 503.
    LibraryRoutes(const LibraryCalls& calls, const Library* library, const LiveSettings& settings,
                  uint64_t runId, const RateLimitClock& clock);

    void summaryClock(std::function<int64_t()> nowMs);

    uint64_t summaryComputations() const { return summaryComputations_; }

    void addTo(httplib::Server& server);

private:
    void exportSnapshot(const httplib::Request& req, httplib::Response& res);
    void startBuilding(httplib::Response& res, const std::vector<std::string>& columns,
                       const Library::State& state);
    bool rebuildingTooFast(httplib::Response& res);

    std::shared_ptr<GzipOnce> packingFor(const Library::State& state, const std::string& partKey);

    struct SummaryKey {
        uint64_t structure = 0;
        uint64_t revision = 0;
        uint32_t date = 0;
        std::string roles;

        bool operator==(const SummaryKey&) const = default;
    };

    struct HeldSummary {
        explicit HeldSummary(SummaryKey asked) : key(std::move(asked)) {}

        const SummaryKey key;
        std::once_flag computed;
        SharedBytes bytes;
        GzipOnce packing;
    };

    void summarise(const httplib::Request& req, httplib::Response& res);
    bool summarisingTooFast(httplib::Response& res);
    std::shared_ptr<HeldSummary> heldSummaryFor(const SummaryKey& key);
    SharedBytes summaryOf(HeldSummary& held, const std::map<std::string, std::string>& roles,
                          int64_t nowMs);

    void readTrack(const httplib::Request& req, httplib::Response& res);
    bool readingTooFast(httplib::Response& res);
    bool readingChangesTooFast(httplib::Response& res);

    bool writingTagsTooFast(httplib::Response& res);

    void declare(std::vector<std::string> columns);
    std::vector<std::string> declaration() const;

    const LibraryCalls& calls_;
    const Library* const library_;
    const LiveSettings& settings_;
    const uint64_t runId_;

    Throttle rebuilds_;
    Throttle tagWrites_;
    Throttle trackReads_;
    Throttle deltaReads_;
    Throttle summaryReads_;

    std::function<int64_t()> summaryNow_;
    std::atomic<uint64_t> summaryComputations_{0};

    std::mutex heldSummariesLock_;
    std::deque<std::shared_ptr<HeldSummary>> heldSummaries_;

    GzipOnce packedExport_;

    struct PackedPart {
        std::string key;
        std::shared_ptr<GzipOnce> packing;
    };
    std::mutex packedPartsLock_;
    uint64_t packedPartsStructure_ = 0;
    uint64_t packedPartsRevision_ = 0;
    std::deque<PackedPart> packedParts_;

    // An export names the columns it wants and this is what it named, so a later rebuild,
    // whether from the player noticing a change or from POST /library/refresh, reproduces the
    // same set rather than whatever the component last happened to build.
    mutable std::mutex declarationLock_;
    std::vector<std::string> declared_;
};

}  // namespace jean
