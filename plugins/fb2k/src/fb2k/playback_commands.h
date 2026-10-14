#pragma once

#include "core/main_thread_queue.h"
#include "core/player.h"
#include "core/player_state.h"

namespace jean {

class PlaylistVersions;

PlaylistRowPlayer makePlaylistRowPlayer(MainThreadQueue& mainThread, PlayerStateStore& store,
                                        PlaylistVersions& versions);
TransportCommander makeTransportCommander(MainThreadQueue& mainThread);
PlaybackSeeker makePlaybackSeeker(MainThreadQueue& mainThread);
PlaybackOrderSetter makePlaybackOrderSetter(MainThreadQueue& mainThread);
VolumeSetter makeVolumeSetter(MainThreadQueue& mainThread);
VolumeStepper makeVolumeStepper(MainThreadQueue& mainThread);
MuteSetter makeMuteSetter(MainThreadQueue& mainThread);

}  // namespace jean
