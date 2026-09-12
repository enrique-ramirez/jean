#include "third_party/httplib.h"

#include "core/device.h"
#include "core/http_server.h"
#include "core/json.h"
#include "core/log.h"
#include "core/pairing.h"
#include "core/rate_limit.h"
#include "core/stream_ticket.h"
#include "core/text.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <functional>
#include <iterator>
#include <mutex>
#include <optional>
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

constexpr int kPairBurst = 10;
constexpr auto kPairRefill = std::chrono::seconds(6);

// A refresh walks every track in the player's library, so this is a rate a person at a
// button can keep up with and a looping client cannot.
constexpr int kRefreshBurst = 3;
constexpr auto kRefreshRefill = std::chrono::seconds(30);

// A screenful of covers arrives at once and that is the feature, so the burst is deep and
// what it bounds is a client stuck in a loop turning into a queue of disk reads.
constexpr int kArtworkBurst = 300;
constexpr auto kArtworkRefill = std::chrono::milliseconds(50);

constexpr char kPairPath[] = "/api/pair";
constexpr char kArtworkPath[] = "/api/artwork";
constexpr char kLibraryPath[] = "/api/library";
constexpr char kLibraryExportPath[] = "/api/library/export";
constexpr char kLibraryChangesPath[] = "/api/library/changes";
constexpr char kLibraryRefreshPath[] = "/api/library/refresh";

constexpr char kNoStreaming[] = "streaming is not available";

constexpr char kNoLibrary[] = "the media library is not available";

constexpr char kLibraryTooLarge[] = "the library snapshot is larger than this component sends";

constexpr char kRefreshingTooFast[] = "too many library refreshes";

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

std::string generationsOf(const Library::State& state) {
    return "s" + std::to_string(state.structure) + "-r" + std::to_string(state.revision);
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

// FillRequest carries no detail: parseFill has nothing more specific to say than the refusal
// itself, so this is what stands in for AutoPlaylistRequest's on a fill route's own refusals.
std::string fillRefusedDocument(PlaylistRefusal refusal) {
    AutoPlaylistRequest request;
    request.refusal = refusal;
    return playlistRefusedDocument(request);
}

std::optional<OwnPlaylistRole> ownPlaylistRoleFor(const std::string& role) {
    if (role == "scratch")
        return OwnPlaylistRole::scratch;
    if (role == "queue")
        return OwnPlaylistRole::queue;
    return std::nullopt;
}

// parseFill decodes the ordinal set only: the title is the own-playlist route's own field,
// read through the same check parseAutoPlaylist's title takes, since a value the contract
// calls unusable here is unusable there for the same reason.
struct OwnFillTitle {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::string value;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

OwnFillTitle ownFillTitle(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return {PlaylistRefusal::malformedBody, {}};

    const auto title = readText(document.value, "title", kMaxTitle, Need::required);
    if (!title.ok())
        return {PlaylistRefusal::badTitle, {}};

    return {PlaylistRefusal::none, title.value};
}

constexpr char kKeepAndRevalidate[] = "no-cache, must-revalidate";

void revalidateAlways(httplib::Response& res, const std::string& tag) {
    res.set_header("Cache-Control", kKeepAndRevalidate);
    res.set_header("ETag", tag);
}

void revalidatePerEncoding(httplib::Response& res, const std::string& tag) {
    revalidateAlways(res, tag);
    res.set_header("Vary", "Accept-Encoding");
}

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
    Impl(Settings s, Audience& a, Player p, TicketMint mint, Library* lib)
        : settings(std::move(s)),
          audience(a),
          player(std::move(p)),
          library(lib),
          tickets(std::move(mint), std::chrono::seconds(settings.streamTicketTtlSeconds),
                  kMaxOutstandingTickets) {}

    const Settings settings;
    Audience& audience;
    const Player player;
    Library* const library;
    httplib::Server server;
    std::thread thread;
    std::atomic<bool> stopping{false};
    std::atomic<bool> addressOptionRefused{false};

    TicketStore tickets;

    RateLimiter playlistChanges{kPlaylistBurst, kPlaylistRefill};

    RateLimiter libraryRebuilds{kRefreshBurst, kRefreshRefill};

    RateLimiter artworkReads{kArtworkBurst, kArtworkRefill};

    // An export names the columns it wants and this is what it named, so a later rebuild,
    // whether from the player noticing a change or from POST /library/refresh, reproduces the
    // same set rather than whatever the component last happened to build.
    mutable std::mutex declarationLock;
    std::vector<std::string> declared;

    RateLimiter pairAttempts{kPairBurst, kPairRefill};
    PairingWindow pairing{std::chrono::seconds(kPairingWindowSeconds)};

    std::atomic<bool> complainedAboutRate{false};

    bool originAllowed(const std::string& origin, const std::string& path,
                       const std::string& host) const {
        if (origin.empty())
            return false;

        if (!settings.allowedOrigins.empty())
            return std::any_of(settings.allowedOrigins.begin(), settings.allowedOrigins.end(),
                               [&origin](const std::string& permitted) {
                                   return equalsIgnoringCase(origin, permitted);
                               });

        if (path == kPairPath) {
            const auto from = hostOfOrigin(origin);
            return !from.empty() && from == hostOfOrigin("x://" + host);
        }

        return true;
    }

    void applyCors(const httplib::Request& req, httplib::Response& res) const {
        // Set even when refusing, or a cache serves one origin's answer to another.
        res.set_header("Vary", "Origin");

        const auto origin = req.get_header_value("Origin");
        if (!originAllowed(origin, req.path, req.get_header_value("Host")))
            return;

        res.set_header("Access-Control-Allow-Origin", origin);
        res.set_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.set_header("Access-Control-Allow-Headers",
                       "Authorization, Content-Type, If-None-Match");
        res.set_header("Access-Control-Max-Age", "600");

        // See ARCHITECTURE.md, *Facts about the player*, for why If-None-Match, ETag and
        // Retry-After each need naming on one side of a CORS request or the other, and
        // Authorization, Content-Type and Cache-Control do not.
        res.set_header("Access-Control-Expose-Headers", "ETag, Retry-After");
    }

    bool authorized(const httplib::Request& req) const {
        if (settings.authToken.empty())
            return false;

        const auto header = req.get_header_value("Authorization");

        constexpr char kScheme[] = "bearer ";
        constexpr size_t kSchemeLength = sizeof(kScheme) - 1;

        if (header.size() <= kSchemeLength)
            return false;
        if (toLower(header.substr(0, kSchemeLength)) != kScheme)  // RFC 9110: case-insensitive
            return false;

        return secureEquals(header.substr(kSchemeLength), settings.authToken);
    }

    httplib::Server::HandlerResponse filter(const httplib::Request& req,
                                            httplib::Response& res) const {
        using Routing = httplib::Server::HandlerResponse;

        applyCors(req, res);
        res.set_header("X-Content-Type-Options", "nosniff");

        if (req.method == "OPTIONS") {
            res.status = 204;
            return Routing::Handled;
        }

        if (req.path == "/api/status" || req.path == "/api/stream" || req.path == kPairPath)
            return Routing::Unhandled;

        if (!authorized(req)) {
            // No WWW-Authenticate: sending it pops a native browser credential dialog, and
            // no browser can satisfy this scheme anyway.
            respond(res, 401, errorDocument("authentication required"));
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

    void addPairingRoute() {
        server.Post(kPairPath, [this](const httplib::Request& req, httplib::Response& res) {
            if (!isJsonRequest(req)) {
                respond(res, 415, errorDocument(kSendJson));
                return;
            }

            if (!pairAttempts.allow(std::chrono::steady_clock::now())) {
                respond(res, 429, errorDocument("too many pairing attempts"));
                return;
            }

            const auto asked = parseDeviceName(req.body);
            if (!asked.ok()) {
                respond(res, 400, errorDocument(asked.refusal));
                return;
            }

            const auto name = sanitised(asked.device).name;

            const auto outcome =
                pairing.claim(std::chrono::steady_clock::now(), std::chrono::system_clock::now(),
                              req.remote_addr, name);

            if (outcome == PairingWindow::Result::AddressNotPrivate) {
                logError("refused a pairing request from " + req.remote_addr +
                         ": pairing is available on the local network only");
                respond(res, 403, errorDocument("pairing is available on the local network only"));
                return;
            }

            if (outcome == PairingWindow::Result::NotOpen) {
                respond(res, 403, errorDocument("pairing is not open"));
                return;
            }

            logInfo("paired with " + req.remote_addr +
                    (name.empty() ? std::string() : " (" + name + ")"));
            respond(res, 200, pairedDocument(settings.authToken));
        });
    }

    static bool readDeviceIdentity(const httplib::Request& req, httplib::Response& res,
                                   DeviceIdentity& device) {
        if (!isJsonRequest(req)) {
            respond(res, 415, errorDocument(kSendJson));
            return false;
        }

        const auto asked = parseDeviceIdentity(req.body);
        if (!asked.ok()) {
            respond(res, 400, errorDocument(asked.refusal));
            return false;
        }

        device = asked.device;
        return true;
    }

    bool streamingAvailable() const { return player.openStream && !player.streamFormats.empty(); }

    void addStreamRoutes() {
        server.Post("/api/stream/ticket",
                    [this](const httplib::Request& req, httplib::Response& res) {
                        if (!streamingAvailable()) {
                            respond(res, 503, errorDocument(kNoStreaming));
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
            respond(res, 200,
                    streamListenersDocument(audience.roster(std::chrono::steady_clock::now()),
                                            audience.connections(), settings.maxConcurrentStreams,
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
                respond(res, 503, errorDocument(kNoStreaming));
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
                [session, held = std::move(membership)](size_t, httplib::DataSink& sink) {
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
    // was asked for, and let the client poll GET /library. A set already declared is already
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

    void addLibraryRoutes() {
        server.Get(kLibraryPath, [this](const httplib::Request& req, httplib::Response& res) {
            if (!library) {
                respond(res, 503, errorDocument(kNoLibrary));
                return;
            }

            const auto state = library->state();
            sendIfChanged(req, res, generationsOf(state), "application/json",
                          [&state] { return libraryDocument(state); });
        });

        server.Get(kLibraryExportPath, [this](const httplib::Request& req, httplib::Response& res) {
            const auto asked = columnsAsked(req);
            const auto request = asked.empty()
                                     ? missing(LibraryRefusal::badColumn, "'columns' is required")
                                     : parseLibraryRequest(asked, std::string());

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
    }

    bool fetchingArtworkTooFast(httplib::Response& res) {
        if (artworkReads.allow(std::chrono::steady_clock::now()))
            return false;

        res.set_header("Retry-After", "1");
        respond(res, 429, errorDocument(kFetchingArtworkTooFast));
        return true;
    }

    static void sendArtwork(const httplib::Request& req, httplib::Response& res,
                            const ArtworkSource& source) {
        if (alreadyHolds(req, source.tag)) {
            revalidateAlways(res, source.tag);
            res.status = 304;
            return;
        }

        if (source.picture.size() > kMaxArtworkBytes) {
            respond(res, 413, errorDocument(kArtworkTooLarge));
            return;
        }

        const auto type = imageTypeOf(source.picture);
        if (type.empty()) {
            respond(res, 404, errorDocument(kUnpublishableArtwork));
            return;
        }

        revalidateAlways(res, source.tag);
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
            if (source.picture.empty()) {
                respond(res, 404, errorDocument(kNoArtworkForTrack));
                return;
            }

            sendArtwork(req, res, source);
        });
    }

    void addTagRoutes() {
        server.Post("/api/tags", [this](const httplib::Request& req, httplib::Response& res) {
            const auto request = parseTagWrite(req.body, settings);
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
    // from a route addressing one of the component's own two playlists -- those stay writable in
    // both states.
    bool writesRefused(httplib::Response& res) {
        if (settings.writePlaylists)
            return false;

        respond(res, httpStatusFor(PlaylistOutcome::writesDisabled),
                playlistFailedDocument(playlistFailure(PlaylistOutcome::writesDisabled)));
        return true;
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

            const auto created = attempt(res, request, [this, &request] {
                return askIfAvailable(player.createAutoPlaylist,
                                      playlistFailure(PlaylistOutcome::unavailable), request.spec);
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
            if (!library) {
                respond(res, 503, errorDocument(kNoLibrary));
                return;
            }

            const auto role = ownPlaylistRoleFor(req.matches[1].str());
            if (!role) {
                respond(res, 400, fillRefusedDocument(PlaylistRefusal::malformedBody));
                return;
            }

            auto request =
                refuseFillChange(parseFill(req.body, library->state().trackCount, true));
            if (!request.ok()) {
                if (request.refusal == PlaylistRefusal::tooFast)
                    res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            const auto title = ownFillTitle(req.body);
            if (!title.ok()) {
                respond(res, httpStatusFor(title.refusal), fillRefusedDocument(title.refusal));
                return;
            }

            const auto resolved = player.ownPlaylist(*role, title.value);
            if (resolved.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(resolved.outcome),
                        playlistFailedDocument(playlistFailure(resolved.outcome)));
                return;
            }

            const auto filled =
                player.fill(resolved.playlist.id, request.structure, request.ordinals,
                            *role == OwnPlaylistRole::scratch);
            if (filled.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(filled.outcome),
                        playlistFailedDocument(playlistFailure(filled.outcome)));
                return;
            }

            // The annotation the role already resolved, rather than filled.beefwebId: this
            // route holds its own answer and has no reason to prefer a second one.
            respond(res, 200,
                    fillResultDocument(resolved.playlist.id, resolved.playlist.beefwebId,
                                       filled.positions));
        });

        server.Delete(kOwnItems, [this](const httplib::Request& req, httplib::Response& res) {
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

            const auto emptied = askIfAvailable(
                player.emptyOwnPlaylist, playlistFailure(PlaylistOutcome::unavailable), *role);
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

            const auto id = req.matches[1].str();
            if (!isPlaylistId(id)) {
                respond(res, 400, fillRefusedDocument(PlaylistRefusal::badId));
                return;
            }

            auto request = refuseFillChange(parseFill(req.body, library->state().trackCount));
            if (!request.ok()) {
                if (request.refusal == PlaylistRefusal::tooFast)
                    res.set_header("Retry-After", "1");
                respond(res, httpStatusFor(request.refusal), fillRefusedDocument(request.refusal));
                return;
            }

            const auto filled = player.fill(id, request.structure, request.ordinals, false);
            if (filled.outcome != PlaylistOutcome::done) {
                respond(res, httpStatusFor(filled.outcome),
                        playlistFailedDocument(playlistFailure(filled.outcome)));
                return;
            }

            respond(res, 200, fillResultDocument(id, filled.beefwebId, filled.positions));
        });
    }

    static AutoPlaylistRequest withId(AutoPlaylistRequest request, const std::string& id) {
        if (request.ok() && !isPlaylistId(id)) {
            request.refusal = PlaylistRefusal::badId;
            request.detail = "the playlist id must be one this component reported";
        }
        return request;
    }
};

HttpServer::HttpServer(Settings settings, Audience& audience, Player player, TicketMint mint,
                       Library* library)
    : impl_(std::make_unique<Impl>(std::move(settings), audience, std::move(player),
                                   std::move(mint), library)) {}

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
        respond(
            res, 200,
            capabilitiesDocument(impl.settings, impl.player.streamFormats,
                                 impl.player.releaseOutput != nullptr, impl.library != nullptr));
    });

    impl.addTagRoutes();
    impl.addPlaylistRoutes();
    impl.addStreamRoutes();
    impl.addLibraryRoutes();
    impl.addArtworkRoute();
    impl.addPairingRoute();

    if (impl.settings.authToken.empty())
        return refused("no authentication token configured; refusing to listen");

    if (!server.bind_to_port(impl.settings.bindAddress, impl.settings.port)) {
        return portTaken("could not bind " + impl.settings.bindAddress + ":" +
                         std::to_string(impl.settings.port) + "; the port is in use");
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

void HttpServer::openPairingWindow() {
    if (impl_)
        impl_->pairing.open(std::chrono::steady_clock::now());
}

void HttpServer::closePairingWindow() {
    if (impl_)
        impl_->pairing.close();
}

HttpServer::PairingState HttpServer::pairingState() const {
    PairingState state;
    if (!impl_)
        return state;

    const auto now = std::chrono::steady_clock::now();
    state.open = impl_->pairing.isOpen(now);
    state.remainingSeconds = static_cast<int>(impl_->pairing.remaining(now).count());
    state.history = impl_->pairing.history();
    return state;
}

void HttpServer::stop() {
    if (!impl_ || impl_->stopping.exchange(true))
        return;

    impl_->server.stop();

    if (impl_->thread.joinable())
        impl_->thread.join();
}

}  // namespace jean
