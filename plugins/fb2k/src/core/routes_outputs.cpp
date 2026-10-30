#include "core/routes_outputs.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/requests_playback.h"

#include <algorithm>

namespace jean {

OutputRoutes::OutputRoutes(const OutputCalls& outputs, const LiveSettings& settings)
    : outputs_(outputs), settings_(settings) {}

void OutputRoutes::setActive(const httplib::Request& req, httplib::Response& res) {
    res.set_header("Cache-Control", kAskEveryTime);

    if (outputChangeRefused(*settings_.current(), res))
        return;

    const auto request = parseActiveOutput(parseJsonObject(req.body));
    if (!request.ok) {
        respond(res, 400, activeOutputRefusedDocument(request.detail));
        return;
    }

    if (!outputs_.list || !outputs_.setActive) {
        respondUnavailable(res, kNoOutputs);
        return;
    }

    const auto read = outputs_.list();
    if (failed(read, res))
        return;

    const auto listed = std::any_of(
        read.devices.begin(), read.devices.end(),
        [&request](const OutputDevice& device) { return device.id == request.deviceId; });
    if (!listed) {
        respondOutcome(res, PlayerOutcome::notListed);
        return;
    }

    respondCommand(res, outputs_.setActive(request.deviceId));
}

void OutputRoutes::addTo(httplib::Server& server) {
    server.Get("/api/outputs", [this](const httplib::Request&, httplib::Response& res) {
        res.set_header("Cache-Control", kAskEveryTime);

        if (unavailable(outputs_.list, res, kNoOutputs))
            return;

        const auto read = outputs_.list();
        if (failed(read, res))
            return;

        respond(res, 200, outputsDocument(read));
    });

    server.Post("/api/outputs/active", [this](const httplib::Request& req, httplib::Response& res) {
        setActive(req, res);
    });
}

}  // namespace jean
