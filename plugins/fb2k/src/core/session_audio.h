#pragma once

#include "core/session.h"
#include "core/session_order.h"
#include "core/timeline.h"

#include <optional>

namespace jean {

enum class GainSetting { none, track, album, byPlaybackOrder };
enum class GainSource { none, track, album };

GainSource replayGainSourceFor(GainSetting setting, SessionOrder order);

enum class ChainRun { audio, trackEnd, lastTrackEnd, afterCut };

// `endOfTrack` is the SDK's END_OF_TRACK. `handBack` is its FLUSH on the same run, which hands
// buffered audio back. `flushFirst` is dsp_manager::flush() before the run, which discards it.
struct ChainFlags {
    bool endOfTrack = false;
    bool handBack = false;
    bool flushFirst = false;
};

ChainFlags chainFlagsFor(ChainRun run);

StreamMark markOf(const Turn& turn);

double markLeadSeconds(bool cut, double chainLatencySeconds, double waitingSeconds);

class MarkPlacer {
public:
    void pending(StreamMark mark, double latencySeconds);

    std::optional<StreamMark> take(double blockSeconds);

private:
    std::optional<StreamMark> pending_;
    double untilAudible_ = 0;
};

}  // namespace jean
