#pragma once

#include "third_party/httplib.h"

#include "core/http_responses.h"
#include "core/http_server.h"
#include "core/library.h"
#include "core/library_questions.h"
#include "core/library_roles.h"
#include "core/library_runs.h"
#include "core/library_summary.h"
#include "core/player.h"
#include "core/playlist_runs.h"
#include "core/rate_limit.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace jean {

inline constexpr int kRowsBurst = 30;
inline constexpr auto kRowsRefill = std::chrono::milliseconds(100);

inline constexpr size_t kHeldSummaries = 2;

class LibraryRoutes {
public:
    // A null `library` is how an install with the feature off says so, and every route here
    // but POST /api/tags then answers 503.
    LibraryRoutes(const LibraryCalls& calls, const Library* library, const LiveSettings& settings,
                  uint64_t runId, const RateLimitClock& clock);

    LibraryQuestions& questions() { return questions_; }

    void summaryClock(std::function<int64_t()> nowMs);

    uint64_t summaryComputations() const { return summaryComputations_; }

    void addTo(httplib::Server& server);

    enum class Question { album, artist, genre, search, credits, values };

    using PlaylistColumns = std::vector<std::string> (*)(const Snapshot&, const LibraryRoles&);

    void readPlaylistRuns(const httplib::Request& req, httplib::Response& res,
                          const PlaylistTrackReader& readTracks);
    void findInPlaylist(const httplib::Request& req, httplib::Response& res,
                        const PlaylistTrackReader& readTracks);

private:
    void startBuilding(httplib::Response& res, const std::vector<std::string>& columns,
                       const Library::State& state);
    bool rebuildingTooFast(httplib::Response& res);

    struct SummaryKey {
        uint64_t structure = 0;
        uint64_t revision = 0;
        uint32_t date = 0;
        std::string roles;
        bool genres = false;

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

    std::optional<Library::State> stateForRoles(httplib::Response& res, const RolesAsked& roles,
                                                bool (LibraryRoutes::*tooFast)(httplib::Response&));

    void readRuns(const httplib::Request& req, httplib::Response& res);
    bool readingRunsTooFast(httplib::Response& res);

    struct PlaylistCopy;

    std::optional<PlaylistCopy> copyPlaylist(httplib::Response& res, const std::string& playlistId,
                                             uint64_t structure, const RolesAsked& roles,
                                             bool (LibraryRoutes::*tooFast)(httplib::Response&),
                                             const PlaylistTrackReader& readTracks,
                                             PlaylistColumns columnsOf);

    bool readingPlaylistRunsTooFast(httplib::Response& res);
    bool searchingPlaylistsTooFast(httplib::Response& res);

    void answerQuestion(Question kind, const httplib::Request& req, httplib::Response& res);
    bool questioningTooFast(httplib::Response& res);

    void readRows(const httplib::Request& req, httplib::Response& res);
    bool readingRowsTooFast(httplib::Response& res, const std::string& client);

    void readTrack(const httplib::Request& req, httplib::Response& res);
    bool readingTooFast(httplib::Response& res);

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
    Throttle summaryReads_;
    Throttle questionReads_;
    Throttle runReads_;
    Throttle playlistRunReads_;
    Throttle playlistSearches_;
    PerClientRateLimiter rowReads_;
    const RateLimitClock clock_;

    std::function<int64_t()> summaryNow_;
    std::atomic<uint64_t> summaryComputations_{0};

    LibraryQuestions questions_;
    HeldLibraryRuns runs_;
    HeldPlaylistRuns playlistRuns_;

    std::mutex heldSummariesLock_;
    std::deque<std::shared_ptr<HeldSummary>> heldSummaries_;

    // A rows read names the columns it wants and this is what it named, so a later rebuild,
    // whether from the player noticing a change or from POST /library/refresh, reproduces the
    // same set rather than whatever the component last happened to build.
    mutable std::mutex declarationLock_;
    std::vector<std::string> declared_;
};

}  // namespace jean
