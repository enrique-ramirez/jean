#pragma once

#include "third_party/httplib.h"

#include "core/device.h"
#include "core/failures.h"
#include "core/library.h"
#include "core/rate_limit.h"
#include "core/settings.h"
#include "core/shared_bytes.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace jean {

void respond(httplib::Response& res, int status, std::string body);

void respondError(httplib::Response& res, int status, const std::string& message);

// A null callback in the Player seam: an install that switched the feature off, or a player
// without it.
void respondUnavailable(httplib::Response& res, const std::string& message);

void respondOutcome(httplib::Response& res, PlayerOutcome outcome, const std::string& detail = {});
void respondOutcome(httplib::Response& res, ReadOutcome outcome);
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

void respondUnknownSession(httplib::Response& res);

bool readDeviceIdentity(const httplib::Request& req, httplib::Response& res,
                        DeviceIdentity& device);

// changeOutput permits the device alone: controlPlayback never gates a switch, and GET
// /api/outputs is never gated at all, because reading the list changes nothing.
bool outputChangeRefused(const Settings& settings, httplib::Response& res);

// An id of a shape this component never reports is refused before the player is asked.
bool playlistIdRefused(const std::string& id, httplib::Response& res);

std::optional<Library::State> readyLibrary(const Library* library, httplib::Response& res);

void respondTooFast(httplib::Response& res, const Throttle& throttle, std::string body);

bool perClientTooFast(PerClientRateLimiter& limiter, const std::string& client,
                      std::chrono::steady_clock::time_point now, const char* message,
                      httplib::Response& res);

// `changes` is the budget playlist and queue edits share, refused as a PlaylistRefusal whose
// `detail` names that budget where a route says which one ran out.
bool changingTooFast(Throttle& changes, httplib::Response& res, const std::string& detail = {});

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

bool alreadyHoldsCurrent(const httplib::Request& req, const std::string& name);

// Names the snapshot and this run of the component, so a validator from before a restart never
// matches.
std::string snapshotTag(const Library::State& state, uint64_t runId, uint64_t playerVersion = 0);

// Hands cpp-httplib a view of bytes this component keeps rather than a copy of them. cpp-httplib
// compresses only a body it holds, never one a content provider writes, so a type it would compress
// is answered uncompressed this way.
void sendHeld(httplib::Response& res, const SharedBytes& bytes, const std::string& contentType);

// Sends bytes that outlive every response, such as the page build compiled into the component,
// without copying them: compressed from `bytes` where cpp-httplib would have compressed the same
// body, and written straight from them where it would not.
void sendLongLived(const httplib::Request& req, httplib::Response& res, std::string_view bytes,
                   const std::string& contentType);

class GzipOnce {
public:
    // Null where compression failed.
    SharedBytes of(const SharedBytes& plain);

private:
    std::mutex lock_;

    std::weak_ptr<const std::string> plain_;
    SharedBytes packed_;
};

void sendUnvalidated(const httplib::Request& req, httplib::Response& res, const SharedBytes& bytes,
                     const char* contentType);

// The body is produced only once the client is known not to hold it already, because
// serialising a library is the expensive half of any of these requests.
void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<std::string()>& produce);

void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<SharedBytes()>& produce);

void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<SharedBytes()>& produce,
                   GzipOnce& packing);

}  // namespace jean
