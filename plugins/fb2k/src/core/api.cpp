#include "core/api.h"

#include "core/json.h"
#include "core/playback_modes.h"
#include "core/text.h"
#include "core/version.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <array>
#include <iterator>
#include <limits>

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

json libraryFields(const Library::State& state) {
    return json{{"ready", state.ready},
                {"structure", state.structure},
                {"revision", state.revision},
                {"trackCount", state.trackCount},
                {"columns", state.columns}};
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
    return json{{"playback", playbackName(player.playback)},
                {"path", player.path},
                {"subsong", player.subsong},
                {"libraryPath", player.libraryPath ? json(*player.libraryPath) : json(nullptr)},
                {"position", positionOf(player.position, now)},
                {"duration", player.duration},
                {"volume", player.volume},
                {"muted", player.muted},
                {"playbackMode", player.playbackMode ? json(*player.playbackMode) : json(nullptr)},
                {"title", player.title ? json(*player.title) : json(nullptr)},
                {"artist", player.artist ? json(*player.artist) : json(nullptr)},
                {"album", player.album ? json(*player.album) : json(nullptr)},
                {"albumArtist", player.albumArtist ? json(*player.albumArtist) : json(nullptr)},
                {"playingLocation", playingLocationOf(player.playingLocation)},
                {"currentPlaylistId",
                 player.currentPlaylistId ? json(*player.currentPlaylistId) : json(nullptr)},
                {"queueRevision", revisions.queue},
                {"playlistsRevision", revisions.playlists},
                {"timelineRevision", revisions.timeline}};
}

// The player's own listing order, kept: a sorted one would tell a client the modes came off a
// table here rather than off the player it is actually running against.
std::vector<std::string> playbackModesOf(const std::vector<std::string>& playbackOrders) {
    std::vector<std::string> modes;
    for (const auto& order : playbackOrders) {
        if (auto mode = jeanModeFor(order))
            modes.push_back(std::move(*mode));
    }
    return modes;
}

FillRequest refuseFill() {
    FillRequest request;
    request.refusal = PlaylistRefusal::badOrdinals;
    return request;
}

SourceRowsRequest refuseSourceRows(PlaylistRefusal refusal) {
    SourceRowsRequest request;
    request.refusal = refusal;
    return request;
}

MovePlaylistRequest refuseMovePlaylist(PlaylistRefusal refusal) {
    MovePlaylistRequest request;
    request.refusal = refusal;
    return request;
}

QueueRowsRequest refuseQueueRows(PlaylistRefusal refusal) {
    QueueRowsRequest request;
    request.refusal = refusal;
    return request;
}

QueueTracksRequest refuseQueueTracks(PlaylistRefusal refusal) {
    QueueTracksRequest request;
    request.refusal = refusal;
    return request;
}

MoveQueueRequest refuseMoveQueue(PlaylistRefusal refusal) {
    MoveQueueRequest request;
    request.refusal = refusal;
    return request;
}

RemoveQueueRequest refuseRemoveQueue(PlaylistRefusal refusal) {
    RemoveQueueRequest request;
    request.refusal = refusal;
    return request;
}

PlaylistPageRequest refusePlaylistPage(PlaylistRefusal refusal) {
    PlaylistPageRequest request;
    request.refusal = refusal;
    return request;
}

PlayRowRequest refusePlayRow(PlaylistRefusal refusal) {
    PlayRowRequest request;
    request.refusal = refusal;
    return request;
}

SeekRequest refuseSeek(std::string detail) {
    SeekRequest request;
    request.refusal = PlaybackRefusal::badSeek;
    request.detail = std::move(detail);
    return request;
}

PlaybackModeRequest refusePlaybackMode(std::string detail) {
    PlaybackModeRequest request;
    request.refusal = PlaybackRefusal::badMode;
    request.detail = std::move(detail);
    return request;
}

VolumeRequest refuseVolume(std::string detail) {
    VolumeRequest request;
    request.refusal = PlaybackRefusal::badVolume;
    request.detail = std::move(detail);
    return request;
}

bool fitsUint32(uint64_t value) {
    return value <= std::numeric_limits<uint32_t>::max();
}

struct QueuePositionField {
    std::optional<QueuePosition> at;
    PlaylistRefusal refusal = PlaylistRefusal::none;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

QueuePositionField readQueuePosition(const json& root) {
    const auto at = root.find("at");
    if (at == root.end())
        return {};

    if (!at->is_number_unsigned() || !fitsUint32(at->get<uint64_t>()))
        return {std::nullopt, PlaylistRefusal::badOrdinals};

    const auto revision = root.find("revision");
    if (revision == root.end() || !revision->is_number_unsigned())
        return {std::nullopt, PlaylistRefusal::badOrdinals};

    QueuePositionField field;
    field.at = QueuePosition{static_cast<uint32_t>(at->get<uint64_t>()), revision->get<uint64_t>()};
    return field;
}

FillRequest malformedFill() {
    FillRequest request;
    request.refusal = PlaylistRefusal::malformedBody;
    return request;
}

RemoveRowsRequest refuseRemoveRows(PlaylistRefusal refusal) {
    RemoveRowsRequest request;
    request.refusal = refusal;
    return request;
}

template <typename Fields>
bool declaresOnly(const json& root, const Fields& fields) {
    return std::all_of(root.items().begin(), root.items().end(), [&fields](const auto& item) {
        return std::any_of(std::begin(fields), std::end(fields),
                           [&item](const char* field) { return item.key() == field; });
    });
}

// Exactly the fields contract/openapi.yaml declares for each request body below,
// `additionalProperties: false` there; `declaresOnly` refuses anything else.
constexpr std::array<const char*, 4> kFillFields{"structure", "runs", "bitset", "ordinals"};
constexpr char kTitleField[] = "title";

constexpr char kSourceField[] = "source";
constexpr std::array<const char*, 2> kSourceRowsFields{kSourceField, "runs"};

constexpr char kIndexField[] = "index";
constexpr std::array<const char*, 1> kMovePlaylistFields{kIndexField};

constexpr std::array<const char*, 2> kSeekFields{"seconds", "relativeSeconds"};
constexpr char kModeField[] = "mode";
constexpr std::array<const char*, 1> kPlaybackModeFields{kModeField};
constexpr std::array<const char*, 3> kVolumeFields{"value", "step", "muted"};

constexpr std::array<const char*, 4> kQueueRowsFields{"playlistId", "positions", "at", "revision"};
constexpr std::array<const char*, 6> kQueueTracksFields{"structure", "runs", "bitset",
                                                        "ordinals",  "at",   "revision"};
constexpr std::array<const char*, 3> kMoveQueueFields{"from", "to", "revision"};

int base64Value(char c) {
    if (c >= 'A' && c <= 'Z')
        return c - 'A';
    if (c >= 'a' && c <= 'z')
        return c - 'a' + 26;
    if (c >= '0' && c <= '9')
        return c - '0' + 52;
    if (c == '+')
        return 62;
    if (c == '/')
        return 63;
    return -1;
}

struct Base64Bytes {
    std::vector<uint8_t> bytes;
    bool ok = false;
};

// The inverse of ui/src/shared/api/fooJean.ts's base64Of: the same alphabet, decoded four
// characters at a time back to up to three bytes, with '=' only where that encoder ever
// writes it, at the end of the last group.
Base64Bytes decodeBase64(const std::string& text) {
    if (text.empty() || text.size() % 4 != 0)
        return {};

    Base64Bytes result;
    for (size_t at = 0; at < text.size(); at += 4) {
        int values[4] = {0, 0, 0, 0};
        int padding = 0;

        for (int part = 0; part < 4; ++part) {
            const char c = text[at + static_cast<size_t>(part)];
            if (c == '=') {
                ++padding;
                continue;
            }

            if (padding > 0)
                return {};

            values[part] = base64Value(c);
            if (values[part] < 0)
                return {};
        }

        if (padding > 2 || (padding > 0 && at + 4 != text.size()))
            return {};

        const auto group =
            (static_cast<uint32_t>(values[0]) << 18U) | (static_cast<uint32_t>(values[1]) << 12U) |
            (static_cast<uint32_t>(values[2]) << 6U) | static_cast<uint32_t>(values[3]);

        result.bytes.push_back(static_cast<uint8_t>(group >> 16U));
        if (padding < 2)
            result.bytes.push_back(static_cast<uint8_t>(group >> 8U));
        if (padding < 1)
            result.bytes.push_back(static_cast<uint8_t>(group));
    }

    result.ok = true;
    return result;
}

bool namesOneSelectionForm(const json& root) {
    const int forms = (root.contains("runs") ? 1 : 0) + (root.contains("bitset") ? 1 : 0) +
                      (root.contains("ordinals") ? 1 : 0);
    return forms == 1;
}

struct SelectionResult {
    PlaylistRefusal refusal = PlaylistRefusal::none;
    std::vector<uint32_t> ordinals;

    bool ok() const { return refusal == PlaylistRefusal::none; }
};

// `runs` and `bitset` are sorted ascending because neither can encode any other order;
// `ordinals` keeps the order given, since only it can carry one.
SelectionResult decodeSelection(const json& root, size_t trackCount) {
    const auto inRange = [trackCount](uint64_t ordinal) { return ordinal < trackCount; };

    SelectionResult result;

    const auto ordinals = root.find("ordinals");
    if (ordinals != root.end()) {
        if (!ordinals->is_array())
            return {PlaylistRefusal::badOrdinals, {}};

        for (const auto& entry : *ordinals) {
            if (!entry.is_number_unsigned())
                return {PlaylistRefusal::badOrdinals, {}};

            const auto value = entry.get<uint64_t>();
            if (!inRange(value))
                return {PlaylistRefusal::badOrdinals, {}};

            result.ordinals.push_back(static_cast<uint32_t>(value));
        }

        return result;
    }

    const auto runs = root.find("runs");
    if (runs != root.end()) {
        if (!runs->is_array())
            return {PlaylistRefusal::badOrdinals, {}};

        // A run's count is a JSON number, so a body of a few dozen bytes can name a
        // resolved set no process here could hold. Summing every run's count against
        // trackCount runs to completion before the loop below expands a single one, so
        // an oversized request is refused at the cost of the sum rather than the
        // allocation it asked for.
        uint64_t total = 0;
        for (const auto& run : *runs) {
            if (!run.is_array() || run.size() != 2 || !run[0].is_number_unsigned() ||
                !run[1].is_number_unsigned())
                return {PlaylistRefusal::badOrdinals, {}};

            total += run[1].get<uint64_t>();
            if (total > trackCount)
                return {PlaylistRefusal::badOrdinals, {}};
        }

        for (const auto& run : *runs) {
            const auto start = run[0].get<uint64_t>();
            const auto count = run[1].get<uint64_t>();

            for (uint64_t at = 0; at < count; ++at) {
                const uint64_t ordinal = start + at;
                if (!inRange(ordinal))
                    return {PlaylistRefusal::badOrdinals, {}};

                result.ordinals.push_back(static_cast<uint32_t>(ordinal));
            }
        }

        std::sort(result.ordinals.begin(), result.ordinals.end());
        return result;
    }

    const auto bitset = root.find("bitset");
    if (bitset == root.end() || !bitset->is_string())
        return {PlaylistRefusal::badOrdinals, {}};

    const auto decoded = decodeBase64(bitset->get<std::string>());
    if (!decoded.ok)
        return {PlaylistRefusal::badOrdinals, {}};

    for (size_t byteIndex = 0; byteIndex < decoded.bytes.size(); ++byteIndex) {
        for (unsigned bit = 0; bit < 8; ++bit) {
            if ((decoded.bytes[byteIndex] & (1U << bit)) == 0U)
                continue;

            const uint64_t ordinal = (byteIndex * 8) + static_cast<uint64_t>(bit);
            if (!inRange(ordinal))
                return {PlaylistRefusal::badOrdinals, {}};

            result.ordinals.push_back(static_cast<uint32_t>(ordinal));
        }
    }

    return result;
}

}  // namespace

std::string statusDocument() {
    return identity().dump();
}

std::string capabilitiesDocument(const Settings& settings,
                                 const std::vector<std::string>& streamFormats,
                                 bool mutesWhileStreaming, bool servesLibrary,
                                 const std::string& playerName, const std::string& playerVersion,
                                 double volumeMin, double volumeMax, const std::string& volumeUnit,
                                 const std::vector<std::string>& playbackOrders) {
    const json body{
        {"apiVersion", kApiVersion},
        {"allowedFields", settings.allowedFields},
        {"canWrite", !settings.allowedFields.empty()},
        {"canWritePlaylists", settings.writePlaylists},
        {"canControlPlayback", settings.controlPlayback},
        {"canChangeOutput", settings.changeOutput},
        {"maxAutoPlaylists", settings.maxAutoPlaylists},
        {"canCreateAutoPlaylists", settings.writePlaylists && settings.maxAutoPlaylists > 0},
        {"canStream", !streamFormats.empty() && settings.streamingEnabled},
        {"streamFormats", streamFormats},
        {"canMuteWhileStreaming", mutesWhileStreaming},
        {"canReadLibrary", servesLibrary},
        {"playerName", playerName},
        {"playerVersion", playerVersion},
        {"volumeMin", volumeMin},
        {"volumeMax", volumeMax},
        {"volumeUnit", volumeUnit},
        {"playbackModes", playbackModesOf(playbackOrders)}};
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
        case TagWriteRefusal::badAddress:
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

std::string fillResultDocument(const std::string& playlistId, uint64_t structure,
                               const std::vector<size_t>& positions) {
    return json{
        {"playlistId", playlistId}, {"structure", digitsOf(structure)}, {"positions", positions}}
        .dump();
}

std::string copiedRowsDocument(uint64_t structure, const std::vector<size_t>& positions) {
    return json{{"structure", digitsOf(structure)}, {"positions", positions}}.dump();
}

std::string removedRowsDocument(uint64_t structure) {
    return json{{"structure", digitsOf(structure)}}.dump();
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

PlaylistPageRequest parsePlaylistPage(const std::string& offsetText, const std::string& countText) {
    uint64_t offset = 0;
    if (!readDecimal(offsetText, offset) || !fitsUint32(offset))
        return refusePlaylistPage(PlaylistRefusal::badOrdinals);

    uint64_t count = 0;
    if (!readDecimal(countText, count) || !fitsUint32(count))
        return refusePlaylistPage(PlaylistRefusal::badOrdinals);

    PlaylistPageRequest request;
    request.offset = static_cast<uint32_t>(offset);
    request.count = static_cast<uint32_t>(count);
    return request;
}

PlayRowRequest parsePlayRow(const std::string& id, const std::string& indexText) {
    if (!isPlaylistId(id))
        return refusePlayRow(PlaylistRefusal::badId);

    uint64_t index = 0;
    if (!readDecimal(indexText, index) || !fitsUint32(index))
        return refusePlayRow(PlaylistRefusal::badOrdinals);

    PlayRowRequest request;
    request.playlistId = id;
    request.index = static_cast<uint32_t>(index);
    return request;
}

std::string describe(PlaybackRefusal refusal) {
    switch (refusal) {
        case PlaybackRefusal::none:
            return "ok";
        case PlaybackRefusal::badSeek:
            return "unacceptable seek";
        case PlaybackRefusal::badMode:
            return "unacceptable mode";
        case PlaybackRefusal::badVolume:
            return "unacceptable volume";
    }
    return "unknown";
}

int httpStatusFor(PlaybackRefusal refusal) {
    switch (refusal) {
        case PlaybackRefusal::none:
            return 200;
        case PlaybackRefusal::badSeek:
        case PlaybackRefusal::badMode:
        case PlaybackRefusal::badVolume:
            return 400;
    }
    return 400;
}

std::string playbackRefusedDocument(PlaybackRefusal refusal, const std::string& detail) {
    return json{{"error", describe(refusal)}, {"detail", detail}}.dump();
}

SeekRequest parseSeek(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseSeek(document.error);

    const auto& root = document.value;
    if (!declaresOnly(root, kSeekFields))
        return refuseSeek("a field this route does not take was named");

    const bool absolute = root.contains("seconds");
    const bool relative = root.contains("relativeSeconds");
    if (absolute && relative)
        return refuseSeek("'seconds' and 'relativeSeconds' were both present; send exactly one");
    if (!absolute && !relative)
        return refuseSeek("send exactly one of 'seconds' and 'relativeSeconds'");

    const auto& field = root.at(absolute ? "seconds" : "relativeSeconds");
    if (!field.is_number()) {
        return refuseSeek("'" + std::string(absolute ? "seconds" : "relativeSeconds") +
                          "' must be a number");
    }

    const auto seconds = field.get<double>();
    if (absolute && seconds < 0)
        return refuseSeek("'seconds' must not be negative");

    SeekRequest request;
    request.seconds = seconds;
    request.relative = relative;
    return request;
}

PlaybackModeRequest parsePlaybackMode(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refusePlaybackMode(document.error);

    const auto& root = document.value;
    if (!declaresOnly(root, kPlaybackModeFields))
        return refusePlaybackMode("a field this route does not take was named");

    const auto mode = root.find(kModeField);
    if (mode == root.end() || !mode->is_string())
        return refusePlaybackMode("'mode' is required and must be a string");

    PlaybackModeRequest request;
    request.mode = mode->get<std::string>();
    return request;
}

VolumeRequest parseVolume(const std::string& body, double volumeMin, double volumeMax) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseVolume(document.error);

    const auto& root = document.value;
    if (!declaresOnly(root, kVolumeFields))
        return refuseVolume("a field this route does not take was named");

    const int forms = (root.contains("value") ? 1 : 0) + (root.contains("step") ? 1 : 0) +
                      (root.contains("muted") ? 1 : 0);
    if (forms != 1)
        return refuseVolume("send exactly one of 'value', 'step' and 'muted'");

    VolumeRequest request;

    if (const auto value = root.find("value"); value != root.end()) {
        if (!value->is_number())
            return refuseVolume("'value' must be a number");

        const auto level = value->get<double>();
        if (level < volumeMin || level > volumeMax)
            return refuseVolume("'value' must be between this install's volumeMin and volumeMax");

        request.form = VolumeRequest::Form::value;
        request.value = level;
        return request;
    }

    if (const auto step = root.find("step"); step != root.end()) {
        if (!step->is_string())
            return refuseVolume("'step' must be 'up' or 'down'");

        const auto direction = step->get<std::string>();
        if (direction != "up" && direction != "down")
            return refuseVolume("'step' must be 'up' or 'down'");

        request.form = VolumeRequest::Form::step;
        request.step = direction;
        return request;
    }

    const auto muted = root.find("muted");
    if (!muted->is_boolean())
        return refuseVolume("'muted' must be a boolean");

    request.form = VolumeRequest::Form::muted;
    request.muted = muted->get<bool>();
    return request;
}

std::string queueDocument(const QueueRead& read) {
    json entries = json::array();
    std::transform(read.entries.begin(), read.entries.end(), std::back_inserter(entries),
                   queuedTrackOf);

    return json{{"revision", read.revision}, {"entries", std::move(entries)}}.dump();
}

QueueRowsRequest parseQueueRows(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseQueueRows(PlaylistRefusal::malformedBody);

    const auto& root = document.value;

    if (!declaresOnly(root, kQueueRowsFields))
        return refuseQueueRows(PlaylistRefusal::malformedBody);

    const auto playlistId = root.find("playlistId");
    if (playlistId == root.end() || !playlistId->is_string())
        return refuseQueueRows(PlaylistRefusal::badId);

    const auto id = playlistId->get<std::string>();
    if (!isPlaylistId(id))
        return refuseQueueRows(PlaylistRefusal::badId);

    const auto positions = root.find("positions");
    if (positions == root.end() || !positions->is_array() || positions->empty())
        return refuseQueueRows(PlaylistRefusal::badOrdinals);

    QueueRowsRequest request;
    request.playlistId = id;

    for (const auto& entry : *positions) {
        if (!entry.is_number_unsigned())
            return refuseQueueRows(PlaylistRefusal::badOrdinals);

        const auto value = entry.get<uint64_t>();
        if (!fitsUint32(value))
            return refuseQueueRows(PlaylistRefusal::badOrdinals);

        request.positions.push_back(static_cast<uint32_t>(value));
    }

    const auto position = readQueuePosition(root);
    if (!position.ok())
        return refuseQueueRows(position.refusal);
    request.at = position.at;

    return request;
}

QueueTracksRequest parseQueueTracks(const std::string& body, size_t trackCount,
                                    std::optional<uint64_t> expectedStructure) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseQueueTracks(PlaylistRefusal::malformedBody);

    const auto& root = document.value;

    if (!declaresOnly(root, kQueueTracksFields))
        return refuseQueueTracks(PlaylistRefusal::malformedBody);

    const auto structure = root.find("structure");
    if (structure == root.end() || !structure->is_number_unsigned())
        return refuseQueueTracks(PlaylistRefusal::malformedBody);

    if (!namesOneSelectionForm(root))
        return refuseQueueTracks(PlaylistRefusal::badOrdinals);

    QueueTracksRequest request;
    request.structure = structure->get<uint64_t>();

    if (expectedStructure && request.structure != *expectedStructure) {
        request.outcome = PlaylistOutcome::structureMoved;
        return request;
    }

    const auto selection = decodeSelection(root, trackCount);
    if (!selection.ok() || selection.ordinals.empty())
        return refuseQueueTracks(PlaylistRefusal::badOrdinals);

    request.ordinals = selection.ordinals;

    const auto position = readQueuePosition(root);
    if (!position.ok())
        return refuseQueueTracks(position.refusal);
    request.at = position.at;

    return request;
}

MoveQueueRequest parseMoveQueue(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseMoveQueue(PlaylistRefusal::malformedBody);

    const auto& root = document.value;

    if (!declaresOnly(root, kMoveQueueFields))
        return refuseMoveQueue(PlaylistRefusal::malformedBody);

    const auto from = root.find("from");
    if (from == root.end() || !from->is_number_unsigned() || !fitsUint32(from->get<uint64_t>()))
        return refuseMoveQueue(PlaylistRefusal::badOrdinals);

    const auto to = root.find("to");
    if (to == root.end() || !to->is_number_unsigned() || !fitsUint32(to->get<uint64_t>()))
        return refuseMoveQueue(PlaylistRefusal::badOrdinals);

    const auto revision = root.find("revision");
    if (revision == root.end() || !revision->is_number_unsigned())
        return refuseMoveQueue(PlaylistRefusal::badOrdinals);

    MoveQueueRequest request;
    request.from = static_cast<uint32_t>(from->get<uint64_t>());
    request.to = static_cast<uint32_t>(to->get<uint64_t>());
    request.revision = revision->get<uint64_t>();
    return request;
}

RemoveQueueRequest parseRemoveQueue(const std::string& indexText, const std::string& revisionText) {
    uint64_t index = 0;
    if (!readDecimal(indexText, index) || !fitsUint32(index))
        return refuseRemoveQueue(PlaylistRefusal::badOrdinals);

    uint64_t revision = 0;
    if (!readDecimal(revisionText, revision))
        return refuseRemoveQueue(PlaylistRefusal::badOrdinals);

    RemoveQueueRequest request;
    request.index = static_cast<uint32_t>(index);
    request.revision = revision;
    return request;
}

QueueSource queueSourceOf(const std::string& body) {
    const auto document = parseJsonObject(body);
    const auto& root = document.value;

    const bool namesRows = root.contains("playlistId") || root.contains("positions");
    const bool namesTracks = root.contains("structure") || root.contains("ordinals") ||
                             root.contains("runs") || root.contains("bitset");

    if (namesRows == namesTracks)
        return QueueSource::invalid;

    return namesRows ? QueueSource::playlistRows : QueueSource::libraryTracks;
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
        case PlaylistRefusal::badOrdinals:
            return 400;
    }
    return 400;
}

int httpStatusFor(PlaylistOutcome outcome) {
    switch (outcome) {
        case PlaylistOutcome::done:
            return 200;
        case PlaylistOutcome::queryInvalid:
        case PlaylistOutcome::positionPastEnd:
            return 400;
        case PlaylistOutcome::notOurs:
        case PlaylistOutcome::writesDisabled:
        case PlaylistOutcome::ownPlaylist:
        case PlaylistOutcome::playbackDisabled:
            return 403;
        case PlaylistOutcome::noSuchPlaylist:
            return 404;
        case PlaylistOutcome::ambiguousAddress:
        case PlaylistOutcome::keyInUse:
        case PlaylistOutcome::tooMany:
        case PlaylistOutcome::structureMoved:
        case PlaylistOutcome::queueMoved:
        case PlaylistOutcome::rowsMoved:
        case PlaylistOutcome::playlistLocked:
            return 409;
        case PlaylistOutcome::rowsRevisionTooOld:
            return 410;
        case PlaylistOutcome::playerRefused:
            return 500;
        case PlaylistOutcome::timedOut:
            return 504;
        case PlaylistOutcome::unavailable:
            return 503;
    }
    return 500;
}

FillRequest parseFill(const std::string& body, size_t trackCount,
                      std::optional<uint64_t> expectedStructure, bool allowsTitle) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return malformedFill();

    const auto& root = document.value;

    std::vector<const char*> fields(kFillFields.begin(), kFillFields.end());
    if (allowsTitle)
        fields.push_back(kTitleField);
    if (!declaresOnly(root, fields))
        return malformedFill();

    const auto structure = root.find("structure");
    if (structure == root.end() || !structure->is_number_unsigned())
        return malformedFill();

    if (!namesOneSelectionForm(root))
        return refuseFill();

    FillRequest request;
    request.structure = structure->get<uint64_t>();

    if (expectedStructure && request.structure != *expectedStructure) {
        request.outcome = PlaylistOutcome::structureMoved;
        return request;
    }

    const auto selection = decodeSelection(root, trackCount);
    if (!selection.ok())
        return refuseFill();

    request.ordinals = selection.ordinals;
    return request;
}

RemoveRowsRequest parseRemoveRows(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseRemoveRows(PlaylistRefusal::malformedBody);

    const auto& root = document.value;

    if (!declaresOnly(root, kFillFields))
        return refuseRemoveRows(PlaylistRefusal::malformedBody);

    const auto structure = root.find("structure");
    RemoveRowsRequest request;
    if (structure == root.end() || !structure->is_string() ||
        !readDecimal(structure->get<std::string>(), request.structure))
        return refuseRemoveRows(PlaylistRefusal::malformedBody);

    if (!namesOneSelectionForm(root))
        return refuseRemoveRows(PlaylistRefusal::badOrdinals);

    const auto selection = decodeSelection(root, kMaxPlaylistPositionRows);
    if (!selection.ok())
        return refuseRemoveRows(PlaylistRefusal::badOrdinals);

    request.ordinals = selection.ordinals;
    return request;
}

NewPlaylistSet newPlaylistSetOf(const std::string& body) {
    const auto document = parseJsonObject(body);
    const auto& root = document.value;

    if (root.contains(kSourceField))
        return NewPlaylistSet::playlistRows;

    const bool namesTracks =
        std::any_of(kFillFields.begin(), kFillFields.end(),
                    [&root](const char* field) { return root.contains(field); });

    return namesTracks ? NewPlaylistSet::libraryTracks : NewPlaylistSet::none;
}

SourceRowsRequest parseSourceRows(const std::string& body, bool allowsTitle) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseSourceRows(PlaylistRefusal::malformedBody);

    const auto& root = document.value;

    std::vector<const char*> fields(kSourceRowsFields.begin(), kSourceRowsFields.end());
    if (allowsTitle)
        fields.push_back(kTitleField);
    if (!declaresOnly(root, fields))
        return refuseSourceRows(PlaylistRefusal::malformedBody);

    const auto source = root.find(kSourceField);
    if (source == root.end() || !source->is_string() || !isPlaylistId(source->get<std::string>()))
        return refuseSourceRows(PlaylistRefusal::badId);

    const auto selection = decodeSelection(root, kMaxPlaylistPositionRows);
    if (!selection.ok())
        return refuseSourceRows(PlaylistRefusal::badOrdinals);

    SourceRowsRequest request;
    request.playlistId = source->get<std::string>();
    request.positions = selection.ordinals;
    return request;
}

MovePlaylistRequest parseMovePlaylist(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuseMovePlaylist(PlaylistRefusal::malformedBody);

    const auto& root = document.value;

    if (!declaresOnly(root, kMovePlaylistFields))
        return refuseMovePlaylist(PlaylistRefusal::malformedBody);

    const auto index = root.find(kIndexField);
    if (index == root.end() || !index->is_number_unsigned() || !fitsUint32(index->get<uint64_t>()))
        return refuseMovePlaylist(PlaylistRefusal::badOrdinals);

    MovePlaylistRequest request;
    request.index = static_cast<uint32_t>(index->get<uint64_t>());
    return request;
}

std::string libraryDocument(const Library::State& state) {
    return libraryFields(state).dump();
}

std::string stateDocument(const Library::State& state, const PlayerState& player,
                          std::chrono::steady_clock::time_point now, PlayerRevisions revisions,
                          std::optional<uint64_t> configGeneration) {
    auto body = json{{"library", libraryFields(state)},
                     {"player", playerFields(player, now, revisions)}};
    if (configGeneration)
        body["configGeneration"] = *configGeneration;
    return body.dump();
}

std::string libraryRefusedDocument(const LibraryRequest& request) {
    return json{{"error", describe(request.refusal)}, {"detail", request.detail}}.dump();
}

std::string libraryFailedDocument(DeltaOutcome outcome) {
    return json{{"error", describe(outcome)}, {"detail", ""}}.dump();
}

std::string libraryTrackDocument(const std::vector<std::string>& columns) {
    return json{{"columns", columns}}.dump();
}

std::string playingTrackDocument(const std::string& path, uint32_t subsong,
                                 const std::vector<std::string>& columns) {
    return json{{"path", path}, {"subsong", subsong}, {"columns", columns}}.dump();
}

int httpStatusFor(LibraryRefusal refusal) {
    switch (refusal) {
        case LibraryRefusal::none:
            return 200;
        case LibraryRefusal::tooManyColumns:
        case LibraryRefusal::badColumn:
        case LibraryRefusal::duplicateColumn:
        case LibraryRefusal::badSince:
            return 400;
    }
    return 400;
}

int httpStatusFor(DeltaOutcome outcome) {
    switch (outcome) {
        case DeltaOutcome::ok:
            return 200;
        case DeltaOutcome::structureChanged:
            return 409;
        case DeltaOutcome::revisionTooOld:
        case DeltaOutcome::revisionUnknown:
            return 410;
        case DeltaOutcome::notBuilt:
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
        case TagWriteOutcome::ambiguousAddress:
        case TagWriteOutcome::rowsMoved:
        case TagWriteOutcome::libraryRebuilt:
            return 409;
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
