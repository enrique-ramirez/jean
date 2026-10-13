#include "core/routes_stream.h"

#include "core/device.h"
#include "core/documents.h"
#include "core/http_responses.h"
#include "core/session_scope.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace jean {

namespace {

constexpr size_t kMaxOutstandingTickets = 16;

void denyCachingAndRanges(httplib::Response& res) {
    res.set_header("Cache-Control", "no-store");
    res.set_header("Accept-Ranges", "none");
}

}  // namespace

StreamRoutes::StreamRoutes(const StreamCalls& stream, Audience& audience, SessionRegistry& registry,
                           const LiveSettings& settings, TicketMint mint, RateLimitClock clock)
    : stream_(stream),
      audience_(audience),
      registry_(registry),
      settings_(settings),
      clock_(std::move(clock)),
      tickets_(std::move(mint), std::chrono::seconds(settings.current()->streamTicketTtlSeconds),
               kMaxOutstandingTickets) {}

bool StreamRoutes::streamingAvailable() const {
    return stream_.open && !stream_.formats.empty() && settings_.current()->streamingEnabled;
}

const char* StreamRoutes::streamingRefusal() const {
    return settings_.current()->streamingEnabled ? kNoStreaming : kStreamingDisabled;
}

void StreamRoutes::addTo(httplib::Server& server) {
    server.Post("/api/stream/ticket", [this](const httplib::Request& req, httplib::Response& res) {
        issueTicket(req, res);
    });

    server.Get("/api/stream/listeners", [this](const httplib::Request& req,
                                               httplib::Response& res) { listeners(req, res); });

    server.Delete("/api/stream/hold", [this](const httplib::Request&, httplib::Response& res) {
        if (!stream_.releaseOutput) {
            respondUnavailable(res, "this install does not mute the player");
            return;
        }

        stream_.releaseOutput();
        res.status = 204;
    });

    server.Post("/api/stream/leave",
                [this](const httplib::Request& req, httplib::Response& res) { leave(req, res); });

    server.Get("/api/stream/timeline", [this](const httplib::Request& req, httplib::Response& res) {
        if (!stream_.readTimeline) {
            respondUnavailable(res, kNoStreaming);
            return;
        }

        const auto named = scopedSession(sessionScopeOf(req), res, registry_, clock_());
        if (named.which == SessionAnswer::Which::none)
            return;

        const auto timeline = named.session ? named.session->timeline() : stream_.readTimeline();
        if (named.session && timeline.empty()) {
            respondUnavailable(res, kNoStreaming);
            return;
        }

        denyCachingAndRanges(res);
        respond(res, 200, timeline);
    });

    server.Get("/api/stream", [this](const httplib::Request& req, httplib::Response& res) {
        openStream(req, res);
    });
}

void StreamRoutes::issueTicket(const httplib::Request& req, httplib::Response& res) {
    if (!streamingAvailable()) {
        respondUnavailable(res, streamingRefusal());
        return;
    }

    DeviceIdentity device;
    if (!req.body.empty() && !readDeviceIdentity(req, res, device))
        return;

    const SessionScope scope{req.get_param_value("session"), sanitised(device).id};
    const auto named = scopedSession(scope, res, registry_, clock_(), Naming::joining);
    if (named.which == SessionAnswer::Which::none)
        return;

    const auto issued =
        tickets_.issue(clock_(), device, named.session ? named.session->id() : std::string());
    if (issued.ticket.empty()) {
        respondUnavailable(res, "could not generate a stream ticket");
        return;
    }

    respond(res, 200,
            streamTicketDocument(issued.ticket, static_cast<int>(issued.expiresIn.count())));
}

void StreamRoutes::listeners(const httplib::Request& req, httplib::Response& res) {
    const auto named = scopedSession(sessionScopeOf(req), res, registry_, clock_());
    if (named.which == SessionAnswer::Which::none)
        return;

    denyCachingAndRanges(res);
    const Audience& audience = named.session ? named.session->audience() : audience_;
    const auto settings = settings_.current();
    respond(res, 200,
            streamListenersDocument(audience.roster(audience.now()), audience.connections(),
                                    settings->maxConcurrentStreams,
                                    stream_.outputHeld && stream_.outputHeld()));
}

void StreamRoutes::leave(const httplib::Request& req, httplib::Response& res) {
    DeviceIdentity device;
    if (!readDeviceIdentity(req, res, device))
        return;

    if (device.id.empty()) {
        respondError(res, 400, "deviceId is required");
        return;
    }

    const SessionScope scope{req.get_param_value("session"), sanitised(device).id};
    const auto now = clock_();
    const auto named = scopedSession(scope, res, registry_, now);
    if (named.which == SessionAnswer::Which::none)
        return;

    if (!named.session) {
        audience_.leave(device.id);
        res.status = 204;
        return;
    }

    if (registry_.leave(scope.session, scope.deviceId, now) != SessionAnswer::Which::detached) {
        respondUnknownSession(res);
        return;
    }

    res.status = 204;
}

void StreamRoutes::openStream(const httplib::Request& req, httplib::Response& res) {
    const auto admission = tickets_.admits(req.get_param_value("ticket"), clock_());
    if (!admission) {
        respondError(res, 401, "a valid stream ticket is required");
        return;
    }

    if (!streamingAvailable()) {
        respondUnavailable(res, streamingRefusal());
        return;
    }

    const auto format =
        req.has_param("format") ? req.get_param_value("format") : stream_.formats.front();

    if (std::find(stream_.formats.begin(), stream_.formats.end(), format) ==
        stream_.formats.end()) {
        respondError(res, 400,
                     "this install does not encode '" + format +
                         "'; GET /api/capabilities lists what it does");
        return;
    }

    const SessionScope scope{admission.session, admission.device.id};
    const auto named = scopedSession(scope, res, registry_, clock_());
    if (named.which == SessionAnswer::Which::none)
        return;

    const auto& session = named.session;
    auto membership = session ? session->listen(admission.device, format, session->audience().now())
                              : audience_.join(admission.device, format, audience_.now());

    // A session reaped or left between the lookup and the listen refuses it as the cap does, and
    // the registry drops a session in the same step that closes it.
    if (!membership && session &&
        scopedSession(scope, res, registry_, clock_()).which == SessionAnswer::Which::none)
        return;

    if (!membership) {
        respondUnavailable(res,
                           "this component is already serving as many streams as it is "
                           "configured to");
        return;
    }

    auto opened = session ? session->open(format) : stream_.open(format);
    if (!opened.listener) {
        respondUnavailable(res, kNoStreaming);
        return;
    }

    denyCachingAndRanges(res);

    const std::shared_ptr<StreamListener> listener(std::move(opened.listener));

    // Kept out of the compressor by cpp-httplib's content-type gate, which third_party/README.md
    // has, and not by anything here.
    res.set_chunked_content_provider(
        opened.contentType,
        [this, listener, held = std::move(membership), bytes = std::vector<std::uint8_t>()](
            size_t, httplib::DataSink& sink) mutable {
            if (!settings_.current()->streamingEnabled) {
                sink.done();
                return true;
            }

            if (!listener->next(bytes)) {
                sink.done();
                return true;
            }

            // cpp-httplib's is_writable() is the only way to notice a listener gone mid-pause,
            // when no audio is arriving to fail a write against.
            if (bytes.empty())
                return sink.is_writable();

            sink.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
            return true;
        });
}

}  // namespace jean
