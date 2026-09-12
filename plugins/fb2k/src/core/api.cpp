#include "core/api.h"

#include "core/json.h"
#include "core/version.h"
#include "third_party/json.hpp"

#include <algorithm>
#include <array>
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

FillRequest refuseFill() {
    FillRequest request;
    request.refusal = PlaylistRefusal::badOrdinals;
    return request;
}

FillRequest malformedFill() {
    FillRequest request;
    request.refusal = PlaylistRefusal::malformedBody;
    return request;
}

// The fields `FillPlaylistRequest` declares in contract/openapi.yaml; `declaredFillField`
// adds `title` on top of these for `FillOwnPlaylistRequest`. See parseFill's `allowsTitle`.
constexpr std::array<const char*, 4> kFillFields{"structure", "runs", "bitset", "ordinals"};
constexpr char kTitleField[] = "title";

bool declaredFillField(const std::string& key, bool allowsTitle) {
    if (allowsTitle && key == kTitleField)
        return true;

    return std::any_of(kFillFields.begin(), kFillFields.end(),
                       [&key](const char* field) { return key == field; });
}

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
            (static_cast<uint32_t>(values[0]) << 18) | (static_cast<uint32_t>(values[1]) << 12) |
            (static_cast<uint32_t>(values[2]) << 6) | static_cast<uint32_t>(values[3]);

        result.bytes.push_back(static_cast<uint8_t>(group >> 16));
        if (padding < 2)
            result.bytes.push_back(static_cast<uint8_t>(group >> 8));
        if (padding < 1)
            result.bytes.push_back(static_cast<uint8_t>(group));
    }

    result.ok = true;
    return result;
}

}  // namespace

std::string statusDocument() {
    auto body = identity();
    body["authRequired"] = true;
    return body.dump();
}

std::string capabilitiesDocument(const Settings& settings,
                                 const std::vector<std::string>& streamFormats,
                                 bool mutesWhileStreaming, bool servesLibrary) {
    const json body{{"apiVersion", kApiVersion},
                    {"allowedFields", settings.allowedFields},
                    {"canWrite", !settings.allowedFields.empty()},
                    {"canWritePlaylists", settings.writePlaylists},
                    {"maxAutoPlaylists", settings.maxAutoPlaylists},
                    {"canCreateAutoPlaylists",
                     settings.writePlaylists && settings.maxAutoPlaylists > 0},
                    {"canStream", !streamFormats.empty()},
                    {"streamFormats", streamFormats},
                    {"canMuteWhileStreaming", mutesWhileStreaming},
                    {"canReadLibrary", servesLibrary}};
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

std::string fillResultDocument(const std::string& playlistId, const std::string& beefwebId,
                               const std::vector<size_t>& positions) {
    return json{{"playlistId", playlistId},
                {"beefwebId", beefwebId.empty() ? json(nullptr) : json(beefwebId)},
                {"positions", positions}}
        .dump();
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
            return 400;
        case PlaylistOutcome::notOurs:
        case PlaylistOutcome::writesDisabled:
            return 403;
        case PlaylistOutcome::noSuchPlaylist:
            return 404;
        case PlaylistOutcome::keyInUse:
        case PlaylistOutcome::tooMany:
        case PlaylistOutcome::structureMoved:
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

FillRequest parseFill(const std::string& body, size_t trackCount,
                      std::optional<uint64_t> expectedStructure, bool allowsTitle) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return malformedFill();

    const auto& root = document.value;

    for (const auto& field : root.items()) {
        if (!declaredFillField(field.key(), allowsTitle))
            return malformedFill();
    }

    const auto structure = root.find("structure");
    if (structure == root.end() || !structure->is_number_unsigned())
        return malformedFill();

    const auto runs = root.find("runs");
    const auto bitset = root.find("bitset");
    const auto ordinals = root.find("ordinals");

    const bool hasRuns = runs != root.end();
    const bool hasBitset = bitset != root.end();
    const bool hasOrdinals = ordinals != root.end();

    if (hasRuns + hasBitset + hasOrdinals != 1)
        return refuseFill();

    FillRequest request;
    request.structure = structure->get<uint64_t>();

    if (expectedStructure && request.structure != *expectedStructure) {
        request.outcome = PlaylistOutcome::structureMoved;
        return request;
    }

    const auto inRange = [trackCount](uint64_t ordinal) { return ordinal < trackCount; };

    if (hasOrdinals) {
        if (!ordinals->is_array())
            return refuseFill();

        for (const auto& entry : *ordinals) {
            if (!entry.is_number_unsigned())
                return refuseFill();

            const auto value = entry.get<uint64_t>();
            if (!inRange(value))
                return refuseFill();

            request.ordinals.push_back(static_cast<uint32_t>(value));
        }

        return request;
    }

    if (hasRuns) {
        if (!runs->is_array())
            return refuseFill();

        uint64_t total = 0;
        for (const auto& run : *runs) {
            if (!run.is_array() || run.size() != 2 || !run[0].is_number_unsigned() ||
                !run[1].is_number_unsigned())
                return refuseFill();

            total += run[1].get<uint64_t>();
            if (total > trackCount)
                return refuseFill();
        }

        for (const auto& run : *runs) {
            const auto start = run[0].get<uint64_t>();
            const auto count = run[1].get<uint64_t>();

            for (uint64_t at = 0; at < count; ++at) {
                const uint64_t ordinal = start + at;
                if (!inRange(ordinal))
                    return refuseFill();

                request.ordinals.push_back(static_cast<uint32_t>(ordinal));
            }
        }

        std::sort(request.ordinals.begin(), request.ordinals.end());
        return request;
    }

    if (!bitset->is_string())
        return refuseFill();

    const auto decoded = decodeBase64(bitset->get<std::string>());
    if (!decoded.ok)
        return refuseFill();

    for (size_t byteIndex = 0; byteIndex < decoded.bytes.size(); ++byteIndex) {
        for (int bit = 0; bit < 8; ++bit) {
            if (!(decoded.bytes[byteIndex] & (1u << bit)))
                continue;

            const uint64_t ordinal = byteIndex * 8 + static_cast<uint64_t>(bit);
            if (!inRange(ordinal))
                return refuseFill();

            request.ordinals.push_back(static_cast<uint32_t>(ordinal));
        }
    }

    return request;
}

std::string libraryDocument(const Library::State& state) {
    return json{{"ready", state.ready},
                {"structure", state.structure},
                {"revision", state.revision},
                {"trackCount", state.trackCount},
                {"columns", state.columns}}
        .dump();
}

std::string libraryRefusedDocument(const LibraryRequest& request) {
    return json{{"error", describe(request.refusal)}, {"detail", request.detail}}.dump();
}

std::string libraryFailedDocument(DeltaOutcome outcome) {
    return json{{"error", describe(outcome)}, {"detail", ""}}.dump();
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
