#pragma once

#include "core/player.h"
#include "fb2k/main_thread.h"

namespace jean {

TransportCommander makeTransportCommander(MainThreadQueue& mainThread);
PlaybackSeeker makePlaybackSeeker(MainThreadQueue& mainThread);
PlaybackOrderSetter makePlaybackOrderSetter(MainThreadQueue& mainThread);
VolumeSetter makeVolumeSetter(MainThreadQueue& mainThread);
VolumeStepper makeVolumeStepper(MainThreadQueue& mainThread);
MuteSetter makeMuteSetter(MainThreadQueue& mainThread);

}  // namespace jean
