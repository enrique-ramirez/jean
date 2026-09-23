#pragma once

#include "core/http_server.h"
#include "fb2k/main_thread.h"

// The half of the eleven playback commands that touches foobar2000: each hops to the main
// thread through tellPlayer and never touches playback_control or playlist_manager off it.
namespace jean {

TransportCommander makeTransportCommander(MainThreadQueue& mainThread);
PlaybackSeeker makePlaybackSeeker(MainThreadQueue& mainThread);
PlaybackOrderSetter makePlaybackOrderSetter(MainThreadQueue& mainThread);
VolumeSetter makeVolumeSetter(MainThreadQueue& mainThread);
VolumeStepper makeVolumeStepper(MainThreadQueue& mainThread);
MuteSetter makeMuteSetter(MainThreadQueue& mainThread);

}  // namespace jean
