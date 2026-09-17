#include "core/playlists.h"

#include "core/json.h"
#include "core/library.h"
#include "core/text.h"

#include <algorithm>
#include <limits>

using nlohmann::json;

namespace jean {

namespace {

constexpr size_t kMaxKey = 256;
constexpr size_t kMaxQuery = 4096;

AutoPlaylistRequest refuse(PlaylistRefusal refusal, std::string detail) {
    AutoPlaylistRequest request;
    request.refusal = refusal;
    request.detail = std::move(detail);
    return request;
}

bool isLowerHex(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
}

}  // namespace

TextField readText(const json& root, const char* key, size_t limit, Need need) {
    const std::string named = std::string("'") + key + "'";
    const auto field = readString(root, key);

    if (field.wrongType)
        return {named + " must be a string", {}};

    if (need == Need::required && (!field.present || field.value.empty()))
        return {named + " is required", {}};

    if (field.value.size() > limit || !isPrintable(field.value)) {
        return {
            named + " must be printable text of at most " + std::to_string(limit) + " characters",
            {}};
    }

    return {{}, field.value};
}

PlaylistResult playlistFailure(PlaylistOutcome outcome, std::string detail) {
    PlaylistResult result;
    result.outcome = outcome;
    result.detail = std::move(detail);
    return result;
}

PreviewResult previewFailure(PlaylistOutcome outcome) {
    PreviewResult preview;
    preview.outcome = outcome;
    return preview;
}

bool isPlaylistId(const std::string& id) {
    constexpr char kShape[] = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";

    if (id.size() != sizeof(kShape) - 1)
        return false;

    return std::equal(id.begin(), id.end(), std::begin(kShape),
                      [](char c, char shape) { return shape == '-' ? c == '-' : isLowerHex(c); });
}

bool looksLikeBeefwebId(const std::string& id) {
    return !id.empty() && id.size() <= 32 && id.front() == 'p' &&
           std::all_of(id.begin() + 1, id.end(), [](char c) { return c >= '0' && c <= '9'; });
}

std::optional<PlayingLocation> queuedLocation(
    size_t playlist, size_t item, const std::function<std::string(size_t)>& playlistIdAt) {
    constexpr size_t kInfinite = std::numeric_limits<size_t>::max();

    if (playlist == kInfinite || item == kInfinite)
        return std::nullopt;

    return PlayingLocation{playlistIdAt(playlist), static_cast<uint32_t>(item)};
}

bool keyTaken(const std::vector<PlaylistAnnotation>& playlists, const std::string& key,
              const std::string& exceptId) {
    if (key.empty())
        return false;

    return std::any_of(
        playlists.begin(), playlists.end(), [&key, &exceptId](const PlaylistAnnotation& playlist) {
            return playlist.managed && playlist.managed->key == key && playlist.id != exceptId;
        });
}

PlaylistResult roomForAnotherAutoPlaylist(const std::vector<PlaylistAnnotation>& playlists,
                                          int maxAutoPlaylists) {
    const auto managed =
        std::count_if(playlists.begin(), playlists.end(),
                      [](const PlaylistAnnotation& p) { return p.managed.has_value(); });

    if (managed < maxAutoPlaylists)
        return PlaylistResult{};

    return playlistFailure(PlaylistOutcome::tooMany,
                           "this install allows " + std::to_string(maxAutoPlaylists) +
                               " and already has " + std::to_string(managed));
}

AutoPlaylistRequest parseAutoPlaylist(const std::string& body, Need title) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuse(PlaylistRefusal::malformedBody, document.error);

    const auto& root = document.value;

    const auto askedTitle = readText(root, "title", kMaxTitle, title);
    if (!askedTitle.ok())
        return refuse(PlaylistRefusal::badTitle, askedTitle.why);

    const auto askedQuery = readText(root, "query", kMaxQuery, Need::required);
    if (!askedQuery.ok())
        return refuse(PlaylistRefusal::badQuery, askedQuery.why);

    const auto askedSort = readText(root, "sort", kMaxQuery, Need::optional);
    if (!askedSort.ok())
        return refuse(PlaylistRefusal::badSort, askedSort.why);

    const auto askedKey = readText(root, "key", kMaxKey, Need::optional);
    if (!askedKey.ok())
        return refuse(PlaylistRefusal::badKey, askedKey.why);

    AutoPlaylistRequest request;
    auto& spec = request.spec;
    spec.title = askedTitle.value;
    spec.query = askedQuery.value;
    spec.sort = askedSort.value;
    spec.key = askedKey.value;

    if (const auto forceSort = root.find("forceSort"); forceSort != root.end()) {
        if (!forceSort->is_boolean())
            return refuse(PlaylistRefusal::malformedBody, "'forceSort' must be true or false");
        spec.forceSort = forceSort->get<bool>();
    }

    return request;
}

AutoPlaylistRequest parseQueryPreview(const std::string& body) {
    const auto document = parseJsonObject(body);
    if (!document.ok())
        return refuse(PlaylistRefusal::malformedBody, document.error);

    // Required, so an empty query is refused rather than previewed: foobar2000 reads it as
    // "everything", and the whole library is a confusing answer to an empty box.
    const auto asked = readText(document.value, "query", kMaxQuery, Need::required);
    if (!asked.ok())
        return refuse(PlaylistRefusal::badQuery, asked.why);

    AutoPlaylistRequest request;
    request.spec.query = asked.value;
    return request;
}

std::string serialiseAutoPlaylist(const AutoPlaylistSpec& spec) {
    const json record{{"key", spec.key},
                      {"query", spec.query},
                      {"sort", spec.sort},
                      {"forceSort", spec.forceSort}};
    return record.dump();
}

AutoPlaylistSpec parseStoredAutoPlaylist(const std::string& stored) {
    AutoPlaylistSpec spec;

    const auto document = parseJsonObject(stored);
    if (!document.ok())
        return spec;

    const auto& root = document.value;
    spec.key = readString(root, "key").value;
    spec.query = readString(root, "query").value;
    spec.sort = readString(root, "sort").value;

    if (const auto forceSort = root.find("forceSort");
        forceSort != root.end() && forceSort->is_boolean()) {
        spec.forceSort = forceSort->get<bool>();
    }

    return spec;
}

std::string describe(PlaylistRefusal refusal) {
    switch (refusal) {
        case PlaylistRefusal::none:
            return "ok";
        case PlaylistRefusal::malformedBody:
            return "malformed request";
        case PlaylistRefusal::badTitle:
            return "unacceptable title";
        case PlaylistRefusal::badKey:
            return "unacceptable key";
        case PlaylistRefusal::badQuery:
            return "unacceptable query";
        case PlaylistRefusal::badSort:
            return "unacceptable sort";
        case PlaylistRefusal::badId:
            return "unacceptable playlist id";
        case PlaylistRefusal::badOrdinals:
            return "unacceptable ordinal set";
        case PlaylistRefusal::tooFast:
            return "too many requests";
    }
    return "unknown";
}

std::string describe(PlaylistOutcome outcome) {
    switch (outcome) {
        case PlaylistOutcome::done:
            return "done";
        case PlaylistOutcome::queryInvalid:
            return "foobar2000 could not read that query";
        case PlaylistOutcome::noSuchPlaylist:
            return "no such playlist";
        case PlaylistOutcome::positionPastEnd:
            return "that position is past the end";
        case PlaylistOutcome::notOurs:
            return "that playlist was not created by foo_jean";
        case PlaylistOutcome::keyInUse:
            return "another playlist already has that key";
        case PlaylistOutcome::tooMany:
            return "this install's autoplaylist limit is reached";
        case PlaylistOutcome::structureMoved:
            return describe(DeltaOutcome::structureChanged);
        case PlaylistOutcome::queueMoved:
            return "the queue changed since that revision; read it again";
        case PlaylistOutcome::playerRefused:
            return "the player could not do that";
        case PlaylistOutcome::timedOut:
            return "the player did not answer in time";
        case PlaylistOutcome::unavailable:
            return "autoplaylists are not available";
        case PlaylistOutcome::writesDisabled:
            return "this install has playlist writes turned off; turn on writePlaylists in "
                   "config.json to allow them";
    }
    return "unknown";
}

}  // namespace jean
