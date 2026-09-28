#pragma once

#include "core/failures.h"

#include <string>

// What a playback, volume or output route's request asks for, decoded and refused before the
// player is asked anything. Never throws: a malformed body is routine for the HTTP handler that
// calls these.
namespace jean {

struct JsonObject;

struct SeekRequest {
    PlaybackRefusal refusal = PlaybackRefusal::none;
    std::string detail;

    double seconds = 0;
    bool relative = false;

    bool ok() const { return refusal == PlaybackRefusal::none; }
};

SeekRequest parseSeek(const JsonObject& body);

struct PlaybackModeRequest {
    PlaybackRefusal refusal = PlaybackRefusal::none;
    std::string detail;

    std::string mode;

    bool ok() const { return refusal == PlaybackRefusal::none; }
};

PlaybackModeRequest parsePlaybackMode(const JsonObject& body);

struct VolumeRequest {
    enum class Form { value, step, muted };

    PlaybackRefusal refusal = PlaybackRefusal::none;
    std::string detail;

    Form form = Form::value;
    double value = 0;
    std::string step;
    bool muted = false;

    bool ok() const { return refusal == PlaybackRefusal::none; }
};

VolumeRequest parseVolume(const JsonObject& body, double volumeMin, double volumeMax);

// POST /api/outputs/active's body: contract/openapi.yaml's ActiveOutputRequest,
// additionalProperties: false, so a field this route does not declare -- an output type in
// particular -- is refused the same as a missing or mistyped deviceId. `detail` names which,
// the way SeekRequest and PlaybackModeRequest's do.
struct ActiveOutputRequest {
    bool ok = false;
    std::string detail;
    std::string deviceId;
};

ActiveOutputRequest parseActiveOutput(const JsonObject& body);

}  // namespace jean
