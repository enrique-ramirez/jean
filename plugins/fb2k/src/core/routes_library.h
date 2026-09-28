#pragma once

#include "third_party/httplib.h"

#include "core/http_responses.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/player.h"
#include "core/rate_limit.h"

#include <cstdint>
#include <mutex>
#include <string>
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

    void addTo(httplib::Server& server);

private:
    void exportSnapshot(const httplib::Request& req, httplib::Response& res);
    void startBuilding(httplib::Response& res, const std::vector<std::string>& columns,
                       const Library::State& state);
    bool rebuildingTooFast(httplib::Response& res);

    void readTrack(const httplib::Request& req, httplib::Response& res);
    bool readingTooFast(httplib::Response& res);

    void declare(std::vector<std::string> columns);
    std::vector<std::string> declaration() const;

    const LibraryCalls& calls_;
    const Library* const library_;
    const LiveSettings& settings_;
    const uint64_t runId_;

    Throttle rebuilds_;
    Throttle tagWrites_;
    Throttle trackReads_;

    GzipOnce packedExport_;

    // An export names the columns it wants and this is what it named, so a later rebuild,
    // whether from the player noticing a change or from POST /library/refresh, reproduces the
    // same set rather than whatever the component last happened to build.
    mutable std::mutex declarationLock_;
    std::vector<std::string> declared_;
};

}  // namespace jean
