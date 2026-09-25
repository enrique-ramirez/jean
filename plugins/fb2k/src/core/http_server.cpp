#include "third_party/httplib.h"

#include "core/admission.h"
#include "core/assets.h"
#include "core/device.h"
#include "core/http_server.h"
#include "core/json.h"
#include "core/log.h"
#include "core/playback_modes.h"
#include "core/rate_limit.h"
#include "core/stream_ticket.h"
#include "core/text.h"

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <functional>
#include <iterator>
#include <limits>
#include <mutex>
#include <optional>
#include <set>
#include <system_error>
#include <thread>

namespace jean {

namespace {

void respond(httplib::Response& res, int status, std::string body) {
    res.status = status;
    res.set_content(std::move(body), "application/json");
}

constexpr int kPlaylistBurst = 30;
constexpr auto kPlaylistRefill = std::chrono::seconds(1);

constexpr size_t kMaxOutstandingTickets = 16;

// A refresh walks every track in the player's library, so this is a rate a person at a
// button can keep up with and a looping client cannot.
constexpr int kRefreshBurst = 3;
constexpr auto kRefreshRefill = std::chrono::seconds(30);

// A screenful of covers arrives at once and that is the feature, so the burst is deep and
// what it bounds is a client stuck in a loop turning into a queue of disk reads.
constexpr int kArtworkBurst = 300;
constexpr auto kArtworkRefill = std::chrono::milliseconds(50);

constexpr int kPollBurst = 30;
constexpr auto kPollRefill = std::chrono::milliseconds(100);

constexpr char kApiPrefix[] = "/api/";
constexpr char kArtworkPath[] = "/api/artwork";
constexpr char kPlayingArtworkPath[] = "/api/artwork/playing";
constexpr char kStatePath[] = "/api/state";
constexpr char kLibraryExportPath[] = "/api/library/export";
constexpr char kLibraryChangesPath[] = "/api/library/changes";
constexpr char kLibraryRefreshPath[] = "/api/library/refresh";
constexpr char kLibraryTrackPath[] = "/api/track/library";
constexpr char kPlayingTrackPath[] = "/api/track/playing";
constexpr char kQueuePath[] = "/api/queue";

constexpr char kPlaybackPlayPausePath[] = "/api/playback/play-pause";
constexpr char kPlaybackNextPath[] = "/api/playback/next";
constexpr char kPlaybackPreviousPath[] = "/api/playback/previous";
constexpr char kPlaybackStopPath[] = "/api/playback/stop";
constexpr char kPlaybackSeekPath[] = "/api/playback/seek";
constexpr char kPlaybackModePath[] = "/api/playback/mode";
constexpr char kVolumePath[] = "/api/volume";

constexpr char kNoPlayback[] = "playback commands are not available";

constexpr char kModeNotOffered[] = "this install does not offer that playback mode";

constexpr char kNoVolume[] = "volume is not available";

constexpr char kNoStreaming[] = "streaming is not available";

constexpr char kStreamingDisabled[] =
    "this install has streaming turned off; turn on streamingEnabled in config.json to allow it";

constexpr char kNoQueue[] = "the queue is not available";

constexpr char kNoPlaylistRows[] = "the playlist's rows are not available";

constexpr char kNoPlaylistWrites[] = "playlist changes are not available";

constexpr char kNoLibrary[] = "the media library is not available";

constexpr char kNoSuchLibraryTrack[] = "no such track";

constexpr char kNothingPlaying[] = "nothing is playing";

constexpr char kBadSubsong[] = "'subsong' must be a whole number";

constexpr char kTwoTrackAddressForms[] = "a request names one of 'track' and 'ordinal', never both";

constexpr char kNoTrackAddressForm[] = "'track' or 'ordinal' is required";

constexpr char kNoOwnPlaylists[] = "the component's own playlists are not available";

constexpr char kLibraryTooLarge[] = "the library snapshot is larger than this component sends";

constexpr char kRefreshingTooFast[] = "too many library refreshes";

constexpr char kPollingTooFast[] = "too many state polls";

constexpr char kNoArtwork[] = "artwork is not available";

constexpr char kNoArtworkForTrack[] = "no artwork for that track";

constexpr char kUnpublishableArtwork[] = "that artwork is not in a format this component sends";

constexpr char kArtworkTooLarge[] = "that artwork is larger than this component sends";

constexpr char kFetchingArtworkTooFast[] = "too many artwork requests";

// The snapshot and the deltas. Opaque bytes with a magic number of their own, so nothing on
// the way to the client sniffs, transcodes or reformats them; contract/openapi.yaml is the
// only description of what is inside.
constexpr char kLibraryBytes[] = "application/octet-stream";

constexpr char kGzipSuffix[] = "-gzip";
constexpr char kIdentitySuffix[] = "-identity";

constexpr char kSendJson[] = "send application/json";

bool isJsonRequest(const httplib::Request& req) {
    return toLower(req.get_header_value("Content-Type")).rfind("application/json", 0) == 0;
}

void denyCachingAndRanges(httplib::Response& res) {
    res.set_header("Cache-Control", "no-store");
    res.set_header("Accept-Ranges", "none");
}

std::string quoted(const std::string& tag) {
    return "\"" + tag + "\"";
}

std::string generationsOf(const Library::State& state, uint64_t playerVersion = 0,
                          std::optional<uint64_t> configGeneration = std::nullopt) {
    std::string tag = "s" + std::to_string(state.structure) + "-r" +
                      std::to_string(state.revision) + "-p" + std::to_string(playerVersion);
    if (configGeneration)
        tag += "-c" + std::to_string(*configGeneration);
    return tag;
}

// cpp-httplib evaluates If-None-Match for its own file handler alone, so a route serving
// anything else answers the conditional request itself.
bool alreadyHolds(const httplib::Request& req, const std::string& tag) {
    const auto candidates = splitOn(req.get_header_value("If-None-Match"), ',');

    return std::any_of(candidates.begin(), candidates.end(), [&tag](const std::string& candidate) {
        return candidate == "*" || candidate == tag;
    });
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

// The same zlib compressor cpp-httplib would have used, driven by hand because
// can_compress_content_type admits neither of the two types these routes answer with. Setting
// Content-Encoding is also what stops cpp-httplib compressing the result a second time.
std::optional<std::string> gzipped(const std::string& body) {
    std::string packed;
    httplib::detail::gzip_compressor compressor;

    const bool done = compressor.compress(body.data(), body.size(), true,
                                          [&packed](const char* data, size_t length) {
                                              packed.append(data, length);
                                              return true;
                                          });

    if (!done)
        return std::nullopt;

    return packed;
}

// cpp-httplib drops a query pair whose raw text exactly repeats an earlier one, so a column
// sent twice arrives once. Two spellings of one column still arrive twice, and that is what
// the duplicate refusal is for.
std::vector<std::string> columnsAsked(const httplib::Request& req) {
    return req.get_param_values("columns");
}

// Order is the client's to choose and does not make two declarations different: it decides
// only where a column lands in the snapshot's own array.
bool sameColumns(std::vector<std::string> a, std::vector<std::string> b) {
    std::sort(a.begin(), a.end());
    std::sort(b.begin(), b.end());

    return a == b;
}

LibraryRequest missing(LibraryRefusal refusal, std::string detail) {
    LibraryRequest request;
    request.refusal = refusal;
    request.detail = std::move(detail);
    return request;
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

LibraryRequest columnsDeclared(const httplib::Request& req) {
    const auto asked = columnsAsked(req);
    return asked.empty() ? missing(LibraryRefusal::badColumn, "'columns' is required")
                         : parseLibraryRequest(asked, std::string());
}

void respondLibraryTrackRead(httplib::Response& res, const LibraryTrackRead& read) {
    if (read.outcome != PlaylistOutcome::done) {
        respond(res, httpStatusFor(read.outcome), playlistFailedDocument(playlistFailure(read.outcome)));
        return;
    }

    if (!read.held) {
        respond(res, 404, errorDocument(kNoSuchLibraryTrack));
        return;
    }

    respond(res, 200, libraryTrackDocument(read.columns));
}

// The same gate with the revision the client is catching up from. Unlike
// GET /api/library/changes, where a present but empty `since` is read as revision zero, a
// playlist's own `since` has no such zero to fall back to, so an empty value is refused here
// rather than forwarded to parseLibraryRequest's library reading of it.
LibraryRequest columnsAndSinceDeclared(const httplib::Request& req) {
    const auto asked = columnsAsked(req);
    if (asked.empty())
        return missing(LibraryRefusal::badColumn, "'columns' is required");

    if (!req.has_param("since") || req.get_param_value("since").empty())
        return missing(LibraryRefusal::badSince, "'since' must be a whole number");

    return parseLibraryRequest(asked, req.get_param_value("since"));
}

// FillRequest carries no detail: parseFill has nothing more specific to say than the refusal
// itself, so this is what stands in for AutoPlaylistRequest's on a fill route's own refusals.
std::string fillRefusedDocument(PlaylistRefusal refusal) {
    AutoPlaylistRequest request;
    request.refusal = refusal;
    return playlistRefusedDocument(request);
}

PlaylistOutcome rowsRefusal(DeltaOutcome catchUp) {
    return catchUp == DeltaOutcome::structureChanged ? PlaylistOutcome::rowsMoved
                                                     : PlaylistOutcome::rowsRevisionTooOld;
}

std::optional<OwnPlaylistRole> ownPlaylistRoleFor(const std::string& role) {
    if (role == "scratch")
        return OwnPlaylistRole::scratch;
    return std::nullopt;
}

// parseFill and parseSourceRows decode a request's own set only: title is every writing
// route's own field, read through the same check parseAutoPlaylist's title takes, since a
// value the contract calls unusable here is unusable there for the same reason.
struct RequiredTitle {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string value;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// `onlyTitle` is for the two schemas contract/openapi.yaml declares additionalProperties:
// false with nothing beside title: the rename, and a create naming no set. A create naming
// one, and the own-playlist fill that shares this reader, are held to their own wider field
// list by parseFill or parseSourceRows before either calls this, so they leave it false.
constexpr bool kOnlyTitle = true;

RequiredTitle requiredTitle(const std::string& body, bool onlyTitle = false) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return {PlaylistRefusal::malformedBody, {}};

    if (onlyTitle && !std::all_of(document.value.items().begin(), document.value.items().end(),
                                  [](const auto& field) { return field.key() == "title"; }))
        return {PlaylistRefusal::malformedBody, {}};

    const auto title = readText(document.value, "title", kMaxTitle, Need::required);
    if (!title.ok())
        return {PlaylistRefusal::badTitle, {}};

    return {PlaylistRefusal::none, title.value};
}

// See ARCHITECTURE.md, *Artwork*, for why this and the two lifetimes below are what they are.
constexpr char kAskEveryTime[] = "private, no-cache";

// See ARCHITECTURE.md, *Serving the page*, for why this and pageIsLongCached differ.
constexpr char kPageRevalidate[] = "no-cache";
constexpr char kPageForAYear[] = "public, max-age=31536000, immutable";

void revalidateAlways(httplib::Response& res, const std::string& tag) {
    res.set_header("Cache-Control", kAskEveryTime);
    res.set_header("ETag", tag);
}

void revalidatePerEncoding(httplib::Response& res, const std::string& tag) {
    revalidateAlways(res, tag);
    res.set_header("Vary", "Accept-Encoding");
}

constexpr int kSecondsPerDay = 24 * 60 * 60;

constexpr int kCoverCacheLifetimeSeconds = 180 * kSecondsPerDay;
constexpr int kMissingCoverCacheLifetimeSeconds = 10 * 60;

std::string freshFor(int seconds) {
    return "private, max-age=" + std::to_string(seconds);
}

// What sendArtwork answers with on a 200 or a 304 (present), and on its own 404 or 413 (refused).
struct ArtworkCacheControl {
    std::string present;
    std::string refused;
};

// The body is produced only once the client is known not to hold it already, because
// serialising a library is the expensive half of any of these requests.
void sendIfChanged(const httplib::Request& req, httplib::Response& res, const std::string& name,
                   const char* contentType, const std::function<std::string()>& produce) {
    const bool offered = acceptsGzip(req);
    const auto tag = quoted(name + (offered ? kGzipSuffix : kIdentitySuffix));

    if (alreadyHolds(req, tag)) {
        revalidatePerEncoding(res, tag);
        res.status = 304;
        return;
    }

    const std::string body = produce();
    if (body.size() > kMaxLibraryBytes) {
        respond(res, 413, errorDocument(kLibraryTooLarge));
        return;
    }

    auto packed = offered ? gzipped(body) : std::optional<std::string>();

    revalidatePerEncoding(res, packed ? tag : quoted(name + kIdentitySuffix));
    res.status = 200;

    if (!packed) {
        res.set_content(body, contentType);
        return;
    }

    res.set_header("Content-Encoding", "gzip");
    res.set_content(std::move(*packed), contentType);
}

ListenerStatus listening() {
    ListenerStatus status;
    status.listening = true;
    return status;
}

ListenerStatus refused(std::string why) {
    ListenerStatus status;
    status.error = std::move(why);
    return status;
}

ListenerStatus portTaken(std::string why) {
    auto status = refused(std::move(why));
    status.portInUse = true;
    return status;
}

#ifdef _WIN32
constexpr int kAddressOption = SO_EXCLUSIVEADDRUSE;
constexpr const char* kAddressOptionName = "SO_EXCLUSIVEADDRUSE";
// Only Windows lets a second socket bind a port this one is already listening on, so only
// there does losing the option cost anything but a retry after a restart.
constexpr bool kAddressOptionIsMandatory = true;
#else
constexpr int kAddressOption = SO_REUSEADDR;
constexpr const char* kAddressOptionName = "SO_REUSEADDR";
constexpr bool kAddressOptionIsMandatory = false;
#endif

bool setAddressOption(socket_t sock) {
    const int on = 1;
    return setsockopt(sock, SOL_SOCKET, kAddressOption, reinterpret_cast<const char*>(&on),
                      sizeof(on)) == 0;
}

#ifdef _WIN32
int lastSocketError() {
    return WSAGetLastError();
}

bool socketErrorMeansAddressInUse(int code) {
    return code == WSAEADDRINUSE;
}
#else
int lastSocketError() {
    return errno;
}

bool socketErrorMeansAddressInUse(int code) {
    return code == EADDRINUSE;
}
#endif

struct BindDiagnosis {
    bool inUse = false;
    std::string osError;
};

// cpp-httplib's own bind_to_port() reports only pass or fail, so a socket of our own binds the
// same address right after a failure to read the error that decided it. Nullopt where the probe
// itself cannot say anything: an address inet_pton cannot parse, a probe socket this process
// could not open, or a probe that raced past whatever refused the real attempt and bound fine.
std::optional<BindDiagnosis> diagnoseBindFailure(const std::string& bindAddress, int port) {
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<uint16_t>(port));
    if (inet_pton(AF_INET, bindAddress.c_str(), &addr.sin_addr) != 1)
        return std::nullopt;

#ifdef _WIN32
    const SOCKET probe = ::socket(AF_INET, SOCK_STREAM, 0);
    if (probe == INVALID_SOCKET)
        return std::nullopt;
    const bool bound = ::bind(probe, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0;
    const int code = bound ? 0 : lastSocketError();
    closesocket(probe);
#else
    const int probe = ::socket(AF_INET, SOCK_STREAM, 0);
    if (probe < 0)
        return std::nullopt;
    const bool bound = ::bind(probe, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0;
    const int code = bound ? 0 : lastSocketError();
    ::close(probe);
#endif

    if (bound)
        return std::nullopt;

    BindDiagnosis diagnosis;
    diagnosis.inUse = socketErrorMeansAddressInUse(code);
    diagnosis.osError = std::error_code(code, std::system_category()).message();
    return diagnosis;
}

void applyLimits(httplib::Server& server) {
    server.set_read_timeout(10, 0);
    server.set_write_timeout(10, 0);
    server.set_payload_max_length(kMaxBodyBytes);
}

const char* reasonFor(int status) {
    switch (status) {
        case 404:
            return "not found";
        case 413:
            return "request too large";
        case 501:
            return "not implemented";
        default:
            return "request failed";
    }
}

// cpp-httplib answers its own 404s and 413s with an empty body, so every response this
// component gives carries a JSON "error" key only if those are filled in too.
void fillInEmptyErrors(httplib::Server& server) {
    server.set_error_handler([](const httplib::Request&, httplib::Response& res) {
        using Routing = httplib::Server::HandlerResponse;

        if (!res.body.empty())
            return Routing::Unhandled;

        respond(res, res.status, errorDocument(reasonFor(res.status)));
        return Routing::Handled;
    });
}

void reportFailuresWithoutLeaking(httplib::Server& server) {
    server.set_exception_handler(
        [](const httplib::Request&, httplib::Response& res, std::exception_ptr thrown) {
            try {
                std::rethrow_exception(std::move(thrown));
            } catch (const std::exception& e) {
                logError(std::string("request handler threw: ") + e.what());
            } catch (...) {
                logError("request handler threw an unknown exception");
            }

            respond(res, 500, errorDocument("internal error"));
        });
}

}  // namespace

struct HttpServer::Impl {
    Impl(Settings s, Audience& a, Player p, TicketMint mint, Library* lib, PlayerStateStore* state,
         NowPlayingArtwork* playing)
        : settingsSnapshot(std::make_shared<const Settings>(std::move(s))),
          audience(a),
          player(std::move(p)),
          library(lib),
          playerState(state),
          nowPlayingArtwork(playing),
          tickets(std::move(mint), std::chrono::seconds(settingsSnapshot->streamTicketTtlSeconds),
                  kMaxOutstandingTickets) {}

    // Swapped whole on a reload, so a handler that takes one copy at the top of its own run
    // never sees a Settings with some fields from the file and some from before it.
    mutable std::mutex settingsLock;
    std::shared_ptr<const Settings> settingsSnapshot;

    std::shared_ptr<const Settings> currentSettings() const {
        const std::lock_guard<std::mutex> lock(settingsLock);
        return settingsSnapshot;
    }

    std::atomic<uint64_t> configGeneration{0};

    void applyReload(const ReloadDecision& decision) {
        {
            const std::lock_guard<std::mutex> lock(settingsLock);
            settingsSnapshot = std::make_shared<const Settings>(decision.next);
        }

        const auto movesGeneration =
            std::any_of(decision.changedKeys.begin(), decision.changedKeys.end(),
                       [](const std::string& key) {
                           return key != "allowedHosts" && key != "allowedOrigins";
                       });
        if (movesGeneration)
            configGeneration.fetch_add(1, std::memory_order_relaxed);
    }

    Audience& audience;
    const Player player;
    Library* const library;
    PlayerStateStore* const playerState;
    NowPlayingArtwork* const nowPlayingArtwork;
    httplib::Server server;
    std::thread thread;
    std::atomic<bool> stopping{false};
    std::atomic<bool> addressOptionRefused{false};

    TicketStore tickets;

    RateLimiter playlistChanges{kPlaylistBurst, kPlaylistRefill};

    RateLimiter libraryRebuilds{kRefreshBurst, kRefreshRefill};

    RateLimiter artworkReads{kArtworkBurst, kArtworkRefill};

    PerClientRateLimiter statePolls{kPollBurst, kPollRefill};

    // An export names the columns it wants and this is what it named, so a later rebuild,
    // whether from the player noticing a change or from POST /library/refresh, reproduces the
    // same set rather than whatever the component last happened to build.
    mutable std::mutex declarationLock;
    std::vector<std::string> declared;

    mutable std::mutex reservedNameLock;
    mutable std::set<std::string> loggedReservedNames;

    std::atomic<bool> complainedAboutRate{false};

    bool originAllowed(const std::string& origin) const {
        if (origin.empty())
            return false;

        const auto settings = currentSettings();
        return std::any_of(settings->allowedOrigins.begin(), settings->allowedOrigins.end(),
                            [&origin](const std::string& permitted) {
                                return equalsIgnoringCase(origin, permitted);
                            });
    }

    void applyCors(const httplib::Request& req, httplib::Response& res) const {
        // Set even when refusing, or a cache serves one origin's answer to another.
        res.set_header("Vary", "Origin");

        const auto origin = req.get_header_value("Origin");
        if (!originAllowed(origin))
            return;

        res.set_header("Access-Control-Allow-Origin", origin);
        res.set_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type, If-None-Match");
        res.set_header("Access-Control-Max-Age", "600");

        // See ARCHITECTURE.md, *Facts about the player*, for why If-None-Match, ETag and
        // Retry-After each need naming on one side of a CORS request or the other, and
        // Content-Type and Cache-Control do not.
        res.set_header("Access-Control-Expose-Headers", "ETag, Retry-After");
    }

    void answerRevalidated(const httplib::Request& req, httplib::Response& res,
                           const std::string& bytes, const std::string& type) const {
        const auto tag = pageTag(bytes);
        res.set_header("Cache-Control", kPageRevalidate);
        res.set_header("ETag", tag);

        if (alreadyHolds(req, tag)) {
            res.status = 304;
            return;
        }

        res.status = 200;
        res.set_content(bytes, type);
    }

    void logReservedNameOnce(const std::string& name) const {
        const std::lock_guard<std::mutex> lock(reservedNameLock);
        if (!loggedReservedNames.insert(toLower(name)).second)
            return;

        logInfo("requests under \"" + name +
                "\" are never answered from www/, because that name is one of Jean's own, or "
                "is api");
    }

    void servePageFromDisk(const httplib::Request& req, httplib::Response& res,
                           const std::string& resolved) const {
        const auto route = routePage(resolved, player.pageNames);

        if (route.kind == PageRouteKind::Reserved) {
            logReservedNameOnce(route.name);
            res.status = 404;
            return;
        }

        if (!player.readDiskPage) {
            res.status = 404;
            return;
        }

        if (route.kind == PageRouteKind::FolderRoot) {
            const auto folder = player.readDiskPage(route.name);
            if (folder.kind != DiskPage::Kind::Directory) {
                res.status = 404;
                return;
            }

            res.status = 301;
            res.set_header("Location", "/" + httplib::encode_path_component(route.name) + "/");
            return;
        }

        const auto type = route.kind == PageRouteKind::DiskLocale
                              ? pageContentType(route.diskPath)
                              : interfaceContentType(route.diskPath);
        if (!type) {
            res.status = 404;
            return;
        }

        const auto page = player.readDiskPage(route.diskPath);
        if (page.kind != DiskPage::Kind::File) {
            res.status = 404;
            return;
        }

        answerRevalidated(req, res, page.bytes, *type);
    }

    void servePage(const httplib::Request& req, httplib::Response& res) const {
        const auto resolved = resolvePagePath(req.path);
        if (!resolved) {
            res.status = 404;
            return;
        }

        const auto type = pageContentType(*resolved);
        const auto bytes = type ? player.readPage(*resolved) : std::nullopt;
        if (!bytes) {
            servePageFromDisk(req, res, *resolved);
            return;
        }

        if (pageIsLongCached(*resolved)) {
            res.set_header("Cache-Control", kPageForAYear);
            res.status = 200;
            res.set_content(*bytes, *type);
            return;
        }

        answerRevalidated(req, res, *bytes, *type);
    }

    httplib::Server::HandlerResponse filter(const httplib::Request& req,
                                            httplib::Response& res) const {
        using Routing = httplib::Server::HandlerResponse;

        const auto settings = currentSettings();
        const auto admission =
            admit(req.remote_addr, req.get_header_value("Host"), settings->allowedHosts);
        if (!admission.admitted) {
            if (req.path.rfind(kApiPrefix, 0) == 0) {
                respond(res, 403, errorDocument(admission.refusal));
            } else {
                res.status = 403;
                res.set_content(admission.refusal, "text/plain");
            }
            return Routing::Handled;
        }

        applyCors(req, res);
        res.set_header("X-Content-Type-Options", "nosniff");

        if (req.method == "OPTIONS") {
            res.status = 204;
            return Routing::Handled;
        }

        if (player.readPage && req.path.rfind(kApiPrefix, 0) != 0) {
            if (req.method == "GET" || req.method == "HEAD") {
                servePage(req, res);
                return Routing::Handled;
            }

            return Routing::Unhandled;
        }

        if (req.method == "POST" && req.path.rfind(kApiPrefix, 0) == 0 && !isJsonRequest(req)) {
            respond(res, 415, errorDocument(kSendJson));
            return Routing::Handled;
        }

        return Routing::Unhandled;
    }

    bool changingTooFast() {
        if (playlistChanges.allow(std::chrono::steady_clock::now())) {
            complainedAboutRate = false;
            return false;
        }

        if (!complainedAboutRate.exchange(true)) {
            logError(
                "refusing playlist changes: they are arriving faster than this component "
                "will make them, which usually means a client is looping");
        }

        return true;
    }

    static bool readDeviceIdentity(const httplib::Request& req, httplib::Response& res,
                                   DeviceIdentity& device) {
        const auto asked = parseDeviceIdentity(req.body);
        if (!asked.ok()) {
            respond(res, 400, errorDocument(asked.refusal));
            return false;
        }

        device = asked.device;
        return true;
    }

    bool streamingAvailable() const {
        return player.openStream && !player.streamFormats.empty() &&
               currentSettings()->streamingEnabled;
    }

    const char* streamingRefusalMessage() const {
        return currentSettings()->streamingEnabled ? kNoStreaming : kStreamingDisabled;
    }

    void addStreamRoutes() {
        server.Post("/api/stream/ticket",
                    [this](const httplib::Request& req, httplib::Response& res) {
                        if (!streamingAvailable()) {
                            respond(res, 503, errorDocument(streamingRefusalMessage()));
                            return;
                        }

                        DeviceIdentity device;
                        if (!req.body.empty() && !readDeviceIdentity(req, res, device))
                            return;

                        const auto issued = tickets.issue(std::chrono::steady_clock::now(), device);
                        if (issued.ticket.empty()) {
                            respond(res, 503, errorDocument("could not generate a stream ticket"));
                            return;
                        }

                        respond(res, 200,
                                streamTicketDocument(issued.ticket,
                                                     static_cast<int>(issued.expiresIn.count())));
                    });

        server.Get("/api/stream/listeners", [this](const httplib::Request&,
                                                   httplib::Response& res) {
            denyCachingAndRanges(res);
            const auto settings = currentSettings();
            respond(res, 200,
                    streamListenersDocument(audience.roster(std::chrono::steady_clock::now()),
                                            audience.connections(), settings->maxConcurrentStreams,
                                            player.outputHeld && player.outputHeld()));
        });

        server.Delete("/api/stream/hold", [this](const httplib::Request&, httplib::Response& res) {
            if (!player.releaseOutput) {
                respond(res, 503, errorDocument("this install does not mute the player"));
                return;
            }

            player.releaseOutput();
            res.status = 204;
        });

        server.Post("/api/stream/leave",
                    [this](const httplib::Request& req, httplib::Response& res) {
                        DeviceIdentity device;
                        if (!readDeviceIdentity(req, res, device))
                            return;

                        if (device.id.empty()) {
                            respond(res, 400, errorDocument("deviceId is required"));
                            return;
                        }

                        audience.leave(device.id);
                        res.status = 204;
                    });

        server.Get("/api/stream/timeline", [this](const httplib::Request&, httplib::Response& res) {
            if (!player.readTimeline) {
                respond(res, 503, errorDocument(kNoStreaming));
                return;
            }

            denyCachingAndRanges(res);
            respond(res, 200, player.readTimeline());
        });

        server.Get("/api/stream", [this](const httplib::Request& req, httplib::Response& res) {
            const auto admission =
                tickets.admits(req.get_param_value("ticket"), std::chrono::steady_clock::now());
            if (!admission) {
                respond(res, 401, errorDocument("a valid stream ticket is required"));
                return;
            }

            if (!streamingAvailable()) {
                respond(res, 503, errorDocument(streamingRefusalMessage()));
                return;
            }

            const auto format = req.has_param("format") ? req.get_param_value("format")
                                                        : player.streamFormats.front();

            if (std::find(player.streamFormats.begin(), player.streamFormats.end(), format) ==
                player.streamFormats.end()) {
                respond(res, 400,
                        errorDocument("this install does not encode '" + format +
                                      "'; GET /api/capabilities lists what it does"));
                return;
            }

            auto membership =
                audience.join(admission.device, format, std::chrono::steady_clock::now());
            if (!membership) {
                respond(res, 503,
                        errorDocument("this component is already serving as many streams as "
                                      "it is configured to"));
                return;
            }

            auto opened = player.openStream(format);
            if (!opened.session) {
                respond(res, 503, errorDocument(kNoStreaming));
                return;
            }

            denyCachingAndRanges(res);

            const std::shared_ptr<StreamSession> session(std::move(opened.session));

            // Kept out of the compressor by cpp-httplib's content-type gate, which
            // third_party/README.md has, and not by anything here.
            res.set_chunked_content_provider(
                opened.contentType,
                [this, session, held = std::move(membership)](size_t, httplib::DataSink& sink) {
                    if (!currentSettings()->streamingEnabled) {
                        sink.done();
                        return true;
                    }

                    std::vector<std::uint8_t> bytes;
                    if (!session->next(bytes)) {
                        sink.done();
                        return true;
                    }

                    // cpp-httplib's is_writable() is the only way to notice a listener gone
                    // mid-pause, when no audio is arriving to fail a write against.
                    if (bytes.empty())
                        return sink.is_writable();

                    sink.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
                    return true;
                });
        });
    }

    void declare(std::vector<std::string> columns) {
        const std::lock_guard<std::mutex> lock(declarationLock);
        declared = std::move(columns);
    }

    std::vector<std::string> declaration() const {
        const std::lock_guard<std::mutex> lock(declarationLock);
        return declared;
    }

    // Shared with POST /library/refresh, because a build is a build however it was asked for.
    bool rebuildingTooFast(httplib::Response& res) {
        if (libraryRebuilds.allow(std::chrono::steady_clock::now()))
            return false;

        res.set_header("Retry-After", std::to_string(kRefreshRefill.count()));
        respond(res, 429, errorDocument(kRefreshingTooFast));
        return true;
    }

    // The set asked for is not the one that is ready. Say what is ready, start building what
    // was asked for, and let the client poll GET /state. A set already declared is already
    // being built, so it is answered without asking the player a second time.
    void startBuilding(httplib::Response& res, const std::vector<std::string>& columns,
                       const Library::State& state) {
        if (!player.refreshLibrary) {
            respond(res, 503, errorDocument(kNoLibrary));
            return;
        }

        if (!sameColumns(declaration(), columns)) {
            if (rebuildingTooFast(res))
                return;

            declare(columns);
            player.refreshLibrary(columns, RebuildReason::columnsDeclared);
        }

        respond(res, 202, libraryDocument(state));
    }

    bool pollingTooFast(httplib::Response& res, const std::string& client) {
        if (statePolls.allow(client, std::chrono::steady_clock::now()))
            return false;

        res.set_header("Retry-After", "1");
        respond(res, 429, errorDocument(kPollingTooFast));
        return true;
    }

    void addStateRoutes() {
        server.Get(kStatePath, [this](const httplib::Request& req, httplib::Response& res) {
            // cpp-httplib gives one pooled thread the whole life of a socket, not just one
            // request on it, so a poller left on keep-alive would hold that thread idle
            // between ticks; closing the connection here frees it for the next client instead.
            res.set_header("Connection", "close");

            if (pollingTooFast(res, req.remote_addr))
                return;

            const auto generation = configGeneration.load(std::memory_order_relaxed);
            const auto state = library ? library->state() : Library::State{};
            const auto published =
                playerState ? playerState->read() : PlayerStateStore::Published{};
            sendIfChanged(req, res, generationsOf(state, published.version, generation),
                          "application/json", [&state, &published, generation] {
                              return stateDocument(state, published.state,
                                                   std::chrono::steady_clock::now(),
                                                   published.queueRevision,
                                                   published.playlistsRevision, generation);
                          });
        });

        server.Get(kLibraryExportPath, [this](const httplib::Request& req, httplib::Response& res) {
            const auto request = columnsDeclared(req);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), libraryRefusedDocument(request));
                return;
            }

            if (!library) {
                respond(res, 503, errorDocument(kNoLibrary));
                return;
            }

            const auto state = library->state();
            if (!state.ready || !sameColumns(state.columns, request.columns)) {
                startBuilding(res, request.columns, state);
                return;
            }

            sendIfChanged(req, res, generationsOf(state), kLibraryBytes,
                          [this] { return library->exported(); });
        });

        server.Get(
            kLibraryChangesPath, [this](const httplib::Request& req, httplib::Response& res) {
                const auto request = req.has_param("since")
                                         ? parseLibraryRequest({}, req.get_param_value("since"))
                                         : missing(LibraryRefusal::badSince, "'since' is required");

                if (!request.ok()) {
                    respond(res, httpStatusFor(request.refusal), libraryRefusedDocument(request));
                    return;
                }

                if (!library) {
                    respond(res, 503, errorDocument(kNoLibrary));
                    return;
                }

                const auto state = library->state();
                const auto changes = library->changes(request.since);
                if (changes.outcome != DeltaOutcome::ok) {
                    respond(res, httpStatusFor(changes.outcome),
                            libraryFailedDocument(changes.outcome));
                    return;
                }

                const auto name = generationsOf(state) + "-f" + std::to_string(request.since);
                sendIfChanged(req, res, name, kLibraryBytes,
                              [&changes] { return serialiseDelta(changes.delta); });
            });

        server.Post(kLibraryRefreshPath, [this](const httplib::Request&, httplib::Response& res) {
            if (!library || !player.refreshLibrary) {
                respond(res, 503, errorDocument(kNoLibrary));
                return;
            }

            if (rebuildingTooFast(res))
                return;

            const auto state = library->state();
            const auto columns = declaration();

            player.refreshLibrary(columns.empty() ? state.columns : columns,
                                  RebuildReason::dataChanged);
            respond(res, 202, libraryDocument(state));
        });

        server.Get(kLibraryTrackPath, [this](const httplib::Request& req, httplib::Response& res) {
            // 'subsong' names a track only alongside 'track', but on its own it still
            // announces the library form the way POST /api/tags' kLibraryAddressFields does,
            // so an ordinal sent beside it is refused as two forms rather than silently
            // picked over.
            const bool namesTrack = req.has_param("track") || req.has_param("subsong");
            const bool namesOrdinal = req.has_param("ordinal");

            if (namesTrack && namesOrdinal) {
                respond(res, 400, errorDocument(kTwoTrackAddressForms));
                return;
            }

            if (namesOrdinal) {
                const auto asked = ordinalAsked(req);
                if (!asked.ok()) {
                    respond(res, 400, errorDocument(asked.refusal));
                    return;
                }

                const auto declared = columnsDeclared(req);
                if (!declared.ok()) {
                    respond(res, httpStatusFor(declared.refusal), libraryRefusedDocument(declared));
                    return;
                }

                if (!player.readLibraryOrdinal) {
                    respond(res, 503, errorDocument(kNoLibrary));
                    return;
                }

                respondLibraryTrackRead(res, player.readLibraryOrdinal(asked.ref, declared.columns));
                return;
            }

            if (!namesTrack) {
                respond(res, 400, errorDocument(kNoTrackAddressForm));
                return;
            }

            const auto track = req.get_param_value("track");
            if (const auto refusal = trackAddressRefusal(track); !refusal.empty()) {
                respond(res, 400, errorDocument(refusal));
                return;
            }

            const auto subsong = subsongAsked(req);
            if (!subsong) {
                respond(res, 400, errorDocument(kBadSubsong));
                return;
            }

            const auto declared = columnsDeclared(req);
            if (!declared.ok()) {
                respond(res, httpStatusFor(declared.refusal), libraryRefusedDocument(declared));
                return;
            }

            if (!player.readLibraryTrack) {
                respond(res, 503, errorDocument(kNoLibrary));
                return;
            }

            respondLibraryTrackRead(res, player.readLibraryTrack(track, *subsong, declared.columns));
        });

        server.Get(kPlayingTrackPath, [this](const httplib::Request& req, httplib::Response& res) {
            res.set_header("Cache-Control", kAskEveryTime);

            const auto declared = columnsDeclared(req);
            if (!declared.ok()) {
                respond(res, httpStatusFor(declared.refusal), libraryRefusedDocument(declared));
                return;
            }

            if (!player.readPlayingTrack) {
                respond(res, 404, errorDocument(kNothingPlaying));
                return;
            }

            const auto read = player.readPlayingTrack(declared.columns);
            if (read.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(read.outcome),
                        playlistFailedDocument(playlistFailure(read.outcome)));
                return;
            }

            if (!read.playing) {
                respond(res, 404, errorDocument(kNothingPlaying));
                return;
            }

            respond(res, 200, playingTrackDocument(read.path, read.subsong, read.columns));
        });
    }

    bool fetchingArtworkTooFast(httplib::Response& res) {
        if (artworkReads.allow(std::chrono::steady_clock::now()))
            return false;

        res.set_header("Retry-After", "1");
        respond(res, 429, errorDocument(kFetchingArtworkTooFast));
        return true;
    }

    static void sendArtwork(const httplib::Request& req, httplib::Response& res,
                            const ArtworkSource& source, const ArtworkCacheControl& caching) {
        if (alreadyHolds(req, source.tag)) {
            res.set_header("Cache-Control", caching.present);
            res.set_header("ETag", source.tag);
            res.status = 304;
            return;
        }

        if (source.picture.size() > kMaxArtworkBytes) {
            res.set_header("Cache-Control", caching.refused);
            respond(res, 413, errorDocument(kArtworkTooLarge));
            return;
        }

        const auto type = imageTypeOf(source.picture);
        if (type.empty()) {
            res.set_header("Cache-Control", caching.refused);
            respond(res, 404, errorDocument(kUnpublishableArtwork));
            return;
        }

        res.set_header("Cache-Control", caching.present);
        res.set_header("ETag", source.tag);
        res.status = 200;
        res.set_content(source.picture, type);
    }

    void addArtworkRoute() {
        server.Get(kArtworkPath, [this](const httplib::Request& req, httplib::Response& res) {
            const auto track = req.get_param_value("track");

            if (const auto refusal = trackAddressRefusal(track); !refusal.empty()) {
                respond(res, 400, errorDocument(refusal));
                return;
            }

            if (!player.readArtwork) {
                respond(res, 503, errorDocument(kNoArtwork));
                return;
            }

            if (fetchingArtworkTooFast(res))
                return;

            const auto source = player.readArtwork(track);
            const auto missingCoverCacheControl = freshFor(kMissingCoverCacheLifetimeSeconds);

            if (source.picture.empty()) {
                res.set_header("Cache-Control", missingCoverCacheControl);
                respond(res, 404, errorDocument(kNoArtworkForTrack));
                return;
            }

            sendArtwork(req, res, source,
                       {freshFor(kCoverCacheLifetimeSeconds), missingCoverCacheControl});
        });
    }

    // The picture is held rather than looked up, so a conditional request never reaches the
    // player or a file: it costs a comparison of two strings.
    void addPlayingArtworkRoute() {
        server.Get(kPlayingArtworkPath, [this](const httplib::Request& req,
                                               httplib::Response& res) {
            res.set_header("Cache-Control", kAskEveryTime);

            if (fetchingArtworkTooFast(res))
                return;

            const auto source = nowPlayingArtwork ? nowPlayingArtwork->current() : ArtworkSource{};
            if (source.picture.empty()) {
                respond(res, 404, errorDocument(kNoArtworkForTrack));
                return;
            }

            sendArtwork(req, res, source, {kAskEveryTime, kAskEveryTime});
        });
    }

    // The fallback for a row GET /api/artwork cannot address: no path reaches the client, so
    // the player resolves the playlist and the row to a handle itself and this shares every
    // refusal, the rate limit and the response shape addPlayingArtworkRoute() and
    // addArtworkRoute() already answer with.
    void addPlaylistRowArtworkRoute() {
        constexpr char kPlaylistRowArtworkPath[] =
            R"(/api/artwork/playlists/([0-9a-f-]{36})/([^/]+))";

        server.Get(kPlaylistRowArtworkPath, [this](const httplib::Request& req,
                                                   httplib::Response& res) {
            res.set_header("Cache-Control", kAskEveryTime);

            const auto request = parsePlayRow(req.matches[1].str(), req.matches[2].str());
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            if (!player.readPlaylistRowArtwork) {
                respond(res, 503, errorDocument(kNoArtwork));
                return;
            }

            if (fetchingArtworkTooFast(res))
                return;

            const auto read = player.readPlaylistRowArtwork(request.playlistId, request.index);

            // Both refused as 404, unlike POST .../play: neither is a position a client could
            // choose differently, and a client drawing a grid of covers treats every one the
            // same as a track address the snapshot never held.
            if (read.outcome == PlaylistOutcome::noSuchPlaylist ||
                read.outcome == PlaylistOutcome::positionPastEnd) {
                respond(res, 404, errorDocument(describe(read.outcome)));
                return;
            }

            if (read.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(read.outcome), errorDocument(describe(read.outcome)));
                return;
            }

            if (read.libraryPath || read.source.picture.empty()) {
                respond(res, 404, errorDocument(kNoArtworkForTrack));
                return;
            }

            sendArtwork(req, res, read.source, {kAskEveryTime, kAskEveryTime});
        });
    }

    void addTagRoutes() {
        server.Post("/api/tags", [this](const httplib::Request& req, httplib::Response& res) {
            const auto request = parseTagWrite(req.body, *currentSettings());
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), tagRefusedDocument(request));
                return;
            }

            const auto outcome =
                askIfAvailable(player.writeTags, TagWriteOutcome::unavailable, request.write);
            if (outcome != TagWriteOutcome::written) {
                respond(res, httpStatusFor(outcome), tagFailedDocument(outcome));
                return;
            }

            respond(res, 200, tagWrittenDocument(request.write));
        });
    }

    static std::optional<PlaylistResult> attempt(httplib::Response& res,
                                                 const AutoPlaylistRequest& request,
                                                 const std::function<PlaylistResult()>& ask) {
        if (!request.ok()) {
            if (request.refusal == PlaylistRefusal::tooFast)
                res.set_header("Retry-After", "1");

            respond(res, httpStatusFor(request.refusal), playlistRefusedDocument(request));
            return std::nullopt;
        }

        auto result = ask();
        if (result.outcome != PlaylistOutcome::done) {
            respond(res, httpStatusFor(result.outcome), playlistFailedDocument(result));
            return std::nullopt;
        }

        return result;
    }

    template <typename Callback, typename Unavailable, typename... Args>
    static Unavailable askIfAvailable(const Callback& ask, Unavailable whenUnavailable,
                                      Args&&... args) {
        return ask ? ask(std::forward<Args>(args)...) : std::move(whenUnavailable);
    }

    AutoPlaylistRequest refuseChange(AutoPlaylistRequest request) {
        if (request.ok() && changingTooFast()) {
            request.refusal = PlaylistRefusal::tooFast;
            request.detail = "playlist changes are arriving faster than they can be made";
        }
        return request;
    }

    FillRequest refuseFillChange(FillRequest request) {
        if (request.ok() && changingTooFast())
            request.refusal = PlaylistRefusal::tooFast;
        return request;
    }

    // The read-only-playlists setting, checked ahead of everything else a write route does: a
    // client learns nothing about a request the setting was always going to refuse. Never called
    // from a route addressing the component's own scratch playlist -- that stays writable in
    // both states.
    bool writesRefused(httplib::Response& res) const {
        if (currentSettings()->writePlaylists)
            return false;

        respond(res, httpStatusFor(PlaylistOutcome::writesDisabled),
                playlistFailedDocument(playlistFailure(PlaylistOutcome::writesDisabled)));
        return true;
    }

    bool playbackRefused(httplib::Response& res) const {
        if (currentSettings()->controlPlayback)
            return false;

        respond(res, httpStatusFor(PlaylistOutcome::playbackDisabled),
                playlistFailedDocument(playlistFailure(PlaylistOutcome::playbackDisabled)));
        return true;
    }

    // Only POST /playlists/{id}/items calls this. POST /playlists/own/{role}/items resolves
    // its id through the role itself, so it never holds a client-supplied one for this guard
    // to check.
    //
    // `!player.listPlaylists` is unreachable with a real player: component.cpp wires it
    // unconditionally. The escape exists only for a fake built to model some other route,
    // free to leave the field unset because it never claims to answer for playlist roles.
    //
    // A listing the player could not answer is refused here rather than passed through: it is
    // not evidence that the id names an ordinary playlist, and letting the request continue on
    // it would open the scratch playlist to whichever client holds its id at the moment the
    // component is struggling.
    bool ownPlaylistRefused(const std::string& id, httplib::Response& res) {
        if (!player.listPlaylists)
            return false;

        const auto listed = player.listPlaylists();
        if (listed.outcome != PlaylistOutcome::done) {
            respond(res, httpStatusFor(listed.outcome),
                    playlistFailedDocument(playlistFailure(listed.outcome)));
            return true;
        }

        const auto found =
            std::find_if(listed.playlists.begin(), listed.playlists.end(),
                         [&id](const PlaylistAnnotation& playlist) { return playlist.id == id; });

        if (found == listed.playlists.end() || !found->role)
            return false;

        respond(res, httpStatusFor(PlaylistOutcome::ownPlaylist),
                playlistFailedDocument(playlistFailure(PlaylistOutcome::ownPlaylist)));
        return true;
    }

    static bool playlistIdRefused(const std::string& id, httplib::Response& res) {
        if (isPlaylistId(id))
            return false;

        respond(res, 400, fillRefusedDocument(PlaylistRefusal::badId));
        return true;
    }

    bool playlistChangeTooFast(httplib::Response& res) {
        if (!changingTooFast())
            return false;

        res.set_header("Retry-After", "1");
        respond(res, httpStatusFor(PlaylistRefusal::tooFast),
                fillRefusedDocument(PlaylistRefusal::tooFast));
        return true;
    }

    static void answerPlaylistEdit(httplib::Response& res, const PlaylistResult& result) {
        if (result.outcome != PlaylistOutcome::done) {
            respond(res, httpStatusFor(result.outcome), playlistFailedDocument(result));
            return;
        }

        res.status = 204;
    }

    std::optional<NewPlaylistRows> newPlaylistRows(const httplib::Request& req,
                                                   httplib::Response& res) const {
        NewPlaylistRows rows;

        switch (newPlaylistSetOf(req.body)) {
            case NewPlaylistSet::libraryTracks: {
                if (!library) {
                    respond(res, 503, errorDocument(kNoLibrary));
                    return std::nullopt;
                }

                const auto state = library->state();
                if (!state.ready) {
                    respond(res, 503, libraryFailedDocument(DeltaOutcome::notBuilt));
                    return std::nullopt;
                }

                const auto request = parseFill(req.body, state.trackCount, state.structure, true);
                if (request.outcome != PlaylistOutcome::done) {
                    respond(res, httpStatusFor(request.outcome),
                            playlistFailedDocument(playlistFailure(request.outcome)));
                    return std::nullopt;
                }
                if (!request.ok()) {
                    respond(res, httpStatusFor(request.refusal),
                            fillRefusedDocument(request.refusal));
                    return std::nullopt;
                }

                rows.structure = request.structure;
                rows.ordinals = request.ordinals;
                break;
            }
            case NewPlaylistSet::playlistRows: {
                const auto request = parseSourceRows(req.body, true);
                if (!request.ok()) {
                    respond(res, httpStatusFor(request.refusal),
                            fillRefusedDocument(request.refusal));
                    return std::nullopt;
                }

                rows.sourcePlaylistId = request.playlistId;
                rows.positions = request.positions;
                break;
            }
            case NewPlaylistSet::none:
                break;
        }

        return rows;
    }

    void addPlaylistRoutes() {
        server.Get("/api/playlists", [this](const httplib::Request&, httplib::Response& res) {
            const auto result = askIfAvailable(player.listPlaylists,
                                               PlaylistsResult{PlaylistOutcome::unavailable, {}});

            if (result.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(result.outcome),
                        playlistFailedDocument(playlistFailure(result.outcome)));
                return;
            }

            respond(res, 200, playlistsDocument(result.playlists));
        });

        server.Post("/api/playlists", [this](const httplib::Request& req, httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto set = newPlaylistSetOf(req.body);
            const auto title = requiredTitle(req.body, set == NewPlaylistSet::none);
            if (!title.ok()) {
                respond(res, httpStatusFor(title.refusal), fillRefusedDocument(title.refusal));
                return;
            }

            const auto rows = newPlaylistRows(req, res);
            if (!rows)
                return;

            if (playlistChangeTooFast(res))
                return;

            if (!player.createPlaylist) {
                respond(res, 503, errorDocument(kNoPlaylistWrites));
                return;
            }

            const auto made = player.createPlaylist(title.value, *rows);
            if (made.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(made.outcome), playlistFailedDocument(made));
                return;
            }

            respond(res, 200, playlistDocument(made.playlist));
        });

        constexpr char kPlaylistById[] = R"(/api/playlists/([0-9a-f-]{36}))";

        server.Post(kPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto id = req.matches[1].str();
            if (playlistIdRefused(id, res))
                return;

            const auto title = requiredTitle(req.body, kOnlyTitle);
            if (!title.ok()) {
                respond(res, httpStatusFor(title.refusal), fillRefusedDocument(title.refusal));
                return;
            }

            if (playlistChangeTooFast(res))
                return;

            if (!player.renamePlaylist) {
                respond(res, 503, errorDocument(kNoPlaylistWrites));
                return;
            }

            answerPlaylistEdit(res, player.renamePlaylist(id, title.value));
        });

        server.Delete(kPlaylistById, [this](const httplib::Request& req, httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto id = req.matches[1].str();
            if (playlistIdRefused(id, res))
                return;

            if (playlistChangeTooFast(res))
                return;

            if (!player.removePlaylist) {
                respond(res, 503, errorDocument(kNoPlaylistWrites));
                return;
            }

            answerPlaylistEdit(res, player.removePlaylist(id));
        });

        constexpr char kMovePlaylist[] = R"(/api/playlists/([0-9a-f-]{36})/move)";

        server.Post(kMovePlaylist, [this](const httplib::Request& req, httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto id = req.matches[1].str();
            if (playlistIdRefused(id, res))
                return;

            const auto request = parseMovePlaylist(req.body);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            if (playlistChangeTooFast(res))
                return;

            if (!player.movePlaylist) {
                respond(res, 503, errorDocument(kNoPlaylistWrites));
                return;
            }

            answerPlaylistEdit(res, player.movePlaylist(id, request.index));
        });

        server.Post("/api/autoplaylists/preview", [this](const httplib::Request& req,
                                                         httplib::Response& res) {
            const auto request = parseQueryPreview(req.body);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), playlistRefusedDocument(request));
                return;
            }

            const auto preview =
                askIfAvailable(player.previewQuery, previewFailure(PlaylistOutcome::unavailable),
                               request.spec.query);

            if (preview.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(preview.outcome),
                        playlistFailedDocument(playlistFailure(preview.outcome)));
                return;
            }

            respond(res, 200, queryPreviewDocument(preview));
        });

        server.Post("/api/autoplaylists", [this](const httplib::Request& req,
                                                 httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto request = refuseChange(parseAutoPlaylist(req.body, Need::required));
            const auto maxAutoPlaylists = currentSettings()->maxAutoPlaylists;

            const auto created = attempt(res, request, [this, &request, maxAutoPlaylists] {
                return askIfAvailable(player.createAutoPlaylist,
                                      playlistFailure(PlaylistOutcome::unavailable), request.spec,
                                      maxAutoPlaylists);
            });

            if (created)
                respond(res, 200, playlistDocument(created->playlist));
        });

        constexpr char kById[] = R"(/api/autoplaylists/([0-9a-f-]{36}))";

        server.Post(kById, [this](const httplib::Request& req, httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto id = req.matches[1].str();
            const auto request =
                refuseChange(withId(parseAutoPlaylist(req.body, Need::optional), id));

            const auto updated = attempt(res, request, [this, &request, &id] {
                return askIfAvailable(player.updateAutoPlaylist,
                                      playlistFailure(PlaylistOutcome::unavailable), id,
                                      request.spec);
            });

            if (updated)
                respond(res, 200, playlistDocument(updated->playlist));
        });

        server.Delete(kById, [this](const httplib::Request& req, httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto id = req.matches[1].str();
            const auto request = refuseChange(withId(AutoPlaylistRequest(), id));

            const auto removed = attempt(res, request, [this, &id] {
                return askIfAvailable(player.removeAutoPlaylist,
                                      playlistFailure(PlaylistOutcome::unavailable), id);
            });

            if (removed)
                respond(res, 200, playlistRemovedDocument(id));
        });

        constexpr char kOwnItems[] = R"(/api/playlists/own/([^/]+)/items)";

        server.Post(kOwnItems, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            if (!library) {
                respond(res, 503, errorDocument(kNoLibrary));
                return;
            }

            const auto state = library->state();
            if (!state.ready) {
                respond(res, 503, libraryFailedDocument(DeltaOutcome::notBuilt));
                return;
            }

            const auto role = ownPlaylistRoleFor(req.matches[1].str());
            if (!role) {
                respond(res, 400, fillRefusedDocument(PlaylistRefusal::malformedBody));
                return;
            }

            const auto request =
                refuseFillChange(parseFill(req.body, state.trackCount, state.structure, true));
            if (!request.ok()) {
                if (request.outcome != PlaylistOutcome::done) {
                    respond(res, httpStatusFor(request.outcome),
                            playlistFailedDocument(playlistFailure(request.outcome)));
                    return;
                }
                if (request.refusal == PlaylistRefusal::tooFast)
                    res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            const auto title = requiredTitle(req.body);
            if (!title.ok()) {
                respond(res, httpStatusFor(title.refusal), fillRefusedDocument(title.refusal));
                return;
            }

            const auto titled = ownPlaylistTitle(title.value);

            const auto resolved = player.ownPlaylist(*role, titled);
            if (resolved.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(resolved.outcome),
                        playlistFailedDocument(playlistFailure(resolved.outcome)));
                return;
            }

            const auto filled = player.fill(resolved.playlist.id, titled, request.structure,
                                            request.ordinals, true);
            if (filled.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(filled.outcome),
                        playlistFailedDocument(playlistFailure(filled.outcome)));
                return;
            }

            respond(res, 200,
                    fillResultDocument(resolved.playlist.id, filled.structure, filled.positions));
        });

        server.Delete(kOwnItems, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            const auto role = ownPlaylistRoleFor(req.matches[1].str());
            if (!role) {
                respond(res, 400, fillRefusedDocument(PlaylistRefusal::malformedBody));
                return;
            }

            if (changingTooFast()) {
                res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(PlaylistRefusal::tooFast),
                        fillRefusedDocument(PlaylistRefusal::tooFast));
                return;
            }

            if (!player.emptyOwnPlaylist) {
                respond(res, 503, errorDocument(kNoOwnPlaylists));
                return;
            }

            const auto emptied = player.emptyOwnPlaylist(*role);
            if (emptied.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(emptied.outcome),
                        playlistFailedDocument(playlistFailure(emptied.outcome)));
                return;
            }

            res.status = 204;
        });

        constexpr char kPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items)";

        server.Post(kPlaylistItems, [this](const httplib::Request& req, httplib::Response& res) {
            if (writesRefused(res))
                return;

            if (!library) {
                respond(res, 503, errorDocument(kNoLibrary));
                return;
            }

            const auto state = library->state();
            if (!state.ready) {
                respond(res, 503, libraryFailedDocument(DeltaOutcome::notBuilt));
                return;
            }

            const auto id = req.matches[1].str();
            if (!isPlaylistId(id)) {
                respond(res, 400, fillRefusedDocument(PlaylistRefusal::badId));
                return;
            }

            if (ownPlaylistRefused(id, res))
                return;

            const auto request =
                refuseFillChange(parseFill(req.body, state.trackCount, state.structure));
            if (!request.ok()) {
                if (request.outcome != PlaylistOutcome::done) {
                    respond(res, httpStatusFor(request.outcome),
                            playlistFailedDocument(playlistFailure(request.outcome)));
                    return;
                }
                if (request.refusal == PlaylistRefusal::tooFast)
                    res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            const auto filled =
                player.fill(id, std::string{}, request.structure, request.ordinals, false);
            if (filled.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(filled.outcome),
                        playlistFailedDocument(playlistFailure(filled.outcome)));
                return;
            }

            respond(res, 200, fillResultDocument(id, filled.structure, filled.positions));
        });

        server.Get(kPlaylistItems, [this](const httplib::Request& req, httplib::Response& res) {
            const auto id = req.matches[1].str();
            if (!isPlaylistId(id)) {
                respond(res, 400, fillRefusedDocument(PlaylistRefusal::badId));
                return;
            }

            const auto declared = columnsDeclared(req);
            if (!declared.ok()) {
                respond(res, httpStatusFor(declared.refusal), libraryRefusedDocument(declared));
                return;
            }

            const auto page =
                parsePlaylistPage(req.get_param_value("offset"), req.get_param_value("count"));
            if (!page.ok()) {
                respond(res, httpStatusFor(page.refusal), fillRefusedDocument(page.refusal));
                return;
            }

            if (!player.readPlaylistRows) {
                respond(res, 503, errorDocument(kNoPlaylistRows));
                return;
            }

            const auto read =
                player.readPlaylistRows(id, page.offset, page.count, declared.columns);

            if (read.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(read.outcome),
                        playlistFailedDocument(playlistFailure(read.outcome)));
                return;
            }

            respond(res, 200, playlistRowsDocument(read));
        });

        constexpr char kPlaylistItemChanges[] = R"(/api/playlists/([0-9a-f-]{36})/items/changes)";

        server.Get(
            kPlaylistItemChanges, [this](const httplib::Request& req, httplib::Response& res) {
                const auto id = req.matches[1].str();
                if (!isPlaylistId(id)) {
                    respond(res, 400, fillRefusedDocument(PlaylistRefusal::badId));
                    return;
                }

                const auto declared = columnsAndSinceDeclared(req);
                if (!declared.ok()) {
                    respond(res, httpStatusFor(declared.refusal), libraryRefusedDocument(declared));
                    return;
                }

                uint64_t structure = 0;
                if (!readDecimal(req.get_param_value("structure"), structure)) {
                    respond(res, httpStatusFor(PlaylistRefusal::badOrdinals),
                            fillRefusedDocument(PlaylistRefusal::badOrdinals));
                    return;
                }

                if (!player.readChangedPlaylistRows) {
                    respond(res, 503, errorDocument(kNoPlaylistRows));
                    return;
                }

                const auto read =
                    player.readChangedPlaylistRows(id, structure, declared.since, declared.columns);

                if (read.outcome != PlaylistOutcome::done) {
                    respond(res, httpStatusFor(read.outcome),
                            playlistFailedDocument(playlistFailure(read.outcome)));
                    return;
                }

                if (read.catchUp != DeltaOutcome::ok) {
                    const auto refusal = rowsRefusal(read.catchUp);
                    respond(res, httpStatusFor(refusal),
                            playlistFailedDocument(playlistFailure(refusal)));
                    return;
                }

                respond(res, 200, playlistChangesDocument(read));
            });

        constexpr char kCopyPlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/copy)";

        server.Post(kCopyPlaylistItems, [this](const httplib::Request& req,
                                               httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto id = req.matches[1].str();
            if (playlistIdRefused(id, res))
                return;

            const auto request = parseSourceRows(req.body);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            if (playlistChangeTooFast(res))
                return;

            if (!player.copyPlaylistRows) {
                respond(res, 503, errorDocument(kNoPlaylistRows));
                return;
            }

            const auto copied = player.copyPlaylistRows(id, request.playlistId, request.positions);
            if (copied.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(copied.outcome),
                        playlistFailedDocument(playlistFailure(copied.outcome)));
                return;
            }

            respond(res, 200, copiedRowsDocument(copied.structure, copied.positions));
        });

        constexpr char kRemovePlaylistItems[] = R"(/api/playlists/([0-9a-f-]{36})/items/remove)";

        server.Post(kRemovePlaylistItems, [this](const httplib::Request& req,
                                                 httplib::Response& res) {
            if (writesRefused(res))
                return;

            const auto id = req.matches[1].str();
            if (playlistIdRefused(id, res))
                return;

            const auto request = parseRemoveRows(req.body);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            if (playlistChangeTooFast(res))
                return;

            if (!player.removePlaylistRows) {
                respond(res, 503, errorDocument(kNoPlaylistRows));
                return;
            }

            const auto removed = player.removePlaylistRows(id, request.structure, request.ordinals);
            if (removed.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(removed.outcome),
                        playlistFailedDocument(playlistFailure(removed.outcome)));
                return;
            }

            respond(res, 200, removedRowsDocument(removed.structure));
        });

        constexpr char kPlayPlaylistRow[] = R"(/api/playlists/([0-9a-f-]{36})/items/([^/]+)/play)";

        server.Post(kPlayPlaylistRow, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            const auto request = parsePlayRow(req.matches[1].str(), req.matches[2].str());
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            if (!player.playPlaylistRow) {
                respond(res, 503, errorDocument(kNoPlaylistRows));
                return;
            }

            answerCommand(res, player.playPlaylistRow(request.playlistId, request.index));
        });
    }

    static AutoPlaylistRequest withId(AutoPlaylistRequest request, const std::string& id) {
        if (request.ok() && !isPlaylistId(id)) {
            request.refusal = PlaylistRefusal::badId;
            request.detail = "the playlist id must be one this component reported";
        }
        return request;
    }

    void addQueueRoutes() {
        server.Get(kQueuePath, [this](const httplib::Request&, httplib::Response& res) {
            if (!player.readQueue) {
                respond(res, 503, errorDocument(kNoQueue));
                return;
            }

            const auto read = player.readQueue();
            if (read.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(read.outcome),
                        playlistFailedDocument(playlistFailure(read.outcome)));
                return;
            }

            respond(res, 200, queueDocument(read));
        });

        server.Post(kQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            switch (queueSourceOf(req.body)) {
                case QueueSource::playlistRows:
                    postQueuePlaylistRows(req, res);
                    return;
                case QueueSource::libraryTracks:
                    postQueueLibraryTracks(req, res);
                    return;
                case QueueSource::invalid:
                    respond(res, 400, fillRefusedDocument(PlaylistRefusal::malformedBody));
                    return;
            }
        });

        server.Delete(kQueuePath, [this](const httplib::Request&, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            if (changingTooFast()) {
                res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(PlaylistRefusal::tooFast),
                        fillRefusedDocument(PlaylistRefusal::tooFast));
                return;
            }

            if (!player.clearQueue) {
                respond(res, 503, errorDocument(kNoQueue));
                return;
            }

            const auto outcome = player.clearQueue();
            if (outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(outcome),
                        playlistFailedDocument(playlistFailure(outcome)));
                return;
            }

            res.status = 204;
        });

        constexpr char kMoveQueuePath[] = "/api/queue/move";

        server.Post(kMoveQueuePath, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            const auto request = refuseMoveQueueChange(parseMoveQueue(req.body));
            if (!request.ok()) {
                if (request.refusal == PlaylistRefusal::tooFast)
                    res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            if (queueHasMoved(request.revision)) {
                respondQueueMoved(res);
                return;
            }

            if (!player.moveQueueEntry) {
                respond(res, 503, errorDocument(kNoQueue));
                return;
            }

            const auto outcome = player.moveQueueEntry(request.from, request.to, request.revision);
            if (outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(outcome),
                        playlistFailedDocument(playlistFailure(outcome)));
                return;
            }

            res.status = 204;
        });

        // Matched loosely, on purpose: a non-numeric segment must reach parseRemoveQueue's own
        // 400 rather than fall through to a generic 404.
        constexpr char kQueueEntryPath[] = R"(/api/queue/([^/]+))";

        server.Delete(kQueueEntryPath, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            const auto request = refuseRemoveQueueChange(
                parseRemoveQueue(req.matches[1].str(), req.get_param_value("revision")));
            if (!request.ok()) {
                if (request.refusal == PlaylistRefusal::tooFast)
                    res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            if (queueHasMoved(request.revision)) {
                respondQueueMoved(res);
                return;
            }

            if (!player.removeQueueEntry) {
                respond(res, 503, errorDocument(kNoQueue));
                return;
            }

            const auto outcome = player.removeQueueEntry(request.index, request.revision);
            if (outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(outcome),
                        playlistFailedDocument(playlistFailure(outcome)));
                return;
            }

            res.status = 204;
        });
    }

    void postQueuePlaylistRows(const httplib::Request& req, httplib::Response& res) {
        auto request = refuseQueueRowsChange(parseQueueRows(req.body));
        if (!request.ok()) {
            if (request.refusal == PlaylistRefusal::tooFast)
                res.set_header("Retry-After", "1");
            respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
            return;
        }

        if (request.at && queueHasMoved(request.at->revision)) {
            respondQueueMoved(res);
            return;
        }

        if (!player.queuePlaylistRows) {
            respond(res, 503, errorDocument(kNoQueue));
            return;
        }

        const auto outcome =
            player.queuePlaylistRows(request.playlistId, request.positions, request.at);
        if (outcome != PlaylistOutcome::done) {
            respond(res, httpStatusFor(outcome), playlistFailedDocument(playlistFailure(outcome)));
            return;
        }

        res.status = 204;
    }

    void postQueueLibraryTracks(const httplib::Request& req, httplib::Response& res) {
        if (!library) {
            respond(res, 503, errorDocument(kNoLibrary));
            return;
        }

        const auto state = library->state();
        if (!state.ready) {
            respond(res, 503, libraryFailedDocument(DeltaOutcome::notBuilt));
            return;
        }

        auto request =
            refuseQueueTracksChange(parseQueueTracks(req.body, state.trackCount, state.structure));
        if (!request.ok()) {
            if (request.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(request.outcome),
                        playlistFailedDocument(playlistFailure(request.outcome)));
                return;
            }
            if (request.refusal == PlaylistRefusal::tooFast)
                res.set_header("Retry-After", "1");
            respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
            return;
        }

        if (request.at && queueHasMoved(request.at->revision)) {
            respondQueueMoved(res);
            return;
        }

        if (!player.queueLibraryTracks) {
            respond(res, 503, errorDocument(kNoQueue));
            return;
        }

        const auto outcome =
            player.queueLibraryTracks(request.structure, request.ordinals, request.at);
        if (outcome != PlaylistOutcome::done) {
            respond(res, httpStatusFor(outcome), playlistFailedDocument(playlistFailure(outcome)));
            return;
        }

        res.status = 204;
    }

    QueueRowsRequest refuseQueueRowsChange(QueueRowsRequest request) {
        if (request.ok() && changingTooFast())
            request.refusal = PlaylistRefusal::tooFast;
        return request;
    }

    QueueTracksRequest refuseQueueTracksChange(QueueTracksRequest request) {
        if (request.ok() && changingTooFast())
            request.refusal = PlaylistRefusal::tooFast;
        return request;
    }

    MoveQueueRequest refuseMoveQueueChange(MoveQueueRequest request) {
        if (request.ok() && changingTooFast())
            request.refusal = PlaylistRefusal::tooFast;
        return request;
    }

    RemoveQueueRequest refuseRemoveQueueChange(RemoveQueueRequest request) {
        if (request.ok() && changingTooFast())
            request.refusal = PlaylistRefusal::tooFast;
        return request;
    }

    // A revision only a route reading it ahead of the player can judge: the store, not the
    // job, is what a client's own next poll will see. A null store -- no install runs with
    // one, but a test may -- reads as revision 0, same as a fresh queue with nothing to name.
    bool queueHasMoved(uint64_t revision) const {
        const auto current = playerState ? playerState->read().queueRevision : uint64_t{0};
        return current != revision;
    }

    static void respondQueueMoved(httplib::Response& res) {
        respond(res, httpStatusFor(PlaylistOutcome::queueMoved),
                playlistFailedDocument(playlistFailure(PlaylistOutcome::queueMoved)));
    }

    static void answerCommand(httplib::Response& res, PlaylistOutcome outcome) {
        if (outcome == PlaylistOutcome::done) {
            res.status = 204;
            return;
        }

        respond(res, httpStatusFor(outcome), playlistFailedDocument(playlistFailure(outcome)));
    }

    void addTransportRoute(const char* path, Transport command) {
        server.Post(path, [this, command](const httplib::Request&, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            if (!player.commandTransport) {
                respond(res, 503, errorDocument(kNoPlayback));
                return;
            }

            answerCommand(res, player.commandTransport(command));
        });
    }

    void addPlaybackRoutes() {
        addTransportRoute(kPlaybackPlayPausePath, Transport::PlayPause);
        addTransportRoute(kPlaybackNextPath, Transport::Next);
        addTransportRoute(kPlaybackPreviousPath, Transport::Previous);
        addTransportRoute(kPlaybackStopPath, Transport::Stop);

        server.Post(kPlaybackSeekPath, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            const auto request = parseSeek(req.body);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal),
                        playbackRefusedDocument(request.refusal, request.detail));
                return;
            }

            if (!player.seek) {
                respond(res, 503, errorDocument(kNoPlayback));
                return;
            }

            answerCommand(res, player.seek(request.seconds, request.relative));
        });

        server.Post(kPlaybackModePath, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            const auto request = parsePlaybackMode(req.body);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal),
                        playbackRefusedDocument(request.refusal, request.detail));
                return;
            }

            const auto resolved = resolvePlaybackMode(request.mode, player.playbackOrders);
            if (resolved.resolution == PlaybackModeResolution::unknownMode) {
                respond(res, httpStatusFor(PlaybackRefusal::badMode),
                        playbackRefusedDocument(PlaybackRefusal::badMode,
                                                "'" + request.mode +
                                                    "' is not a playback mode this API knows"));
                return;
            }

            if (resolved.resolution == PlaybackModeResolution::notOffered) {
                respond(res, 409, errorDocument(kModeNotOffered));
                return;
            }

            if (!player.setPlaybackOrder) {
                respond(res, 503, errorDocument(kNoPlayback));
                return;
            }

            answerCommand(res, player.setPlaybackOrder(resolved.index));
        });
    }

    void addVolumeRoute() {
        server.Post(kVolumePath, [this](const httplib::Request& req, httplib::Response& res) {
            if (playbackRefused(res))
                return;

            const auto request = parseVolume(req.body, player.volumeMin, player.volumeMax);
            if (!request.ok()) {
                respond(res, httpStatusFor(request.refusal),
                        playbackRefusedDocument(request.refusal, request.detail));
                return;
            }

            switch (request.form) {
                case VolumeRequest::Form::value:
                    if (!player.setVolume) {
                        respond(res, 503, errorDocument(kNoVolume));
                        return;
                    }
                    answerCommand(res, player.setVolume(request.value));
                    return;

                case VolumeRequest::Form::step:
                    if (!player.stepVolume) {
                        respond(res, 503, errorDocument(kNoVolume));
                        return;
                    }
                    answerCommand(res, player.stepVolume(request.step == "up" ? VolumeStep::Up
                                                                             : VolumeStep::Down));
                    return;

                case VolumeRequest::Form::muted:
                    if (!player.setMuted) {
                        respond(res, 503, errorDocument(kNoVolume));
                        return;
                    }
                    answerCommand(res, player.setMuted(request.muted));
                    return;
            }
        });
    }
};

HttpServer::HttpServer(Settings settings, Audience& audience, Player player, TicketMint mint,
                       Library* library, PlayerStateStore* playerState,
                       NowPlayingArtwork* nowPlayingArtwork)
    : impl_(std::make_unique<Impl>(std::move(settings), audience, std::move(player),
                                   std::move(mint), library, playerState, nowPlayingArtwork)) {}

HttpServer::~HttpServer() {
    stop();
}

ListenerStatus HttpServer::start() {
    auto& impl = *impl_;
    auto& server = impl.server;

    server.set_socket_options([&impl](socket_t sock) {
        if (!setAddressOption(sock))
            impl.addressOptionRefused = true;
    });

    server.set_tcp_nodelay(true);

    applyLimits(server);
    reportFailuresWithoutLeaking(server);
    fillInEmptyErrors(server);

    server.set_pre_routing_handler([&impl](const httplib::Request& req, httplib::Response& res) {
        return impl.filter(req, res);
    });

    server.Get("/api/status", [](const httplib::Request&, httplib::Response& res) {
        respond(res, 200, statusDocument());
    });

    server.Get("/api/capabilities", [&impl](const httplib::Request&, httplib::Response& res) {
        respond(res, 200,
                capabilitiesDocument(*impl.currentSettings(), impl.player.streamFormats,
                                     impl.player.releaseOutput != nullptr, impl.library != nullptr,
                                     impl.player.playerName, impl.player.playerVersion,
                                     impl.player.volumeMin, impl.player.volumeMax,
                                     impl.player.volumeUnit, impl.player.playbackOrders));
    });

    impl.addTagRoutes();
    impl.addPlaylistRoutes();
    impl.addQueueRoutes();
    impl.addPlaybackRoutes();
    impl.addVolumeRoute();
    impl.addStreamRoutes();
    impl.addStateRoutes();
    impl.addArtworkRoute();
    impl.addPlayingArtworkRoute();
    impl.addPlaylistRowArtworkRoute();

    const auto startupSettings = impl.currentSettings();
    if (!server.bind_to_port(startupSettings->bindAddress, startupSettings->port)) {
        const std::string address =
            startupSettings->bindAddress + ":" + std::to_string(startupSettings->port);
        const auto diagnosis =
            diagnoseBindFailure(startupSettings->bindAddress, startupSettings->port);

        if (diagnosis && diagnosis->inUse)
            return portTaken("could not bind " + address + "; the port is in use");

        if (diagnosis) {
            return refused("could not bind " + address +
                           "; that address is not one this machine holds (" + diagnosis->osError +
                           ")");
        }

        return refused("could not bind " + address +
                       "; the port may already be in use, or that address may not be one this "
                       "machine holds");
    }

    if (impl.addressOptionRefused) {
        const std::string what = std::string("the listening socket refused ") + kAddressOptionName;
        if constexpr (kAddressOptionIsMandatory) {
            server.stop();
            return refused(what +
                           "; another socket could bind this port and take half its traffic");
        }
        logError(what + "; a restart may have to wait for the port");
    }

    impl.thread = std::thread([&impl] { impl.server.listen_after_bind(); });

    return listening();
}

void HttpServer::stop() {
    if (!impl_ || impl_->stopping.exchange(true))
        return;

    impl_->server.stop();

    if (impl_->thread.joinable())
        impl_->thread.join();
}

void HttpServer::applyReload(const ReloadDecision& decision) {
    impl_->applyReload(decision);
}

}  // namespace jean
