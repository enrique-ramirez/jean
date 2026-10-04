#pragma once

#include "core/main_thread_queue.h"
#include "core/session.h"
#include "core/settings.h"
#include "fb2k/player_audio_settings.h"

namespace jean {

// `stop` never needs the main thread. `audio` MUST outlive the returned stream's stop.
SessionStream startSessionStream(Session& session, MainThreadQueue& mainThread,
                                 const Settings& settings, double bufferSeconds,
                                 const PlayerAudioSettings& audio);

}  // namespace jean
