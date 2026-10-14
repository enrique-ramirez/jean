#include "core/documents.h"

#include "core/playback_modes.h"
#include "core/player.h"
#include "core/version.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <iterator>

using nlohmann::json;

namespace jean {

namespace {

// A playlist's structure generation and content revision travel as strings: they are seeded
// past 2^53, where a JSON number stops being exact. contract/openapi.yaml, `PlaylistAnnotation`,
// has why.
json digitsOf(uint64_t counter) {
    return json(std::to_string(counter));
}

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
    body["index"] = playlist.index;
    body["title"] = playlist.title;
    body["itemCount"] = playlist.itemCount;
    body["isAutoPlaylist"] = playlist.isAutoPlaylist;
    body["role"] = playlist.role ? json(roleName(*playlist.role)) : json(nullptr);
    body["structure"] = digitsOf(playlist.structure);
    body["revision"] = digitsOf(playlist.revision);
    body["managed"] = playlist.managed ? json{{"key", playlist.managed->key},
                                              {"query", playlist.managed->query},
                                              {"sort", playlist.managed->sort},
                                              {"forceSort", playlist.managed->forceSort}}
                                       : json(nullptr);
    return body;
}

const char* buildPhaseName(BuildPhase phase) {
    switch (phase) {
        case BuildPhase::listing:
            return "listing";
        case BuildPhase::ordering:
            return "ordering";
        case BuildPhase::formatting:
            return "formatting";
    }
    return "listing";
}

json buildOf(const std::optional<BuildProgress>& build) {
    if (!build)
        return json(nullptr);
    return json{{"phase", buildPhaseName(build->phase)},
                {"formatted", build->formatted},
                {"total", build->total}};
}

json libraryFields(const Library::State& state) {
    return json{{"ready", state.ready},       {"structure", state.structure},
                {"revision", state.revision}, {"trackCount", state.trackCount},
                {"columns", state.columns},   {"build", buildOf(state.build)},
                {"halted", state.halted}};
}

const char* playbackName(PlaybackState playback) {
    switch (playback) {
        case PlaybackState::stopped:
            return "stopped";
        case PlaybackState::paused:
            return "paused";
        case PlaybackState::playing:
            return "playing";
    }
    return "stopped";
}

json positionOf(const PositionMark& mark, std::chrono::steady_clock::time_point now) {
    const bool everTaken = mark.taken.time_since_epoch().count() != 0;
    const double age = everTaken ? std::chrono::duration<double>(now - mark.taken).count() : 0.0;
    return json{{"seconds", mark.seconds}, {"ageSeconds", age}};
}

json playingLocationOf(const std::optional<PlayingLocation>& location) {
    if (!location)
        return json(nullptr);
    return json{{"playlistId", location->playlistId}, {"index", location->index}};
}

json playlistRowOf(const PlaylistRow& row) {
    return json{{"columns", row.columns},
                {"libraryPath", row.libraryPath ? json(*row.libraryPath) : json(nullptr)},
                {"subsong", row.subsong}};
}

json changedPlaylistRowOf(const ChangedPlaylistRow& changed) {
    return json{
        {"position", changed.position},
        {"libraryPath", changed.row.libraryPath ? json(*changed.row.libraryPath) : json(nullptr)},
        {"subsong", changed.row.subsong}};
}

json queuedTrackOf(const QueuedTrack& track) {
    return json{{"title", track.title},
                {"artist", track.artist},
                {"duration", track.duration},
                {"album", track.album},
                {"albumArtist", track.albumArtist},
                {"libraryPath", track.libraryPath ? json(*track.libraryPath) : json(nullptr)},
                {"location", playingLocationOf(track.location)}};
}

json playerFields(const PlayerState& player, std::chrono::steady_clock::time_point now,
                  PlayerRevisions revisions) {
    return json{
        {"playback", playbackName(player.playback)},
        {"path", player.path},
        {"subsong", player.subsong},
        {"libraryPath", player.libraryPath ? json(*player.libraryPath) : json(nullptr)},
        {"position", positionOf(player.position, now)},
        {"duration", player.duration},
        {"volume", player.volume},
        {"muted", player.muted},
        {"playbackMode", player.playbackMode ? json(*player.playbackMode) : json(nullptr)},
        {"outputDeviceId", player.outputDeviceId ? json(*player.outputDeviceId) : json(nullptr)},
        {"outputSilent", player.outputSilent ? json(*player.outputSilent) : json(nullptr)},
        {"title", player.title ? json(*player.title) : json(nullptr)},
        {"artist", player.artist ? json(*player.artist) : json(nullptr)},
        {"album", player.album ? json(*player.album) : json(nullptr)},
        {"albumArtist", player.albumArtist ? json(*player.albumArtist) : json(nullptr)},
        {"playingLocation", playingLocationOf(player.playingLocation)},
        {"currentPlaylistId",
         player.currentPlaylistId ? json(*player.currentPlaylistId) : json(nullptr)},
        {"queueRevision", revisions.queue},
        {"playlistsRevision", revisions.playlists},
        {"timelineRevision", revisions.timeline},
        {"sessionRevision", revisions.session}};
}

json mainThreadFields(const MainThreadHealth& health) {
    const auto unanswered = health.answering
                                ? json(nullptr)
                                : json(std::chrono::duration<double>(health.unanswered).count());
    return json{{"answering", health.answering}, {"unansweredSeconds", unanswered}};
}

const char* reportKindName(SessionReportKind kind) {
    switch (kind) {
        case SessionReportKind::undecodable:
            return "undecodable";
        case SessionReportKind::chainDropped:
            return "chainDropped";
    }
    return "undecodable";
}

json sessionReportOf(const SessionReport& report) {
    return json{{"sequence", report.sequence},
                {"kind", reportKindName(report.kind)},
                {"path", report.path},
                {"subsong", report.subsong},
                {"libraryPath", report.libraryPath ? json(*report.libraryPath) : json(nullptr)}};
}

json creatorOf(const std::optional<DeviceIdentity>& creator) {
    if (!creator)
        return json(nullptr);
    return json{{"deviceId", creator->id},
                {"name", creator->name.empty() ? json(nullptr) : json(creator->name)}};
}

json sessionOf(const SessionView& session) {
    const PlayerState& state = session.state;

    json reports = json::array();
    std::transform(session.reports.begin(), session.reports.end(), std::back_inserter(reports),
                   sessionReportOf);

    return json{{"id", session.id},
                {"kind", session.detached ? "detached" : "engine"},
                {"shared", session.shared},
                {"playback", playbackName(state.playback)},
                {"title", state.title ? json(*state.title) : json(nullptr)},
                {"artist", state.artist ? json(*state.artist) : json(nullptr)},
                {"album", state.album ? json(*state.album) : json(nullptr)},
                {"albumArtist", state.albumArtist ? json(*state.albumArtist) : json(nullptr)},
                {"libraryPath", state.libraryPath ? json(*state.libraryPath) : json(nullptr)},
                {"listeners", session.listeners},
                {"playbackModes", session.playbackModes},
                {"chainDropped", session.chainDropped},
                {"reports", std::move(reports)},
                {"createdBy", creatorOf(session.createdBy)}};
}

}  // namespace

std::vector<std::string> playbackModesOf(const std::vector<std::string>& playbackOrders) {
    std::vector<std::string> modes;
    for (const auto& order : playbackOrders) {
        if (auto mode = jeanModeFor(order))
            modes.push_back(std::move(*mode));
    }
    return modes;
}

std::string statusDocument() {
    return identity().dump();
}

bool canStream(const Settings& settings, const std::vector<std::string>& streamFormats) {
    return !streamFormats.empty() && settings.streamingEnabled;
}

bool canCreateSessions(const Settings& settings, const std::vector<std::string>& streamFormats,
                       const SessionCapacity& capacity) {
    return canStream(settings, streamFormats) && capacity.startsStreams && capacity.maxSessions > 0;
}

std::string capabilitiesDocument(const Settings& settings, const PlayerReport& report,
                                 const std::vector<std::string>& streamFormats,
                                 bool mutesWhileStreaming, bool servesLibrary,
                                 const SessionCapacity& sessions) {
    const json body{
        {"apiVersion", kApiVersion},
        {"allowedFields", settings.allowedFields},
        {"canWrite", !settings.allowedFields.empty()},
        {"canWritePlaylists", settings.writePlaylists},
        {"canControlPlayback", settings.controlPlayback},
        {"canChangeOutput", settings.changeOutput},
        {"maxAutoPlaylists", settings.maxAutoPlaylists},
        {"canCreateAutoPlaylists", settings.writePlaylists && settings.maxAutoPlaylists > 0},
        {"canStream", canStream(settings, streamFormats)},
        {"streamFormats", streamFormats},
        {"canMuteWhileStreaming", mutesWhileStreaming},
        {"canReadLibrary", servesLibrary},
        {"playerName", report.name},
        {"playerVersion", report.version},
        {"volumeMin", report.volumeMin},
        {"volumeMax", report.volumeMax},
        {"volumeUnit", report.volumeUnit},
        {"playbackModes", playbackModesOf(report.playbackOrders)},
        {"maxSessions", sessions.maxSessions},
        {"canCreateSessions", canCreateSessions(settings, streamFormats, sessions)}};
    return body.dump();
}

std::string sessionDocument(const SessionView& session) {
    return sessionOf(session).dump();
}

std::string sessionsDocument(const std::vector<SessionView>& sessions) {
    json entries = json::array();
    std::transform(sessions.begin(), sessions.end(), std::back_inserter(entries), sessionOf);

    return json{{"sessions", std::move(entries)}}.dump();
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

std::string streamTicketDocument(const std::string& ticket, int expiresInSeconds) {
    return json{{"ticket", ticket}, {"expiresIn", expiresInSeconds}}.dump();
}

std::string streamTimelineDocument(double streamTime, const std::vector<StreamMark>& marks) {
    json entries = json::array();
    std::transform(marks.begin(), marks.end(), std::back_inserter(entries), timelineMark);

    return json{{"streamTime", streamTime}, {"marks", std::move(entries)}}.dump();
}

std::string tagWrittenDocument(const TagWrite& write) {
    json body{{"written", true}, {"fields", write.fields}};

    if (const auto& library = write.track.library) {
        body["track"] = library->track;
        body["subsong"] = library->subsong;
    } else if (const auto& ordinal = write.track.ordinal) {
        body["ordinal"] = ordinal->ordinal;
    } else if (const auto& row = write.track.playlist) {
        body["playlist"] = row->playlistId;
        body["index"] = row->index;
    }

    return body.dump();
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

std::string fillResultDocument(const std::string& playlistId, uint64_t structure,
                               const std::vector<size_t>& positions,
                               const std::vector<uint32_t>& skipped) {
    return json{{"playlistId", playlistId},
                {"structure", digitsOf(structure)},
                {"positions", positions},
                {"skipped", skipped}}
        .dump();
}

std::string copiedRowsDocument(uint64_t structure, const std::vector<size_t>& positions,
                               const std::vector<uint32_t>& skipped) {
    return json{{"structure", digitsOf(structure)}, {"positions", positions}, {"skipped", skipped}}
        .dump();
}

std::string removedRowsDocument(uint64_t structure) {
    return json{{"structure", digitsOf(structure)}}.dump();
}

std::string movedRowsDocument(uint64_t structure) {
    return json{{"structure", digitsOf(structure)}}.dump();
}

std::string sortedRowsDocument(uint64_t structure, const std::vector<uint32_t>& order) {
    return json{{"structure", digitsOf(structure)}, {"order", order}}.dump();
}

std::string playlistRowsDocument(const PlaylistRowsRead& read) {
    json items = json::array();
    std::transform(read.rows.begin(), read.rows.end(), std::back_inserter(items), playlistRowOf);

    return json{{"structure", digitsOf(read.structure)},
                {"revision", digitsOf(read.revision)},
                {"totalCount", read.totalCount},
                {"items", std::move(items)}}
        .dump();
}

std::string playlistChangesDocument(const PlaylistChangesRead& read) {
    json items = json::array();
    std::transform(read.rows.begin(), read.rows.end(), std::back_inserter(items),
                   changedPlaylistRowOf);

    json columns = json::array();
    if (!read.rows.empty()) {
        const size_t columnCount = read.rows.front().row.columns.size();
        std::vector<Dictionary> dictionaries(columnCount);
        std::vector<json> ids(columnCount, json::array());

        for (const auto& changed : read.rows) {
            for (size_t column = 0; column < columnCount; ++column)
                ids[column].push_back(dictionaries[column].intern(changed.row.columns[column]));
        }

        for (size_t column = 0; column < columnCount; ++column)
            columns.push_back(
                json{{"text", dictionaries[column].values}, {"ids", std::move(ids[column])}});
    }

    return json{{"revision", digitsOf(read.revision)},
                {"columns", std::move(columns)},
                {"items", std::move(items)}}
        .dump();
}

std::string outputsDocument(const OutputsRead& read) {
    json devices = json::array();
    for (const auto& device : read.devices)
        devices.push_back(json{{"id", device.id}, {"name", device.name}});

    return json{{"devices", std::move(devices)},
                {"active", read.active ? json(*read.active) : json(nullptr)}}
        .dump();
}

std::string queueDocument(const QueueRead& read) {
    json entries = json::array();
    std::transform(read.entries.begin(), read.entries.end(), std::back_inserter(entries),
                   queuedTrackOf);

    return json{{"revision", read.revision}, {"entries", std::move(entries)}}.dump();
}

std::string queryPreviewDocument(const PreviewResult& preview) {
    json body{{"valid", preview.valid},
              {"error", preview.error},
              {"matches", preview.matches},
              {"libraryEnabled", preview.libraryEnabled}};
    if (preview.hasRows) {
        body["structure"] = preview.structure;
        body["ordinals"] = preview.ordinals;
    }
    return body.dump();
}

std::string libraryDocument(const Library::State& state) {
    return libraryFields(state).dump();
}

std::string stateDocument(const Library::State& state, const PlayerState& player,
                          std::chrono::steady_clock::time_point now, PlayerRevisions revisions,
                          std::optional<uint64_t> configGeneration, MainThreadHealth mainThread) {
    auto body = json{{"library", libraryFields(state)},
                     {"player", playerFields(player, now, revisions)},
                     {"mainThread", mainThreadFields(mainThread)}};
    if (configGeneration)
        body["configGeneration"] = *configGeneration;
    return body.dump();
}

std::string libraryTrackDocument(const std::vector<std::string>& columns) {
    return json{{"columns", columns}}.dump();
}

std::string playingTrackDocument(const std::string& path, uint32_t subsong,
                                 const std::vector<std::string>& columns) {
    return json{{"path", path}, {"subsong", subsong}, {"columns", columns}}.dump();
}

}  // namespace jean
