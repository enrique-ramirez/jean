#include "core/api.h"

#include "core/version.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <iterator>

using nlohmann::json;

namespace jean {

namespace {

json identity() {
    return json{{"name", kComponentName}, {"version", kVersion}, {"apiVersion", kApiVersion}};
}

json device(const AudienceMember& member) {
    return json{{"deviceId", member.deviceId},
                {"name", member.name.empty() ? json(nullptr) : json(member.name)},
                {"format", member.format},
                {"connections", member.connections},
                {"listeningFor", member.listeningForSeconds}};
}

json timelineMark(const StreamMark& mark) {
    return json{{"at", mark.at},
                {"path", mark.path},
                {"subsong", mark.subsong},
                {"position", mark.position}};
}

json annotation(const PlaylistAnnotation& playlist) {
    json body;
    body["id"] = playlist.id;
    body["beefwebId"] = playlist.beefwebId.empty() ? json(nullptr) : json(playlist.beefwebId);
    body["index"] = playlist.index;
    body["title"] = playlist.title;
    body["isAutoPlaylist"] = playlist.isAutoPlaylist;
    body["managed"] = playlist.managed ? json{{"key", playlist.managed->key},
                                              {"query", playlist.managed->query},
                                              {"sort", playlist.managed->sort},
                                              {"forceSort", playlist.managed->forceSort}}
                                       : json(nullptr);
    return body;
}

}  // namespace

std::string statusDocument() {
    auto body = identity();
    body["authRequired"] = true;
    return body.dump();
}

std::string capabilitiesDocument(const Settings& settings,
                                 const std::vector<std::string>& streamFormats,
                                 bool mutesWhileStreaming) {
    const json body{{"apiVersion", kApiVersion},
                    {"allowedFields", settings.allowedFields},
                    {"canWrite", !settings.allowedFields.empty()},
                    {"maxAutoPlaylists", settings.maxAutoPlaylists},
                    {"canCreateAutoPlaylists", settings.maxAutoPlaylists > 0},
                    {"canStream", !streamFormats.empty()},
                    {"streamFormats", streamFormats},
                    {"canMuteWhileStreaming", mutesWhileStreaming}};
    return body.dump();
}

std::string streamListenersDocument(const std::vector<AudienceMember>& members, int connections,
                                    int maxConnections, bool playerMuted) {
    json devices = json::array();
    std::transform(members.begin(), members.end(), std::back_inserter(devices), device);

    return json{{"devices", std::move(devices)},
                {"connections", connections},
                {"maxConnections", maxConnections},
                {"playerMuted", playerMuted}}
        .dump();
}

std::string pairedDocument(const std::string& token) {
    const json body{{"token", token}, {"apiVersion", kApiVersion}};
    return body.dump();
}

std::string discoveryDocument(const Settings& settings, const ListenerStatus& status) {
    auto body = identity();
    body["port"] = settings.port;
    body["authRequired"] = true;
    body["listening"] = status.listening;

    if (!status.listening) {
        body["error"] = status.error;
        body["portInUse"] = status.portInUse;
    }

    return body.dump(2) + "\n";
}

std::string errorDocument(const std::string& message) {
    return json{{"error", message}}.dump();
}

std::string streamTicketDocument(const std::string& ticket, int expiresInSeconds) {
    return json{{"ticket", ticket}, {"expiresIn", expiresInSeconds}}.dump();
}

std::string streamTimelineDocument(double streamTime, const std::vector<StreamMark>& marks) {
    json entries = json::array();
    std::transform(marks.begin(), marks.end(), std::back_inserter(entries), timelineMark);

    return json{{"streamTime", streamTime}, {"marks", std::move(entries)}}.dump();
}

std::string tagWrittenDocument(const TagWrite& write) {
    json body{{"written", true},
              {"path", write.track.path},
              {"subsong", write.track.subsong},
              {"fields", write.fields}};
    return body.dump();
}

std::string tagRefusedDocument(const TagWriteRequest& request) {
    json body{{"written", false}, {"error", describe(request.refusal)}, {"detail", request.detail}};

    if (request.refusal == TagWriteRefusal::fieldNotAllowed)
        body["field"] = request.detail;

    return body.dump();
}

// No detail beyond the category: error text is a reliable way to leak paths.
std::string tagFailedDocument(TagWriteOutcome outcome) {
    const json body{{"written", false}, {"error", describe(outcome)}};
    return body.dump();
}

int httpStatusFor(TagWriteRefusal refusal) {
    switch (refusal) {
        case TagWriteRefusal::none:
            return 200;
        case TagWriteRefusal::fieldNotAllowed:
            return 403;
        case TagWriteRefusal::malformedBody:
        case TagWriteRefusal::missingPath:
        case TagWriteRefusal::unsafePath:
        case TagWriteRefusal::noFields:
            return 400;
    }
    return 400;
}

std::string playlistsDocument(const std::vector<PlaylistAnnotation>& playlists) {
    json entries = json::array();
    std::transform(playlists.begin(), playlists.end(), std::back_inserter(entries), annotation);

    return json{{"playlists", std::move(entries)}}.dump();
}

std::string playlistDocument(const PlaylistAnnotation& playlist) {
    return annotation(playlist).dump();
}

std::string playlistRemovedDocument(const std::string& id) {
    return json{{"removed", true}, {"id", id}}.dump();
}

std::string playlistRefusedDocument(const AutoPlaylistRequest& request) {
    return json{{"error", describe(request.refusal)}, {"detail", request.detail}}.dump();
}

// Nothing here describes the player's internals: the detail is empty except for an
// unreadable query, where it is foobar2000's own message about text the client sent.
std::string playlistFailedDocument(const PlaylistResult& result) {
    return json{{"error", describe(result.outcome)}, {"detail", result.detail}}.dump();
}

std::string queryPreviewDocument(const PreviewResult& preview) {
    return json{{"valid", preview.valid},
                {"error", preview.error},
                {"matches", preview.matches},
                {"libraryEnabled", preview.libraryEnabled}}
        .dump();
}

int httpStatusFor(PlaylistRefusal refusal) {
    switch (refusal) {
        case PlaylistRefusal::none:
            return 200;
        case PlaylistRefusal::tooFast:
            return 429;
        case PlaylistRefusal::malformedBody:
        case PlaylistRefusal::badTitle:
        case PlaylistRefusal::badKey:
        case PlaylistRefusal::badQuery:
        case PlaylistRefusal::badSort:
        case PlaylistRefusal::badId:
            return 400;
    }
    return 400;
}

int httpStatusFor(PlaylistOutcome outcome) {
    switch (outcome) {
        case PlaylistOutcome::done:
            return 200;
        case PlaylistOutcome::queryInvalid:
            return 400;
        case PlaylistOutcome::notOurs:
            return 403;
        case PlaylistOutcome::noSuchPlaylist:
            return 404;
        case PlaylistOutcome::keyInUse:
        case PlaylistOutcome::tooMany:
            return 409;
        case PlaylistOutcome::playerRefused:
            return 500;
        case PlaylistOutcome::timedOut:
            return 504;
        case PlaylistOutcome::unavailable:
            return 503;
    }
    return 500;
}

int httpStatusFor(TagWriteOutcome outcome) {
    switch (outcome) {
        case TagWriteOutcome::written:
            return 200;
        case TagWriteOutcome::trackNotKnown:
            return 404;
        case TagWriteOutcome::writeFailed:
            return 500;
        case TagWriteOutcome::timedOut:
            return 504;
        case TagWriteOutcome::unavailable:
            return 503;
    }
    return 500;
}

}  // namespace jean
