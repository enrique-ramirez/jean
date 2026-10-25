#include "core/http_responses.h"

#include "core/http_server.h"
#include "core/text.h"

#include <algorithm>
#include <iterator>

namespace jean {

namespace {

constexpr char kRetryPerClientAfterSeconds[] = "1";

}  // namespace

bool perClientTooFast(PerClientRateLimiter& limiter, const std::string& client,
                      std::chrono::steady_clock::time_point now, const char* message,
                      httplib::Response& res) {
    if (limiter.allow(client, now))
        return false;

    res.set_header("Retry-After", kRetryPerClientAfterSeconds);
    respondError(res, 429, message);
    return true;
}

namespace {

constexpr char kGzipSuffix[] = "-gzip";
constexpr char kIdentitySuffix[] = "-identity";

std::string quoted(const std::string& tag) {
    return "\"" + tag + "\"";
}

void revalidateAlways(httplib::Response& res, const std::string& tag) {
    res.set_header("Cache-Control", kAskEveryTime);
    res.set_header("ETag", tag);
}

void revalidatePerEncoding(httplib::Response& res, const std::string& tag) {
    revalidateAlways(res, tag);
    res.set_header("Vary", "Accept-Encoding");
}

bool isRefusal(const std::string& weight) {
    return !weight.empty() && weight.front() == '0' &&
           weight.find_first_of("123456789") == std::string::npos;
}

// cpp-httplib runs this negotiation itself for the content types it is willing to compress. A
// route compressing its own body runs it here instead, and answers identity when nothing offered.
bool acceptsGzip(const httplib::Request& req) {
    for (const auto& offer : splitOn(req.get_header_value("Accept-Encoding"), ',')) {
        const auto parts = splitOn(offer, ';');
        if (parts.empty() || !equalsIgnoringCase(parts.front(), "gzip"))
            continue;

        return std::none_of(std::next(parts.begin()), parts.end(),
                            [](const std::string& parameter) {
                                const auto named = splitOn(parameter, '=');
                                return named.size() == 2 && equalsIgnoringCase(named[0], "q") &&
                                       isRefusal(named[1]);
                            });
    }

    return false;
}

std::optional<std::string> compressedWith(httplib::detail::compressor& compressor,
                                          std::string_view body) {
    std::string packed;
    const bool done = compressor.compress(body.data(), body.size(), true,
                                          [&packed](const char* data, size_t length) {
                                              packed.append(data, length);
                                              return true;
                                          });

    if (!done)
        return std::nullopt;

    return packed;
}

// The same zlib compressor cpp-httplib would have used, driven by hand because
// can_compress_content_type admits neither of the two types these routes answer with. Setting
// Content-Encoding is also what stops cpp-httplib compressing the result a second time.
std::optional<std::string> gzipped(const std::string& body) {
    httplib::detail::gzip_compressor compressor;
    return compressedWith(compressor, body);
}

}  // namespace

void respond(httplib::Response& res, int status, std::string body) {
    res.status = status;
    res.set_content(std::move(body), "application/json");
}

void respondError(httplib::Response& res, int status, const std::string& message) {
    respond(res, status, errorDocument(message));
}

void respondUnavailable(httplib::Response& res, const std::string& message) {
    respondError(res, 503, message);
}

void respondOutcome(httplib::Response& res, PlayerOutcome outcome, const std::string& detail) {
    respond(res, httpStatusFor(outcome), failureDocument(outcome, detail));
}

void respondOutcome(httplib::Response& res, ReadOutcome outcome) {
    respond(res, httpStatusFor(outcome), failureDocument(outcome));
}

void respondOutcome(httplib::Response& res, TagWriteOutcome outcome) {
    respond(res, httpStatusFor(outcome), tagFailureDocument(outcome));
}

void respondRefusal(httplib::Response& res, PlaylistRefusal refusal, const std::string& detail) {
    respond(res, httpStatusFor(refusal), refusalDocument(refusal, detail));
}

void respondRefusal(httplib::Response& res, PlaybackRefusal refusal, const std::string& detail) {
    respond(res, httpStatusFor(refusal), refusalDocument(refusal, detail));
}

void respondRefusal(httplib::Response& res, LibraryRefusal refusal, const std::string& detail) {
    respond(res, httpStatusFor(refusal), refusalDocument(refusal, detail));
}

void respondRefusal(httplib::Response& res, TagWriteRefusal refusal, const std::string& detail) {
    respond(res, httpStatusFor(refusal), tagRefusalDocument(refusal, detail));
}

void respondCommand(httplib::Response& res, PlayerOutcome outcome, const std::string& detail) {
    if (outcome != PlayerOutcome::done) {
        respondOutcome(res, outcome, detail);
        return;
    }

    res.status = 204;
}

namespace {

bool refusedBySwitch(bool switchedOn, PlayerOutcome refusal, httplib::Response& res) {
    if (switchedOn)
        return false;

    respondOutcome(res, refusal);
    return true;
}

}  // namespace

bool playlistWritesRefused(const Settings& settings, httplib::Response& res) {
    return refusedBySwitch(settings.writePlaylists, PlayerOutcome::writesDisabled, res);
}

bool playbackRefused(const Settings& settings, httplib::Response& res) {
    return refusedBySwitch(settings.controlPlayback, PlayerOutcome::playbackDisabled, res);
}

void respondUnknownSession(httplib::Response& res) {
    respondError(res, 404, kUnknownSession);
}

bool readDeviceIdentity(const httplib::Request& req, httplib::Response& res,
                        DeviceIdentity& device) {
    const auto asked = parseDeviceIdentity(req.body);
    if (!asked.ok()) {
        respondError(res, 400, asked.refusal);
        return false;
    }

    device = asked.device;
    return true;
}

bool outputChangeRefused(const Settings& settings, httplib::Response& res) {
    return refusedBySwitch(settings.changeOutput, PlayerOutcome::changeDisabled, res);
}

bool playlistIdRefused(const std::string& id, httplib::Response& res) {
    if (isPlaylistId(id))
        return false;

    respondRefusal(res, PlaylistRefusal::badId);
    return true;
}

void sendHeld(httplib::Response& res, const SharedBytes& bytes, const std::string& contentType) {
    res.set_content_provider(bytes->size(), contentType,
                             [bytes](size_t offset, size_t length, httplib::DataSink& sink) {
                                 return sink.write(bytes->data() + offset, length);
                             });
}

void sendLongLived(const httplib::Request& req, httplib::Response& res, std::string_view bytes,
                   const std::string& contentType) {
    const auto coding = httplib::detail::encoding_type(req, res, contentType);
    const auto compressor = httplib::detail::make_compressor(coding);
    auto packed = compressor ? compressedWith(*compressor, bytes) : std::nullopt;

    if (packed) {
        res.set_header("Content-Encoding", httplib::detail::encoding_name(coding));
        res.set_header("Vary", "Accept-Encoding");
        res.set_content(std::move(*packed), contentType);
        return;
    }

    res.set_content_provider(bytes.size(), contentType,
                             [bytes](size_t offset, size_t length, httplib::DataSink& sink) {
                                 return sink.write(bytes.data() + offset, length);
                             });
}

std::optional<Library::State> readyLibrary(const Library* library, httplib::Response& res) {
    if (!library) {
        respondUnavailable(res, kNoLibrary);
        return std::nullopt;
    }

    auto state = library->state();
    if (!state.ready) {
        respondOutcome(res, ReadOutcome::notBuilt);
        return std::nullopt;
    }

    return state;
}

void respondTooFast(httplib::Response& res, const Throttle& throttle, std::string body) {
    res.set_header("Retry-After", std::to_string(throttle.retryAfterSeconds()));
    respond(res, 429, std::move(body));
}

bool changingTooFast(Throttle& changes, httplib::Response& res, const std::string& detail) {
    if (!changes.refuses())
        return false;

    respondTooFast(res, changes, refusalDocument(PlaylistRefusal::tooFast, detail));
    return true;
}

std::vector<std::string> columnsAsked(const httplib::Request& req) {
    return req.get_param_values("columns");
}

LibraryRequest columnsDeclared(const httplib::Request& req) {
    const auto asked = columnsAsked(req);
    return asked.empty() ? refused<LibraryRequest>(LibraryRefusal::badColumn, kColumnsRequired)
                         : parseLibraryRequest(asked, std::string());
}

bool alreadyHolds(const httplib::Request& req, const std::string& tag) {
    const auto candidates = splitOn(req.get_header_value("If-None-Match"), ',');

    return std::any_of(candidates.begin(), candidates.end(), [&tag](const std::string& candidate) {
        return candidate == "*" || candidate == tag;
    });
}

std::string snapshotTag(const Library::State& state, uint64_t runId, uint64_t playerVersion) {
    return "s" + std::to_string(state.structure) + "-r" + std::to_string(state.revision) + "-i" +
           std::to_string(runId) + "-p" + std::to_string(playerVersion);
}

namespace {

std::string currentTag(const httplib::Request& req, const std::string& name) {
    return quoted(name + (acceptsGzip(req) ? kGzipSuffix : kIdentitySuffix));
}

void sendBodyIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                       const char* contentType, const std::function<SharedBytes()>& produce,
                       const std::function<SharedBytes(const SharedBytes&)>& pack) {
    const bool offered = acceptsGzip(req);
    const auto tag = currentTag(req, name);

    if (alreadyHolds(req, tag)) {
        revalidatePerEncoding(res, tag);
        res.status = 304;
        return;
    }

    const auto body = produce();
    const auto packed = offered ? pack(body) : nullptr;

    revalidatePerEncoding(res, packed ? tag : quoted(name + kIdentitySuffix));
    res.status = 200;

    if (!packed) {
        sendHeld(res, body, contentType);
        return;
    }

    res.set_header("Content-Encoding", "gzip");
    sendHeld(res, packed, contentType);
}

}  // namespace

bool alreadyHoldsCurrent(const httplib::Request& req, const std::string& name) {
    return alreadyHolds(req, currentTag(req, name));
}

namespace {

SharedBytes packedNow(const SharedBytes& plain) {
    auto packed = gzipped(*plain);
    return packed ? std::make_shared<const std::string>(std::move(*packed)) : nullptr;
}

}  // namespace

void sendUnvalidated(const httplib::Request& req, httplib::Response& res, const SharedBytes& bytes,
                     const char* contentType) {
    const auto packed = acceptsGzip(req) ? packedNow(bytes) : nullptr;

    res.status = 200;
    res.set_header("Cache-Control", kAskEveryTime);
    res.set_header("Vary", "Accept-Encoding");
    if (!packed) {
        sendHeld(res, bytes, contentType);
        return;
    }

    res.set_header("Content-Encoding", "gzip");
    sendHeld(res, packed, contentType);
}

SharedBytes GzipOnce::of(const SharedBytes& plain) {
    const std::lock_guard<std::mutex> lock(lock_);
    if (plain_.lock() != plain) {
        packed_ = packedNow(plain);
        plain_ = plain;
    }
    return packed_;
}

void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<std::string()>& produce) {
    sendBodyIfChanged(
        req, res, name, contentType,
        [&produce] { return std::make_shared<const std::string>(produce()); }, packedNow);
}

void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<SharedBytes()>& produce) {
    sendBodyIfChanged(req, res, name, contentType, produce, packedNow);
}

void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<SharedBytes()>& produce,
                   GzipOnce& packing) {
    sendBodyIfChanged(req, res, name, contentType, produce,
                      [&packing](const SharedBytes& plain) { return packing.of(plain); });
}

}  // namespace jean
