#include "core/routes_playback.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/playback_modes.h"
#include "core/requests_playback.h"
#include "core/requests_playlists.h"

#include <chrono>
#include <string>

namespace jean {

namespace {

// Jean reads the playing track once per track change in each open tab, again when a station
// announces a new song, and a few times more while a track has no lyrics yet. A skip held down
// stays under this; a client stuck in a loop, each read of which evaluates columns it wrote, does
// not.
constexpr int kPlayingTrackBurst = 60;
constexpr auto kPlayingTrackRefill = std::chrono::milliseconds(250);

constexpr char kPlayPlaylistRow[] = R"(/api/playlists/([0-9a-f-]{36})/items/([^/]+)/play)";

}  // namespace

PlaybackRoutes::PlaybackRoutes(const PlaybackCalls& playback, const PlayerReport& report,
                               const LiveSettings& settings, const RateLimitClock& clock)
    : playback_(playback),
      report_(report),
      settings_(settings),
      playingTrackReads_(kPlayingTrackBurst, kPlayingTrackRefill,
                         "refusing playing track reads: they are arriving faster than this "
                         "component will answer them, which usually means a client is looping",
                         clock) {}

bool PlaybackRoutes::readingPlayingTrackTooFast(httplib::Response& res) {
    if (!playingTrackReads_.refuses())
        return false;

    respondTooFast(res, playingTrackReads_, errorDocument(kReadingTracksTooFast));
    return true;
}

void PlaybackRoutes::addTransportRoute(httplib::Server& server, const char* path,
                                       Transport command) {
    server.Post(path, [this, command](const httplib::Request&, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        if (!playback_.commandTransport) {
            respondUnavailable(res, kNoPlayback);
            return;
        }

        respondCommand(res, playback_.commandTransport(command));
    });
}

void PlaybackRoutes::setMode(const httplib::Request& req, httplib::Response& res) {
    if (playbackRefused(*settings_.current(), res))
        return;

    const auto request = parsePlaybackMode(parseJsonObject(req.body));
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
        return;
    }

    const auto resolved = resolvePlaybackMode(request.mode, report_.playbackOrders);
    if (resolved.resolution == PlaybackModeResolution::unknownMode) {
        respondRefusal(res, PlaybackRefusal::badMode,
                       "'" + request.mode + "' is not a playback mode this API knows");
        return;
    }

    if (resolved.resolution == PlaybackModeResolution::notOffered) {
        respondError(res, 409, kModeNotOffered);
        return;
    }

    if (!playback_.setOrder) {
        respondUnavailable(res, kNoPlayback);
        return;
    }

    respondCommand(res, playback_.setOrder(resolved.index));
}

void PlaybackRoutes::addVolumeRoute(httplib::Server& server) {
    server.Post("/api/volume", [this](const httplib::Request& req, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        const auto request =
            parseVolume(parseJsonObject(req.body), report_.volumeMin, report_.volumeMax);
        if (!request.ok()) {
            respondRefusal(res, request.refusal, request.detail);
            return;
        }

        switch (request.form) {
            case VolumeRequest::Form::value:
                if (!playback_.setVolume) {
                    respondUnavailable(res, kNoVolume);
                    return;
                }
                respondCommand(res, playback_.setVolume(request.value));
                return;

            case VolumeRequest::Form::step:
                if (!playback_.stepVolume) {
                    respondUnavailable(res, kNoVolume);
                    return;
                }
                respondCommand(res, playback_.stepVolume(request.step == "up" ? VolumeStep::up
                                                                              : VolumeStep::down));
                return;

            case VolumeRequest::Form::muted:
                if (!playback_.setMuted) {
                    respondUnavailable(res, kNoVolume);
                    return;
                }
                respondCommand(res, playback_.setMuted(request.muted));
                return;
        }
    });
}

void PlaybackRoutes::addPlayingTrackRoute(httplib::Server& server) {
    server.Get("/api/track/playing", [this](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Cache-Control", kAskEveryTime);

        const auto declared = columnsDeclared(req);
        if (!declared.ok()) {
            respondRefusal(res, declared.refusal, declared.detail);
            return;
        }

        if (!playback_.readPlayingTrack) {
            respondError(res, 404, kNothingPlaying);
            return;
        }

        if (readingPlayingTrackTooFast(res))
            return;

        const auto read = playback_.readPlayingTrack(declared.columns);
        if (read.outcome != PlayerOutcome::done) {
            respondOutcome(res, read.outcome);
            return;
        }

        if (!read.playing) {
            respondError(res, 404, kNothingPlaying);
            return;
        }

        respond(res, 200, playingTrackDocument(read.path, read.subsong, read.columns));
    });
}

void PlaybackRoutes::addTo(httplib::Server& server) {
    addTransportRoute(server, "/api/playback/play-pause", Transport::playPause);
    addTransportRoute(server, "/api/playback/next", Transport::next);
    addTransportRoute(server, "/api/playback/previous", Transport::previous);
    addTransportRoute(server, "/api/playback/stop", Transport::stop);

    server.Post("/api/playback/seek", [this](const httplib::Request& req, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        const auto request = parseSeek(parseJsonObject(req.body));
        if (!request.ok()) {
            respondRefusal(res, request.refusal, request.detail);
            return;
        }

        if (!playback_.seek) {
            respondUnavailable(res, kNoPlayback);
            return;
        }

        respondCommand(res, playback_.seek(request.seconds, request.relative));
    });

    server.Post("/api/playback/mode",
                [this](const httplib::Request& req, httplib::Response& res) { setMode(req, res); });

    addVolumeRoute(server);

    server.Post(kPlayPlaylistRow, [this](const httplib::Request& req, httplib::Response& res) {
        if (playbackRefused(*settings_.current(), res))
            return;

        const auto request = parsePlayRow(req.matches[1].str(), req.matches[2].str());
        if (!request.ok()) {
            respondRefusal(res, request.refusal);
            return;
        }

        if (!playback_.playPlaylistRow) {
            respondUnavailable(res, kNoPlaylistRows);
            return;
        }

        respondCommand(res, playback_.playPlaylistRow(request.playlistId, request.index));
    });

    addPlayingTrackRoute(server);
}

}  // namespace jean
