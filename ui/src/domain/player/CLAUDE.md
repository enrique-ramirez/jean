# The player

`ui/ARCHITECTURE.md`, *Listening on this device*, is how the stream, the audible clock and the low-latency path fit together.

## Playback

- Shuffle is the player's one global mode. A view's Shuffle action starts a random track in it and turns the mode on.
- Position arrives only on change, so `position.ts` interpolates, and the seek bar is the leaf that runs the frame loop. Lifting that state repaints the list on every frame.
- The fader is linear in perceived loudness. The player's floor, -100 dB on foobar2000, is mapped onto the end of the travel, or the thumb stops short of the bottom. `min === max` reads as empty.

## Listening here

- `listener.ts` is the seam and `listenerStore.ts` the connection; nothing else asks which listener it holds. A missing capability flag means false.
- `foo_jean` mutes the player while anybody listens, counting the whole audience. Jean sends no mute, and reads `muted` beside the volume.
- A reconnect and a departure both close the socket, so Jean posts a leave when the user gives the sound back.
- The device id comes from `shared/lib/randomId.ts`, which works outside a secure context. `device.ts` guesses the device's kind from the UA client hints to label it, and nothing branches on it.
- `audience.ts` polls only while the Playing on panel is open, this device is listening, or the player reads as muted.
- Tickets are asked for immediately before connecting and never stored or logged, and a second element is never opened to probe with, since the component caps connections.
- Jean never pauses the element when the player pauses: the buffer is still draining, and the component keeps encoding through a pause.
- No Web Audio and no `crossorigin`: a `GainNode` stops with the screen locked.
- One fader, retargeted to this device while listening. `audio.volume` support is probed by writing and reading back, never sniffed; where it fails the control is not drawn. The output device picker moves into the Playing on panel's foobar2000 row, beside the fader that still reaches it.
- Everything that moves the volume goes through one hook.
- The low-latency toggle is per device, never synced and never persisted across a reload, since autoplay policy would block the reconnect.
- The e2e fake serves WAV, so it exercises the fallback path and not the remux; the demuxer and the muxer have unit tests.
