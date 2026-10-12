# The player

`ui/ARCHITECTURE.md`, *Listening on this device*, is how the stream, the audible clock and the low-latency path fit together.

## Playback

- The playback order is the player's, or the session's in one, and no view keeps one of its own.
- Position arrives only on change, so `position.ts` interpolates, and the seek bar is the leaf that runs the frame loop. Lifting that state repaints the list on every frame.

## Listening here

- `listener.ts` is the seam and `listenerStore.ts` the connection; nothing else asks which listener it holds. A missing capability flag means false.
- The device id comes from `shared/lib/randomId.ts`, which works outside a secure context.
- `device.ts` guesses the device's kind from the UA client hints to label it, and nothing branches on it.
- `audience.ts` polls only while the Playing on panel is open, this device is listening, or the player reads as muted.
- Tickets are asked for immediately before connecting and never stored or logged, and a second element is never opened to probe with, since the component caps connections.
- The element pauses with the player once its buffer runs dry, or at once on a lock-screen pause: a lock screen reads the element, not `playbackState`.
- No Web Audio and no `crossorigin`: a `GainNode` stops with the screen locked.
- `audio.volume` support is probed by writing and reading back, never sniffed.
- Everything that moves the volume goes through one hook.
- The low-latency toggle is per device, never synced and never persisted across a reload, since autoplay policy would block the reconnect.
- The e2e fake serves WAV, so it exercises the fallback path and not the remux; the demuxer and the muxer have unit tests.
