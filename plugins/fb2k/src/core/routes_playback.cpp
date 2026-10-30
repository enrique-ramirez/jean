#include "core/routes_playback.h"

#include "core/documents.h"
#include "core/http_responses.h"
#include "core/json.h"
#include "core/playback_modes.h"
#include "core/requests_playback.h"
#include "core/requests_playlists.h"
#include "core/session_order.h"
#include "core/session_scope.h"

#include <chrono>
#include <optional>
#include <string>
#include <utility>

namespace jean {

namespace {

// Jean reads the playing track once per track change in each open tab, again when a station
// announces a new song, and a few times more while a track has no lyrics yet. A skip held down
// stays under this; a client stuck in a loop, each read of which evaluates columns it wrote, does
// not.
constexpr int kPlayingTrackBurst = 60;
constexpr auto kPlayingTrackRefill = std::chrono::milliseconds(250);

constexpr char kPlayPlaylistRow[] = R"(/api/playlists/([0-9a-f-]{36})/items/([^/]+)/play)";

void respondUnknownMode(httplib::Response& res, const std::string& mode) {
    respondRefusal(res, PlaybackRefusal::badMode,
                   "'" + mode + "' is not a playback mode this API knows");
}

void commandSession(Session& session, Transport command, Session::Clock::time_point now) {
    switch (command) {
        case Transport::playPause:
            session.playPause(now);
            return;
        case Transport::pause:
            session.pause(now);
            return;
        case Transport::resume:
            session.resume(now);
            return;
        case Transport::next:
            session.next(now);
            return;
        case Transport::previous:
            session.previous(now);
            return;
        case Transport::stop:
            session.stop(now);
            return;
    }
}

void setSessionMode(Session& session, const std::string& mode, httplib::Response& res) {
    const auto order = sessionOrderNamed(mode);
    if (!order) {
        if (playerOrderFor(mode))
            respondError(res, 409, kModeNotOffered);
        else
            respondUnknownMode(res, mode);
        return;
    }

    session.setOrder(*order);
    respondCommand(res, PlayerOutcome::done);
}

}  // namespace

PlaybackRoutes::PlaybackRoutes(const PlaybackCalls& playback, const SessionCalls& sessions,
                               SessionRegistry& registry, const Library* library,
                               const PlayerReport& report, const LiveSettings& settings,
                               const RateLimitClock& clock)
    : playback_(playback),
      sessions_(sessions),
      registry_(registry),
      library_(library),
      report_(report),
      settings_(settings),
      clock_(clock),
      playingTrackReads_(kPlayingTrackBurst, kPlayingTrackRefill, {"playing track reads"}, clock) {}

SessionAnswer PlaybackRoutes::commandedSession(const httplib::Request& req,
                                               httplib::Response& res) {
    return jean::commandedSession(req, res, registry_, clock_(), *settings_.current());
}

void PlaybackRoutes::addTransportRoute(httplib::Server& server, const char* path,
                                       Transport command) {
    server.Post(path, [this, command](const httplib::Request& req, httplib::Response& res) {
        const auto named = commandedSession(req, res);
        if (named.which == SessionAnswer::Which::none)
            return;

        if (named.session) {
            commandSession(*named.session, command, clock_());
            respondCommand(res, PlayerOutcome::done);
            return;
        }

        if (unavailable(playback_.commandTransport, res, kNoPlayback))
            return;

        respondCommand(res, playback_.commandTransport(command));
    });
}

void PlaybackRoutes::seek(const httplib::Request& req, httplib::Response& res) {
    const auto named = commandedSession(req, res);
    if (named.which == SessionAnswer::Which::none)
        return;

    const auto request = parseSeek(parseJsonObject(req.body));
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
        return;
    }

    if (named.session) {
        named.session->seek(request.seconds, request.relative, clock_());
        respondCommand(res, PlayerOutcome::done);
        return;
    }

    if (unavailable(playback_.seek, res, kNoPlayback))
        return;

    respondCommand(res, playback_.seek(request.seconds, request.relative));
}

void PlaybackRoutes::setMode(const httplib::Request& req, httplib::Response& res) {
    const auto named = commandedSession(req, res);
    if (named.which == SessionAnswer::Which::none)
        return;

    const auto request = parsePlaybackMode(parseJsonObject(req.body));
    if (!request.ok()) {
        respondRefusal(res, request.refusal, request.detail);
        return;
    }

    if (named.session) {
        setSessionMode(*named.session, request.mode, res);
        return;
    }

    const auto resolved = resolvePlaybackMode(request.mode, report_.playbackOrders);
    if (resolved.resolution == PlaybackModeResolution::unknownMode) {
        respondUnknownMode(res, request.mode);
        return;
    }

    if (resolved.resolution == PlaybackModeResolution::notOffered) {
        respondError(res, 409, kModeNotOffered);
        return;
    }

    if (unavailable(playback_.setOrder, res, kNoPlayback))
        return;

    respondCommand(res, playback_.setOrder(resolved.index));
}

void PlaybackRoutes::playRow(const httplib::Request& req, httplib::Response& res) {
    const auto named = commandedSession(req, res);
    if (named.which == SessionAnswer::Which::none)
        return;

    const auto request = parsePlayRow(req.matches[1].str(), req.matches[2].str());
    if (!request.ok()) {
        respondRefusal(res, request.refusal);
        return;
    }

    if (named.session) {
        playRowIn(*named.session, request.playlistId, request.index, res);
        return;
    }

    if (unavailable(playback_.playPlaylistRow, res, kNoPlaylistRows))
        return;

    respondCommand(res, playback_.playPlaylistRow(request.playlistId, request.index));
}

void PlaybackRoutes::playRowIn(Session& session, const std::string& playlistId, uint32_t index,
                               httplib::Response& res) {
    if (unavailable(sessions_.takePlaylist, res, kNoPlaylistRows))
        return;

    auto taken = sessions_.takePlaylist(playlistId, std::nullopt);
    if (failed(taken, res))
        return;

    respondCommand(res, session.play(std::move(taken.tracks), index, clock_()));
}

void PlaybackRoutes::playSet(const httplib::Request& req, httplib::Response& res) {
    const auto named = commandedSession(req, res);
    if (named.which == SessionAnswer::Which::none)
        return;

    if (!named.session) {
        respondError(res, 409, kEnginePlaysRows);
        return;
    }

    const auto state = readyLibrary(library_, res);
    if (!state)
        return;

    const auto request =
        parsePlaySet(parseJsonObject(req.body), state->trackCount, state->structure);
    if (request.indexRefused) {
        respondError(res, 400, kBadPlayIndex);
        return;
    }

    if (!request.ok()) {
        respondRequestRefused(res, request);
        return;
    }

    if (unavailable(sessions_.takeLibrary, res, kNoPlayback))
        return;

    auto taken = sessions_.takeLibrary(request.structure, request.ordinals);
    if (failed(taken, res))
        return;

    respondCommand(res, named.session->play(std::move(taken.tracks), request.index, clock_()));
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
                if (unavailable(playback_.setVolume, res, kNoVolume))
                    return;
                respondCommand(res, playback_.setVolume(request.value));
                return;

            case VolumeRequest::Form::step:
                if (unavailable(playback_.stepVolume, res, kNoVolume))
                    return;
                respondCommand(res, playback_.stepVolume(request.step == "up" ? VolumeStep::up
                                                                              : VolumeStep::down));
                return;

            case VolumeRequest::Form::muted:
                if (unavailable(playback_.setMuted, res, kNoVolume))
                    return;
                respondCommand(res, playback_.setMuted(request.muted));
                return;
        }
    });
}

void PlaybackRoutes::addPlayingTrackRoute(httplib::Server& server) {
    server.Get("/api/track/playing", [this](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Cache-Control", kAskEveryTime);

        const auto named = scopedSession(sessionScopeOf(req), res, registry_, clock_());
        if (named.which == SessionAnswer::Which::none)
            return;

        const auto declared = columnsDeclared(req);
        if (!declared.ok()) {
            respondRefusal(res, declared.refusal, declared.detail);
            return;
        }

        if (named.session) {
            readSessionTrack(*named.session, declared.columns, res);
            return;
        }

        if (!playback_.readPlayingTrack) {
            respondError(res, 404, kNothingPlaying);
            return;
        }

        if (tooFast(playingTrackReads_, res, kReadingTracksTooFast))
            return;

        const auto read = playback_.readPlayingTrack(declared.columns);
        if (failed(read, res))
            return;

        if (!read.playing) {
            respondError(res, 404, kNothingPlaying);
            return;
        }

        respond(res, 200, playingTrackDocument(read.path, read.subsong, read.columns));
    });
}

void PlaybackRoutes::readSessionTrack(const Session& session,
                                      const std::vector<std::string>& columns,
                                      httplib::Response& res) {
    if (!sessions_.readTrack) {
        respondError(res, 404, kNothingPlaying);
        return;
    }

    if (tooFast(playingTrackReads_, res, kReadingTracksTooFast))
        return;

    const auto turn = session.turn();
    if (!turn) {
        respondError(res, 404, kNothingPlaying);
        return;
    }

    const auto read = sessions_.readTrack(turn->track, columns);
    if (failed(read, res))
        return;

    respond(res, 200, playingTrackDocument(turn->track.path, turn->track.subsong, read.columns));
}

void PlaybackRoutes::addTo(httplib::Server& server) {
    addTransportRoute(server, "/api/playback/play-pause", Transport::playPause);
    addTransportRoute(server, "/api/playback/pause", Transport::pause);
    addTransportRoute(server, "/api/playback/resume", Transport::resume);
    addTransportRoute(server, "/api/playback/next", Transport::next);
    addTransportRoute(server, "/api/playback/previous", Transport::previous);
    addTransportRoute(server, "/api/playback/stop", Transport::stop);

    server.Post("/api/playback/seek",
                [this](const httplib::Request& req, httplib::Response& res) { seek(req, res); });

    server.Post("/api/playback/mode",
                [this](const httplib::Request& req, httplib::Response& res) { setMode(req, res); });

    addVolumeRoute(server);

    server.Post(kPlayPlaylistRow,
                [this](const httplib::Request& req, httplib::Response& res) { playRow(req, res); });

    server.Post("/api/playback/play",
                [this](const httplib::Request& req, httplib::Response& res) { playSet(req, res); });

    addPlayingTrackRoute(server);
}

}  // namespace jean
