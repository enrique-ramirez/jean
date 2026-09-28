#include "core/routes_stream.h"

#include "core/device.h"
#include "core/documents.h"
#include "core/http_responses.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace jean {

namespace {

constexpr size_t kMaxOutstandingTickets = 16;

void denyCachingAndRanges(httplib::Response& res) {
    res.set_header("Cache-Control", "no-store");
    res.set_header("Accept-Ranges", "none");
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

}  // namespace

StreamRoutes::StreamRoutes(const StreamCalls& stream, Audience& audience,
                           const LiveSettings& settings, TicketMint mint)
    : stream_(stream),
      audience_(audience),
      settings_(settings),
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
        if (!streamingAvailable()) {
            respondUnavailable(res, streamingRefusal());
            return;
        }

        DeviceIdentity device;
        if (!req.body.empty() && !readDeviceIdentity(req, res, device))
            return;

        const auto issued = tickets_.issue(std::chrono::steady_clock::now(), device);
        if (issued.ticket.empty()) {
            respondUnavailable(res, "could not generate a stream ticket");
            return;
        }

        respond(res, 200,
                streamTicketDocument(issued.ticket, static_cast<int>(issued.expiresIn.count())));
    });

    server.Get("/api/stream/listeners", [this](const httplib::Request&, httplib::Response& res) {
        denyCachingAndRanges(res);
        const auto settings = settings_.current();
        respond(res, 200,
                streamListenersDocument(audience_.roster(std::chrono::steady_clock::now()),
                                        audience_.connections(), settings->maxConcurrentStreams,
                                        stream_.outputHeld && stream_.outputHeld()));
    });

    server.Delete("/api/stream/hold", [this](const httplib::Request&, httplib::Response& res) {
        if (!stream_.releaseOutput) {
            respondUnavailable(res, "this install does not mute the player");
            return;
        }

        stream_.releaseOutput();
        res.status = 204;
    });

    server.Post("/api/stream/leave", [this](const httplib::Request& req, httplib::Response& res) {
        DeviceIdentity device;
        if (!readDeviceIdentity(req, res, device))
            return;

        if (device.id.empty()) {
            respondError(res, 400, "deviceId is required");
            return;
        }

        audience_.leave(device.id);
        res.status = 204;
    });

    server.Get("/api/stream/timeline", [this](const httplib::Request&, httplib::Response& res) {
        if (!stream_.readTimeline) {
            respondUnavailable(res, kNoStreaming);
            return;
        }

        denyCachingAndRanges(res);
        respond(res, 200, stream_.readTimeline());
    });

    server.Get("/api/stream", [this](const httplib::Request& req, httplib::Response& res) {
        openStream(req, res);
    });
}

void StreamRoutes::openStream(const httplib::Request& req, httplib::Response& res) {
    const auto admission =
        tickets_.admits(req.get_param_value("ticket"), std::chrono::steady_clock::now());
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

    auto membership = audience_.join(admission.device, format, std::chrono::steady_clock::now());
    if (!membership) {
        respondUnavailable(res,
                           "this component is already serving as many streams as it is "
                           "configured to");
        return;
    }

    auto opened = stream_.open(format);
    if (!opened.session) {
        respondUnavailable(res, kNoStreaming);
        return;
    }

    denyCachingAndRanges(res);

    const std::shared_ptr<StreamSession> session(std::move(opened.session));

    // Kept out of the compressor by cpp-httplib's content-type gate, which third_party/README.md
    // has, and not by anything here.
    res.set_chunked_content_provider(
        opened.contentType,
        [this, session, held = std::move(membership)](size_t, httplib::DataSink& sink) {
            if (!settings_.current()->streamingEnabled) {
                sink.done();
                return true;
            }

            std::vector<std::uint8_t> bytes;
            if (!session->next(bytes)) {
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
