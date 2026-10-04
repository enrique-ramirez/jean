#include "core/session_audio.h"

#include <algorithm>
#include <utility>

namespace jean {

GainSource replayGainSourceFor(GainSetting setting, SessionOrder order) {
    switch (setting) {
        case GainSetting::none:
            return GainSource::none;
        case GainSetting::track:
            return GainSource::track;
        case GainSetting::album:
            return GainSource::album;
        case GainSetting::byPlaybackOrder:
            break;
    }

    const bool playsAlbums = order == SessionOrder::inOrder || order == SessionOrder::repeatAll;
    return playsAlbums ? GainSource::album : GainSource::track;
}

ChainFlags chainFlagsFor(ChainRun run) {
    ChainFlags flags;

    switch (run) {
        case ChainRun::audio:
            break;
        case ChainRun::trackEnd:
            flags.endOfTrack = true;
            break;
        case ChainRun::lastTrackEnd:
            flags.endOfTrack = true;
            flags.handBack = true;
            break;
        case ChainRun::afterCut:
            flags.flushFirst = true;
            break;
    }

    return flags;
}

StreamMark markOf(const Turn& turn) {
    StreamMark mark;
    mark.path = turn.track.path;
    mark.subsong = static_cast<int>(turn.track.subsong);
    mark.position = turn.from;
    return mark;
}

double markLeadSeconds(bool cut, double chainLatencySeconds, double waitingSeconds) {
    if (cut)
        return 0;

    return std::max(0.0, chainLatencySeconds + waitingSeconds);
}

void MarkPlacer::pending(StreamMark mark, double latencySeconds) {
    pending_ = std::move(mark);
    untilAudible_ = latencySeconds;
}

std::optional<StreamMark> MarkPlacer::take(double blockSeconds) {
    if (!pending_)
        return std::nullopt;

    if (untilAudible_ > 0) {
        untilAudible_ -= blockSeconds;
        return std::nullopt;
    }

    std::optional<StreamMark> laid = std::move(pending_);
    pending_.reset();
    laid->position -= untilAudible_;
    return laid;
}

}  // namespace jean
