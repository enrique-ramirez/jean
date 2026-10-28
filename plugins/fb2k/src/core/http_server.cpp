#include "third_party/httplib.h"

#include "core/admission.h"
#include "core/connection_threads.h"
#include "core/http_responses.h"
#include "core/http_server.h"
#include "core/log.h"
#include "core/routes_artwork.h"
#include "core/routes_autoplaylists.h"
#include "core/routes_docs.h"
#include "core/routes_library.h"
#include "core/routes_outputs.h"
#include "core/routes_own_playlists.h"
#include "core/routes_page.h"
#include "core/routes_playback.h"
#include "core/routes_playlist_rows.h"
#include "core/routes_playlists.h"
#include "core/routes_queue.h"
#include "core/routes_sessions.h"
#include "core/routes_state.h"
#include "core/routes_stream.h"
#include "core/session_registry.h"
#include "core/text.h"

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstddef>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <system_error>
#include <thread>
#include <vector>

#ifndef _WIN32
#include <ifaddrs.h>
#endif

namespace jean {

namespace {

constexpr int kPlaylistBurst = 30;
constexpr auto kPlaylistRefill = std::chrono::seconds(1);

constexpr char kApiPrefix[] = "/api/";

bool isApiPath(const std::string& path) {
    return path.rfind(kApiPrefix, 0) == 0;
}

bool isJsonRequest(const httplib::Request& req) {
    return toLower(req.get_header_value("Content-Type")).rfind("application/json", 0) == 0;
}

uint64_t freshRunId() {
    std::random_device source;
    return (uint64_t{source()} << 32U) | source();
}

SessionRandom sessionRandom() {
    struct Shared {
        std::mutex lock;
        std::mt19937 draws{std::random_device{}()};
    };

    const auto shared = std::make_shared<Shared>();
    return [shared](size_t bound) {
        std::uniform_int_distribution<size_t> below(0, bound - 1);
        const std::lock_guard<std::mutex> held(shared->lock);
        return below(shared->draws);
    };
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
// Windows lets a second socket bind a port this one is already listening on, so there losing the
// option costs more than a retry after a restart. macOS is not exclusive either, but nothing a
// listener sets closes it: a port held on the wildcard address there still admits another
// program that binds one of the machine's addresses on it with SO_REUSEADDR, and that program
// takes the connections to that address.
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

constexpr char kWildcardAddress[] = "0.0.0.0";

std::optional<sockaddr_in> ipv4Address(const std::string& address, int port) {
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<uint16_t>(port));
    if (inet_pton(AF_INET, address.c_str(), &addr.sin_addr) != 1)
        return std::nullopt;

    return addr;
}

// The probe sets the listener's own address option first: on Windows a plain bind of the wildcard
// address succeeds beside a socket holding one address, which SO_EXCLUSIVEADDRUSE refuses.
std::optional<int> probeBind(const sockaddr_in& addr) {
#ifdef _WIN32
    const SOCKET probe = ::socket(AF_INET, SOCK_STREAM, 0);
    if (probe == INVALID_SOCKET)
        return std::nullopt;
    static_cast<void>(setAddressOption(probe));
    const bool bound = ::bind(probe, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr)) == 0;
    const int code = bound ? 0 : lastSocketError();
    closesocket(probe);
#else
    const int probe = ::socket(AF_INET, SOCK_STREAM, 0);
    if (probe < 0)
        return std::nullopt;
    static_cast<void>(setAddressOption(probe));
    const bool bound = ::bind(probe, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr)) == 0;
    const int code = bound ? 0 : lastSocketError();
    ::close(probe);
#endif
    return code;
}

struct BindDiagnosis {
    bool inUse = false;
    std::string osError;
};

// cpp-httplib's own bind_to_port() reports only pass or fail, so a socket of our own binds the
// same address right after a failure to read the error that decided it. Nullopt where the probe
// itself cannot say anything: an address inet_pton cannot parse, a probe socket this process
// could not open, or a probe that raced past whatever refused the real attempt and bound fine.
std::optional<BindDiagnosis> diagnoseBindFailure(const std::string& bindAddress, int port) {
    const auto addr = ipv4Address(bindAddress, port);
    if (!addr)
        return std::nullopt;

    const auto code = probeBind(*addr);
    if (!code || *code == 0)
        return std::nullopt;

    BindDiagnosis diagnosis;
    diagnosis.inUse = socketErrorMeansAddressInUse(*code);
    diagnosis.osError = std::error_code(*code, std::system_category()).message();
    return diagnosis;
}

struct PortSharing {
    bool shared = false;
    std::vector<std::string> held;
};

#ifdef _WIN32
PortSharing inspectWildcardPort(int /*port*/) {
    return {};
}
#else
std::vector<std::string> localIpv4Addresses() {
    ifaddrs* list = nullptr;
    if (getifaddrs(&list) != 0)
        return {};
    const std::unique_ptr<ifaddrs, decltype(&freeifaddrs)> owned(list, freeifaddrs);

    std::vector<std::string> addresses;
    for (const ifaddrs* entry = list; entry != nullptr; entry = entry->ifa_next) {
        if (entry->ifa_addr == nullptr || entry->ifa_addr->sa_family != AF_INET)
            continue;

        char text[INET_ADDRSTRLEN] = {};
        const auto* inet = reinterpret_cast<const sockaddr_in*>(entry->ifa_addr);
        if (inet_ntop(AF_INET, &inet->sin_addr, text, sizeof(text)) == nullptr)
            continue;

        if (std::find(addresses.begin(), addresses.end(), text) == addresses.end())
            addresses.emplace_back(text);
    }

    return addresses;
}

// Measured on a listener of our own at a port the operating system chooses, so the answer is the
// platform's and does not depend on who holds the real port: a platform that refuses a second
// bind to a listening port refuses every address, which a held address cannot be told from.
bool wildcardListenerAdmitsOthers(const std::string& address) {
    const int listener = ::socket(AF_INET, SOCK_STREAM, 0);
    if (listener < 0)
        return false;

    bool admitted = false;
    const int on = 1;
    sockaddr_in any{};
    any.sin_family = AF_INET;
    any.sin_addr.s_addr = htonl(INADDR_ANY);
    socklen_t length = sizeof(any);
    if (setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on)) == 0 &&
        ::bind(listener, reinterpret_cast<const sockaddr*>(&any), sizeof(any)) == 0 &&
        ::listen(listener, 1) == 0 &&
        ::getsockname(listener, reinterpret_cast<sockaddr*>(&any), &length) == 0) {
        const auto probed = ipv4Address(address, ntohs(any.sin_port));
        const auto code = probed ? probeBind(*probed) : std::nullopt;
        admitted = code && *code == 0;
    }

    ::close(listener);
    return admitted;
}

PortSharing inspectWildcardPort(int port) {
    PortSharing sharing;
    const auto addresses = localIpv4Addresses();
    if (addresses.empty() || !wildcardListenerAdmitsOthers(addresses.front()))
        return sharing;

    sharing.shared = true;
    for (const auto& address : addresses) {
        const auto probed = ipv4Address(address, port);
        const auto code = probed ? probeBind(*probed) : std::nullopt;
        if (code && socketErrorMeansAddressInUse(*code))
            sharing.held.push_back(address);
    }

    return sharing;
}
#endif

ListenerStatus bindFailure(const Settings& settings) {
    const std::string address = settings.bindAddress + ":" + std::to_string(settings.port);
    const auto diagnosis = diagnoseBindFailure(settings.bindAddress, settings.port);

    if (diagnosis && diagnosis->inUse)
        return portTaken("could not bind " + address + "; the port is in use");

    if (diagnosis) {
        return refused("could not bind " + address +
                       "; that address is not one this machine holds (" + diagnosis->osError + ")");
    }

    return refused("could not bind " + address +
                   "; the port may already be in use, or that address may not be one this "
                   "machine holds");
}

void applyLimits(httplib::Server& server) {
    server.set_read_timeout(10, 0);
    server.set_write_timeout(10, 0);
    server.set_payload_max_length(kMaxBodyBytes);

    server.new_task_queue = [] {
        return new ConnectionThreads(connectionPoolFor(std::thread::hardware_concurrency()),
                                     std::chrono::seconds(CPPHTTPLIB_THREAD_POOL_IDLE_TIMEOUT));
    };
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

        respondError(res, res.status, reasonFor(res.status));
        return Routing::Handled;
    });
}

void reportFailuresWithoutLeaking(httplib::Server& server) {
    server.set_exception_handler(
        [](const httplib::Request&, httplib::Response& res, const std::exception_ptr& thrown) {
            try {
                std::rethrow_exception(thrown);
            } catch (const std::exception& e) {
                logError(std::string("request handler threw: ") + e.what());
            } catch (...) {
                logError("request handler threw an unknown exception");
            }

            respondError(res, 500, "internal error");
        });
}

}  // namespace

std::string heldAddressError(const std::vector<std::string>& heldAddresses, int port) {
    if (heldAddresses.empty())
        return {};

    std::string list;
    for (const auto& address : heldAddresses)
        list += (list.empty() ? "" : ", ") + address;

    return "another program already holds port " + std::to_string(port) + " at " + list +
           ", so connections to " + (heldAddresses.size() == 1 ? "it" : "them") +
           " never reach Jean. Set bindAddress to one address that nobody else holds to have the "
           "port to itself";
}

std::string sharedPortNotice(int port) {
    return "another program on this machine can take port " + std::to_string(port) +
           " at an IPv4 address of its own; set bindAddress to one address to close that";
}

ConnectionPool connectionPoolFor(unsigned hardwareThreads) {
    constexpr size_t kFewestThreads = 8;
    constexpr size_t kGrowth = 4;

    ConnectionPool pool;
    pool.threads = std::max<size_t>(kFewestThreads, hardwareThreads > 0 ? hardwareThreads - 1 : 0);
    pool.maxThreads = pool.threads * kGrowth;
    pool.queued = pool.maxThreads;
    return pool;
}

LiveSettings::LiveSettings(Settings settings)
    : current_(std::make_shared<const Settings>(std::move(settings))) {}

std::shared_ptr<const Settings> LiveSettings::current() const {
    const std::lock_guard<std::mutex> lock(lock_);
    return current_;
}

void LiveSettings::replace(Settings next) {
    auto replacement = std::make_shared<const Settings>(std::move(next));
    const std::lock_guard<std::mutex> lock(lock_);
    current_ = std::move(replacement);
}

// Members are destroyed in reverse order: `server` holds handlers that call into the route
// objects, and the route objects hold references into everything declared above them.
struct HttpServer::Impl {
    Impl(Settings s, Audience& audience, Player p, TicketMint mint, Library* lib,
         PlayerStateStore* state, NowPlayingArtwork* playing, const RateLimitClock& clock)
        : settings(std::move(s)),
          player(std::move(p)),
          library(lib),
          playlistChanges(kPlaylistBurst, kPlaylistRefill,
                          "refusing playlist changes: they are arriving faster than this "
                          "component will make them, which usually means a client is looping",
                          clock),
          sessionCapacity{player.sessions.start != nullptr, settings.current()->maxSessions},
          sessions(audience, sessionCapacity.maxSessions, mint, sessionRandom(),
                   player.sessions.start),
          page(player.page),
          docsRoutes(player.page),
          libraryRoutes(player.library, lib, settings, runId, clock),
          stateRoute(lib, state, configGeneration, runId, clock, player.checkMainThread,
                     player.sessions, sessions),
          artworkRoutes(player.library, player.playlists, player.sessions, sessions, playing,
                        clock),
          playlistRoutes(player.playlists, lib, settings, playlistChanges),
          playlistRowRoutes(player.playlists, lib, settings, playlistChanges, libraryRoutes, clock),
          ownPlaylistRoutes(player.playlists, lib, settings, playlistChanges),
          autoPlaylistRoutes(player.autoPlaylists, settings, playlistChanges, clock),
          queueRoutes(player.queue, player.sessions, sessions, lib, libraryRoutes.questions(),
                      state, settings, playlistChanges, clock),
          playbackRoutes(player.playback, player.sessions, sessions, lib, player.report, settings,
                         clock),
          outputRoutes(player.outputs, settings),
          streamRoutes(player.stream, audience, sessions, settings, std::move(mint), clock),
          sessionRoutes(sessions, audience, player.report, state, player.sessions, settings,
                        player.stream.formats, sessionCapacity, clock) {}

    LiveSettings settings;
    std::atomic<uint64_t> configGeneration{0};

    const Player player;
    const Library* const library;
    const uint64_t runId = freshRunId();

    Throttle playlistChanges;

    const SessionCapacity sessionCapacity;

    // Declared before streamRoutes, whose initialiser moves the mint this copies.
    SessionRegistry sessions;

    PageRoutes page;
    DocsRoutes docsRoutes;
    LibraryRoutes libraryRoutes;
    StateRoute stateRoute;
    ArtworkRoutes artworkRoutes;
    PlaylistRoutes playlistRoutes;
    PlaylistRowRoutes playlistRowRoutes;
    OwnPlaylistRoutes ownPlaylistRoutes;
    AutoPlaylistRoutes autoPlaylistRoutes;
    QueueRoutes queueRoutes;
    PlaybackRoutes playbackRoutes;
    OutputRoutes outputRoutes;
    StreamRoutes streamRoutes;
    SessionRoutes sessionRoutes;

    httplib::Server server;
    std::thread thread;
    std::atomic<bool> stopping{false};
    std::atomic<bool> addressOptionRefused{false};

    void applyReload(const ReloadDecision& decision) {
        settings.replace(decision.next);

        const auto movesGeneration = std::any_of(
            decision.changedKeys.begin(), decision.changedKeys.end(), [](const std::string& key) {
                return key != "allowedHosts" && key != "allowedOrigins";
            });
        if (movesGeneration)
            configGeneration.fetch_add(1, std::memory_order_release);
    }

    bool originAllowed(const std::string& origin) const {
        if (origin.empty())
            return false;

        const auto current = settings.current();
        return std::any_of(current->allowedOrigins.begin(), current->allowedOrigins.end(),
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

    httplib::Server::HandlerResponse filter(const httplib::Request& req,
                                            httplib::Response& res) const {
        using Routing = httplib::Server::HandlerResponse;

        const bool api = isApiPath(req.path);
        if (api)
            res.set_header("Cross-Origin-Resource-Policy", "same-origin");

        const auto admission =
            admit(req.remote_addr, req.get_header_value("Host"), settings.current()->allowedHosts);
        if (!admission.admitted) {
            if (api) {
                respondError(res, 403, admission.refusal);
            } else {
                res.status = 403;
                res.set_content(admission.refusal, "text/plain");
            }
            return Routing::Handled;
        }

        if (api) {
            const auto site = admitFetchSite(req.get_header_value("Sec-Fetch-Site"),
                                             originAllowed(req.get_header_value("Origin")));
            if (!site.admitted) {
                respondError(res, 403, site.refusal);
                return Routing::Handled;
            }
        }

        applyCors(req, res);
        res.set_header("X-Content-Type-Options", "nosniff");

        if (req.method == "OPTIONS") {
            res.status = 204;
            return Routing::Handled;
        }

        if (player.page.read && !api) {
            if (req.method == "GET" || req.method == "HEAD") {
                page.serve(req, res);
                return Routing::Handled;
            }

            return Routing::Unhandled;
        }

        if (req.method == "POST" && api && !isJsonRequest(req)) {
            respondError(res, 415, kSendJson);
            return Routing::Handled;
        }

        return Routing::Unhandled;
    }

    void addRoutes() {
        server.Get("/api/status", [](const httplib::Request&, httplib::Response& res) {
            respond(res, 200, statusDocument());
        });

        server.Get("/api/capabilities", [this](const httplib::Request&, httplib::Response& res) {
            respond(res, 200,
                    capabilitiesDocument(*settings.current(), player.report, player.stream.formats,
                                         player.stream.releaseOutput != nullptr, library != nullptr,
                                         sessionCapacity));
        });

        libraryRoutes.addTo(server);
        playlistRoutes.addTo(server);
        playlistRowRoutes.addTo(server);
        ownPlaylistRoutes.addTo(server);
        autoPlaylistRoutes.addTo(server);
        queueRoutes.addTo(server);
        playbackRoutes.addTo(server);
        outputRoutes.addTo(server);
        streamRoutes.addTo(server);
        sessionRoutes.addTo(server);
        stateRoute.addTo(server);
        artworkRoutes.addTo(server);
        docsRoutes.addTo(server);
    }
};

HttpServer::HttpServer(Settings settings, Audience& audience, Player player, TicketMint mint,
                       Library* library, PlayerStateStore* playerState,
                       NowPlayingArtwork* nowPlayingArtwork, const RateLimitClock& rateLimitClock)
    : impl_(std::make_unique<Impl>(std::move(settings), audience, std::move(player),
                                   std::move(mint), library, playerState, nowPlayingArtwork,
                                   rateLimitClock)) {}

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

    impl.addRoutes();

    const auto startupSettings = impl.settings.current();
    if (!server.bind_to_port(startupSettings->bindAddress, startupSettings->port))
        return bindFailure(*startupSettings);

    if (impl.addressOptionRefused) {
        const std::string what = std::string("the listening socket refused ") + kAddressOptionName;
        if constexpr (kAddressOptionIsMandatory) {
            server.stop();
            return refused(what +
                           "; another socket could bind this port and take half its traffic");
        } else {
            logError(what + "; a restart may have to wait for the port");
        }
    }

    auto status = listening();
    if (startupSettings->bindAddress == kWildcardAddress) {
        const auto sharing = inspectWildcardPort(startupSettings->port);
        status.portIsShared = sharing.shared;
        status.heldAddresses = sharing.held;
    }

    impl.thread = std::thread([&impl] { impl.server.listen_after_bind(); });

    return status;
}

void HttpServer::stop() {
    if (!impl_ || impl_->stopping.exchange(true))
        return;

    // A session's listeners hold connection threads until its stream stops, so the sessions close
    // before the join below waits for those threads.
    impl_->sessions.close();
    impl_->server.stop();

    if (impl_->thread.joinable())
        impl_->thread.join();
}

void HttpServer::applyReload(const ReloadDecision& decision) {
    impl_->applyReload(decision);
}

}  // namespace jean
