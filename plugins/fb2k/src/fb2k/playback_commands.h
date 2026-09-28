#pragma once

#include "core/main_thread_queue.h"
#include "core/player.h"

namespace jean {

PlaylistRowPlayer makePlaylistRowPlayer(MainThreadQueue& mainThread);
TransportCommander makeTransportCommander(MainThreadQueue& mainThread);
PlaybackSeeker makePlaybackSeeker(MainThreadQueue& mainThread);
PlaybackOrderSetter makePlaybackOrderSetter(MainThreadQueue& mainThread);
VolumeSetter makeVolumeSetter(MainThreadQueue& mainThread);
VolumeStepper makeVolumeStepper(MainThreadQueue& mainThread);
MuteSetter makeMuteSetter(MainThreadQueue& mainThread);

}  // namespace jean
