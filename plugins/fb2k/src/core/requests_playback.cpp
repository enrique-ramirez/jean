#include "core/requests_playback.h"

#include "core/json.h"
#include "core/requests_playlists.h"
#include "core/text.h"

#include <array>
#include <cmath>

namespace jean {

namespace {

// A position no track reaches, so a larger one is a mistake, and far past it a double no longer
// converts to the sample count foobar2000's input seeks by.
constexpr double kMaxSeekSeconds = 1e9;

// Exactly the fields contract/openapi.yaml declares for each request body below.
constexpr std::array<const char*, 2> kSeekFields{"seconds", "relativeSeconds"};
constexpr char kModeField[] = "mode";
constexpr std::array<const char*, 1> kPlaybackModeFields{kModeField};
constexpr std::array<const char*, 3> kVolumeFields{"value", "step", "muted"};
constexpr char kDeviceIdField[] = "deviceId";
constexpr std::array<const char*, 1> kActiveOutputFields{kDeviceIdField};
constexpr char kIndexField[] = "index";

constexpr char kUndeclaredField[] = "a field this route does not take was named";

ActiveOutputRequest refuseActiveOutput(std::string detail) {
    ActiveOutputRequest request;
    request.detail = std::move(detail);
    return request;
}

}  // namespace

SeekRequest parseSeek(const JsonObject& body) {
    const auto refuse = [](std::string detail) {
        return refused<SeekRequest>(PlaybackRefusal::badSeek, std::move(detail));
    };

    if (!body.ok())
        return refuse(body.error);

    const auto& root = body.value;
    if (!declaresOnly(root, kSeekFields))
        return refuse(kUndeclaredField);

    const bool absolute = root.contains("seconds");
    const bool relative = root.contains("relativeSeconds");
    if (absolute && relative)
        return refuse("'seconds' and 'relativeSeconds' were both present; send exactly one");
    if (!absolute && !relative)
        return refuse("send exactly one of 'seconds' and 'relativeSeconds'");

    const std::string name = absolute ? "seconds" : "relativeSeconds";
    const auto& field = root.at(name);
    if (!field.is_number())
        return refuse("'" + name + "' must be a number");

    const auto seconds = field.get<double>();
    if (absolute && seconds < 0)
        return refuse("'seconds' must not be negative");
    if (!std::isfinite(seconds) || std::abs(seconds) > kMaxSeekSeconds)
        return refuse("'" + name + "' is beyond any track");

    SeekRequest request;
    request.seconds = seconds;
    request.relative = relative;
    return request;
}

PlaybackModeRequest parsePlaybackMode(const JsonObject& body) {
    const auto refuse = [](std::string detail) {
        return refused<PlaybackModeRequest>(PlaybackRefusal::badMode, std::move(detail));
    };

    if (!body.ok())
        return refuse(body.error);

    const auto& root = body.value;
    if (!declaresOnly(root, kPlaybackModeFields))
        return refuse(kUndeclaredField);

    const auto mode = root.find(kModeField);
    if (mode == root.end() || !mode->is_string())
        return refuse("'mode' is required and must be a string");

    PlaybackModeRequest request;
    request.mode = mode->get<std::string>();
    return request;
}

VolumeRequest parseVolume(const JsonObject& body, double volumeMin, double volumeMax) {
    const auto refuse = [](std::string detail) {
        return refused<VolumeRequest>(PlaybackRefusal::badVolume, std::move(detail));
    };

    if (!body.ok())
        return refuse(body.error);

    const auto& root = body.value;
    if (!declaresOnly(root, kVolumeFields))
        return refuse(kUndeclaredField);

    const int forms = (root.contains("value") ? 1 : 0) + (root.contains("step") ? 1 : 0) +
                      (root.contains("muted") ? 1 : 0);
    if (forms != 1)
        return refuse("send exactly one of 'value', 'step' and 'muted'");

    VolumeRequest request;

    if (const auto value = root.find("value"); value != root.end()) {
        if (!value->is_number())
            return refuse("'value' must be a number");

        const auto level = value->get<double>();
        if (level < volumeMin || level > volumeMax)
            return refuse("'value' must be between this install's volumeMin and volumeMax");

        request.form = VolumeRequest::Form::value;
        request.value = level;
        return request;
    }

    if (const auto step = root.find("step"); step != root.end()) {
        if (!step->is_string())
            return refuse("'step' must be 'up' or 'down'");

        const auto direction = step->get<std::string>();
        if (direction != "up" && direction != "down")
            return refuse("'step' must be 'up' or 'down'");

        request.form = VolumeRequest::Form::step;
        request.step = direction;
        return request;
    }

    const auto muted = root.find("muted");
    if (!muted->is_boolean())
        return refuse("'muted' must be a boolean");

    request.form = VolumeRequest::Form::muted;
    request.muted = muted->get<bool>();
    return request;
}

ActiveOutputRequest parseActiveOutput(const JsonObject& body) {
    if (!body.ok())
        return refuseActiveOutput(body.error);

    const auto& root = body.value;
    if (!declaresOnly(root, kActiveOutputFields))
        return refuseActiveOutput(kUndeclaredField);

    const auto deviceId = root.find(kDeviceIdField);
    if (deviceId == root.end() || !deviceId->is_string())
        return refuseActiveOutput("'deviceId' is required and must be a string");

    ActiveOutputRequest request;
    request.ok = true;
    request.deviceId = deviceId->get<std::string>();
    return request;
}

PlaySetRequest parsePlaySet(const JsonObject& body, size_t trackCount,
                            std::optional<uint64_t> expectedStructure) {
    if (!body.ok())
        return refused<PlaySetRequest>(PlaylistRefusal::malformedBody);

    JsonObject set = body;
    std::optional<nlohmann::json> index;
    if (const auto found = set.value.find(kIndexField); found != set.value.end()) {
        index = *found;
        set.value.erase(found);
    }

    const auto fill = parseFill(set, trackCount, expectedStructure);
    if (!fill.ok()) {
        PlaySetRequest request;
        request.refusal = fill.refusal;
        request.outcome = fill.outcome;
        return request;
    }

    if (!index || !index->is_number_unsigned() || !fitsUint32(index->get<uint64_t>())) {
        PlaySetRequest request;
        request.indexRefused = true;
        return request;
    }

    PlaySetRequest request;
    request.structure = fill.structure;
    request.ordinals = fill.ordinals;
    request.index = static_cast<uint32_t>(index->get<uint64_t>());

    if (request.index >= request.ordinals.size())
        request.outcome = PlayerOutcome::positionPastEnd;

    return request;
}

}  // namespace jean
