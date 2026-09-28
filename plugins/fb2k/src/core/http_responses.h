#pragma once

#include "third_party/httplib.h"

#include "core/failures.h"
#include "core/library.h"
#include "core/rate_limit.h"
#include "core/settings.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace jean {

void respond(httplib::Response& res, int status, std::string body);

void respondError(httplib::Response& res, int status, const std::string& message);

// A null callback in the Player seam: an install that switched the feature off, or a player
// without it.
void respondUnavailable(httplib::Response& res, const std::string& message);

void respondOutcome(httplib::Response& res, PlayerOutcome outcome, const std::string& detail = {});
void respondOutcome(httplib::Response& res, DeltaOutcome outcome);
void respondOutcome(httplib::Response& res, TagWriteOutcome outcome);

void respondRefusal(httplib::Response& res, PlaylistRefusal refusal,
                    const std::string& detail = {});
void respondRefusal(httplib::Response& res, PlaybackRefusal refusal, const std::string& detail);
void respondRefusal(httplib::Response& res, LibraryRefusal refusal, const std::string& detail);
void respondRefusal(httplib::Response& res, TagWriteRefusal refusal, const std::string& detail);

void respondCommand(httplib::Response& res, PlayerOutcome outcome, const std::string& detail = {});

template <typename Request>
void respondRequestRefused(httplib::Response& res, const Request& request) {
    if (request.outcome != PlayerOutcome::done)
        respondOutcome(res, request.outcome);
    else
        respondRefusal(res, request.refusal);
}

// The read-only-playlists setting, checked ahead of everything else a write route does: a
// client learns nothing about a request the setting was always going to refuse. Never called
// from a route addressing the component's own scratch playlist, which stays writable in both
// states.
bool playlistWritesRefused(const Settings& settings, httplib::Response& res);

bool playbackRefused(const Settings& settings, httplib::Response& res);

// changeOutput permits the device alone: controlPlayback never gates a switch, and GET
// /api/outputs is never gated at all, because reading the list changes nothing.
bool outputChangeRefused(const Settings& settings, httplib::Response& res);

std::optional<Library::State> readyLibrary(const Library* library, httplib::Response& res);

void respondTooFast(httplib::Response& res, const Throttle& throttle, std::string body);

// `changes` is the budget playlist and queue edits share, refused as a PlaylistRefusal.
bool changingTooFast(Throttle& changes, httplib::Response& res);

template <typename Callback, typename Unavailable, typename... Args>
Unavailable askIfAvailable(const Callback& ask, Unavailable whenUnavailable, Args&&... args) {
    return ask ? ask(std::forward<Args>(args)...) : std::move(whenUnavailable);
}

// cpp-httplib drops a query pair whose raw text exactly repeats an earlier one, so a column sent
// twice arrives once. Two spellings of one column still arrive twice, and that is what the
// duplicate refusal is for.
std::vector<std::string> columnsAsked(const httplib::Request& req);

// `columns`, which a request MUST declare at least one of.
LibraryRequest columnsDeclared(const httplib::Request& req);

// See ARCHITECTURE.md, *Artwork*.
constexpr char kAskEveryTime[] = "private, no-cache";

// cpp-httplib evaluates If-None-Match for its own file handler alone, so a route serving anything
// else answers the conditional request itself.
bool alreadyHolds(const httplib::Request& req, const std::string& tag);

void revalidateAlways(httplib::Response& res, const std::string& tag);

// Names the snapshot and this run of the component, so a validator from before a restart never
// matches.
std::string snapshotTag(const Library::State& state, uint64_t runId, uint64_t playerVersion = 0);

using SharedBytes = std::shared_ptr<const std::string>;

class GzipOnce {
public:
    // Null where compression failed.
    SharedBytes of(const SharedBytes& plain);

private:
    std::mutex lock_;
    SharedBytes plain_;
    SharedBytes packed_;
};

// The body is produced only once the client is known not to hold it already, because
// serialising a library is the expensive half of any of these requests.
void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<std::string()>& produce);

void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<SharedBytes()>& produce,
                   GzipOnce& packing);

}  // namespace jean
