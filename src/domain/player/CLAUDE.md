# The player

Playback state, the queue, the volume curve, and listening on this device.

## Shuffle is two controls

The **mode** is global player state and lives in the status bar, left of the transport — quiet until it is on, one of it rather than one per view. The queue button is its mirror on the right, and the pair is what centres Play: order is the rule the transport follows when nothing is queued, and the queue is what overrides it.

The **action** lives in a playlist header next to Play, where it reads as "play these, shuffled". That is all it does: start a random track and turn the mode on. Two requests. `POST /player/play/{plref}/{index}` makes that playlist the active one and `Shuffle (tracks)` then draws only from it, so the mode does the shuffling and the action only opens the door.

## The queue

**Jean shows what was queued and nothing else, and that is a design position rather than a limitation to apologise for.** The player will not say what it would otherwise play next — there is no lookahead in the API — so a "next from this playlist" section would be a guess, wrong the moment playback order was anything but Default. An empty queue means *nothing has been asked for*, not *nothing will play*, and the panel says so in those words.

**That constraint is what makes the panel's one real idea possible.** The queue is finite, ordered and exhaustive — foobar2000 takes all of it before returning to the playlist — so the time until any entry plays is exact arithmetic rather than an estimate. The rail in `features/queue` is drawn to that scale.

**The queue is consumed, so what is playing is never in it.** An entry leaves the moment its track starts. There is no "now playing" row to draw and no risk of the panel disagreeing with the status bar.

**A reorder is a rebuild, because there is no insert.** `queueIndex` is accepted and *silently ignored* on `/playqueue/add` — 204, appended anyway — so moving an entry means removing everything from the earlier of the two positions and adding it back in the new order. Three things follow, all in `useQueue`:

- **Only the tail is rebuilt.** Everything above `min(from, to)` is untouched, so a drag near the bottom is cheap and a drag from the top is not.
- **The queue is re-read before the plan is built.** This is the one operation whose arithmetic cannot survive being stale — a track ending mid-drag consumes the head and shifts every index under it — so a queue that moved is refused rather than half-applied.
- **The stream is held for the length of a mutation.** The player passes through every intermediate state and pushes each one; drawn, the panel sheds its rows and grows them back. `holdQueue` lives in `queue.ts` with no React and no import of `usePlayer`, because both `usePlayer` (which drops the pushes) and `useQueue` (which takes the hold) need it.

**Deleting a playlist the queue points into crashes the player**, so `dequeuePlaylist` clears it first and the delete is abandoned if it cannot. That guard is in `usePlaylistActions.remove` rather than in the sidebar, because it is a property of the operation and the failure mode is the whole of foobar2000. Crash report in `API.md`.

## The volume fader

**Linear in perceived loudness, not in decibels or in amplitude.** +10 dB is about twice as loud, so the fraction is `max + 10 * log2(f)`: half the slider is half as loud, a quarter is a quarter as loud, and equal distances are equal *ratios* of loudness wherever they are taken from — which is the only promise a fader makes.

The two obvious alternatives both fail on a range reaching -100 dB. Squaring the distance from the top puts the midpoint at -25 dB and 15% at **-72 dB**, so the bottom third of the travel does nothing. Linear in *amplitude* (`20 * log10(f)`, roughly macOS) puts the midpoint at -6 dB and crams everything under -26 dB into the bottom twentieth.

## Listening on this device

**It is a handoff, not a second speaker.** The sound is in one place and the control says which — the player, or this browser — so it is a two-row picker rather than a "listen here too" toggle. Deliberately **not** a cast glyph: casting pushes audio away to a box you are not holding, and this moves it to the device you are.

**Muting the player is the component's job and is not built**, so today both play at once. Automatic muting becomes a reference count once there are two listeners, and the component is the only place that can see the listeners to count. **Jean sends no mute, reads none, and must not grow one.**

**Only two devices can be named.** "This device" is always true on the device you are holding, and the player has a name because `player.info` carries one. *Other* listeners cannot be named at all — the component counts connections for `maxConcurrentStreams` and publishes nothing about them, an IP is not a name, and a UA string is both banned here and useless.

**The seam is `listener.ts` and the connection is `listenerStore.ts`.** Nothing outside those two asks which listener it holds: a control renders or it does not, and the reason is `canListen`. **`canStream` absent means false**, so an older component gets no button rather than one that fails. A component offering only codecs this browser cannot decode resolves to *none* as well.

### Codecs and failures

**The codec is chosen by `canPlayType` and the server's order, and there is no user-agent string anywhere in it.** The server's order is the quality order; the client only *excludes*. `canPlayType` returns `''`, `'maybe'` or `'probably'` and only `''` is a real answer, so nothing ranks by it. Two traps: bare `audio/ogg` can answer for Vorbis alone, so the codecs parameter is not optional, and `MediaSource.isTypeSupported` answers a different question about a thing this does not use. **Detection picks the order and failure picks the next** — `canPlayType` lies in both directions — so a format failing with `MEDIA_ERR_DECODE` or `MEDIA_ERR_SRC_NOT_SUPPORTED` is written off for the session.

**`error.code` cannot separate "cannot play this" from a refused ticket.** The component answers 401 identically for a missing, unknown and expired ticket on purpose, and that reaches the element as the same `MEDIA_ERR`. So when every format is exhausted the message says *"could not play the stream"* and offers Try again, rather than naming a cause it is guessing at.

**A stalled live stream does not fire `error`.** It fires `stalled` and `waiting`, or nothing at all. If `currentTime` has not advanced for a few seconds while the element believes it is playing, a watchdog asks beefweb which of the two it is: **a stopped player and a broken stream are identical from the stream** — container headers, then silence, no error and no timeout — and "foobar2000 is stopped" and "could not reach the stream" are different sentences.

**A stream that has not started is not a stream that has stalled**, and the two want opposite responses: reconnecting restarts the very buffering a slow start is waiting on, so a browser needing longer than `STALL_MS` to reach its first sample would loop and never play. `START_MS` is the longer wait that applies until the first sample. The *stopped* check still runs at `STALL_MS`, because naming that state costs nothing.

### Tickets and the element

**Tickets are asked for immediately before connecting, never stored and never logged.** A ticket is good until it expires rather than once — Safari sends a `Range: bytes=0-1` probe before fetching for real, so one playback start is two requests. A reconnect takes a fresh one. **The bearer token stays in a header and never reaches a URL.** **Never open a second element to probe with**: Safari already holds two connections per listener and `maxConcurrentStreams` counts connections, not people.

**`play()` after an `await` has lost its user gesture**, so a rejection with `NotAllowedError` degrades to a control the user presses synchronously.

**No Web Audio, and no `crossorigin`.** A `GainNode` would trade background playback for a volume slider, because the context is suspended when the screen locks. `crossorigin` makes the media request CORS-checked for no benefit and is only needed for Web Audio.

**One fader, one target at a time.** The capture is taken *before* foobar2000's volume, so while the sound is on this device the status bar's fader is provably dead. It therefore **retargets** rather than growing a second one beside it, and says which it is pointed at. The device is presented on the same decibel scale the player uses so one fader law serves both; `audio.volume` is an amplitude multiplier at the other end of that conversion and is not a scale to put in front of anybody. Where the platform will not have it — iOS, where `audio.volume` is a documented no-op — the control is not drawn and the picker says the hardware keys own it. That is **probed, never sniffed**: set `0.5`, read it back.

**The toggle is per device and is never synced**, not through `clientconfig` and not through anything `useStoredState` might one day sync. One device's button must never silence another's. It is not persisted across a reload either, since autoplay policy would block the reconnect.

**Jean must not pause the element when the player pauses**, however much the handoff argues for it. Pressing pause leaves a second or so of sound coming out of this device — the buffer draining — and pausing the element would stop it dead. The component **keeps encoding at 1x through a pause** (5.52 s of audio over 5.58 s of wall clock with the player stopped), so a paused element would go on filling and resume however long the pause lasted further behind. The tail is the buffer, and it is the component's to shorten.

**The transport itself is not slow and should not be tuned as though it were.** The button flips in 17–29 ms, because the patch is optimistic and `playbackState` is never delayed. Anything that still feels late after a press is the audio.

### The audible clock

**The screen reads what is audible, in one branch in one place.** A device listening to the stream is a second or two behind the player, and it is the *track* as well as the position that runs ahead: beefweb names the next one while the last is still coming out of the speaker, so title, artwork, lyrics and row highlight all change a beat early.

`audible.ts` is that seam. It keeps the last four player snapshots keyed by track and hands back the one describing what `listenerStore` says is audible; `useAudiblePlayer` is what every surface drawing the current track reads, and it returns the live snapshot **by object identity** whenever nothing is listening, so an install without the component is untouched. The identity is pushed on `timeupdate` and only when it changes; the position is read per animation frame rather than pushed, because `currentTime` advances continuously and a store notifying on it would repaint the app sixty times a second.

**Only `activeItem` is delayed, and that line is the design.** Volume, `playbackState`, permissions and `info` are the player's rather than the track's and have no buffered copy running late. Delaying them would mean a Pause pressed here not moving for a second and a half. **A track change is held; a transport press is not.**

**A whole-API throttle is worse three ways** and is not the answer: it would delay writes that have no audio behind them and fight the optimistic patches in `usePlayer`; it would freeze a figure that moves on every reconnect and rebuffer; and a timer delays the *snapshot* rather than the audio, so it only lines up if the buffer is exactly what it was when measured. Releasing on "the audio reached this track" needs no figure and self-corrects.

**The anchor is the component's clock at the moment of connection, and nothing else.** `BroadcastRing::subscribe` hands a new listener the **live edge** — no backlog, no priming burst — and the stream is delivered at 1x, so the first sample this element renders *is* the audio that was live when it connected:

```
anchor  = streamTimeAtConnect - buffered.start(0)
audible = anchor + currentTime
```

`buffered.start(0)` is the timebase origin rather than a depth: browsers disagree over whether `currentTime` starts at zero or at the stream's own granule position, and this is that number whichever it turned out to be. Fixed **once per connection** and never re-derived — both terms are constant, so a later poll would only add noise. The poll refreshes the *marks*.

**But it is retried until it takes.** The two terms become available in either order — a timeline response and the element's first buffered range — so the derivation runs on `playing`, on every `timeupdate` and on every poll, and no-ops once set. One lost response would otherwise leave a whole session with **no correction at all**, and a null anchor is indistinguishable on screen from not listening.

**The lag is never measured, which is the point.** It falls out as wall time since connecting minus audio played, so it is whatever the browser spent buffering to start plus whatever it has stalled for since, and it corrects itself: a rebuffer stops `currentTime` and the lag grows on its own. **Do not subtract a measured buffer depth.** `bufferedEnd - currentTime` counts only what the media pipeline has ingested; the audio the server sends while the element is still buffering to *start* sits in the socket, which no browser reports, and on a live stream that startup gap is most of the lag.

Three facts this rests on, read off Ogg granule positions on the wire: **`streamTime` is the live edge** (within 50–90 ms of beefweb's reported position, so none of the lag is upstream); **delivery is exactly 1x with a constant offset** (granule advanced 11.52 s over 11.61 s of wall clock, holding to ±50 ms, so nothing accumulates on the wire and every second of lag is the browser's); and **the component keeps encoding through a pause**.

**Everything that draws the passage of time must read `audibleAt`.** The lyric is why that is a rule: it had its own animation-frame loop calling `positionAt` directly while the correction lived in the seek bar's private helper, so the one surface where a second is most visible was the only one the correction never reached. The helper lives in `position.ts` beside `positionAt`.

**The marks go stale two ways and both are silent.** A **track change** lays a mark, and so does a **seek** — the same stream time then means a different place in the track. `audible.ts` asks for a refresh on each, because it is the one place that already tells a new track from a fresh snapshot of the same one, and a seek from the interpolation drifting. Left to the ten-second poll a 2.8 s lag was drawn as 8.3: the correction was right and arrived late, which on a screen is indistinguishable from being wrong. The seek mark needs `foo_jean` 0.12 or later; before it, only `on_playback_new_track` was registered and a **backwards** seek left the timeline counting from before the jump. A forward seek looks correct whether or not it was marked, and so does a test written with one.

**A seek holds where it was put.** The audio it asks for is a lag away, so the bar and the lyric would otherwise snap back to what is still audible, run on from the old position, and jump. `beginSeek` freezes the display at the target until the audio arrives. **Held, not advanced**: ticking on from the target would put the display ahead of the sound and have to step back. Both entry points announce it — Jean's own seeks call `beginSeek` from the optimistic patch, and a seek from the desktop is read off the position disagreeing with the interpolation.

**`marks[].path` joins beefweb's `%path%` on equality, and the component is what makes that true.** `markOf` resolves through `g_get_display_path`, so a mark says `C:\Music\...` exactly as beefweb does; unresolved it answers foobar2000's own canonical form (`file-relative://..\Music\...` on a portable install), against which an equality test can never be true.

**A failed path match reads as *cannot say*, which is the trap.** Every correction downstream turns itself off while `phase`, `anchor`, `lagSeconds` and `audiblePath` all stay healthy — on screen indistinguishable from the feature never having been built. **If a join here quietly stops working, print the two strings before anything else.** The fake cannot catch it and must not be trusted to: both halves of its fixtures come from one string, so it compares a path with itself.

**`__jeanStream()` in a dev console prints the whole clock** — anchor, `currentTime`, the buffered range, the marks and `lagSeconds`. It exists because this is the one part of Jean whose correctness cannot be read off the screen: too early and exactly right look identical unless the lag is already known. Dev only, stripped from a build.

## Position

**Position updates arrive only on change events, so the progress display interpolates locally** (`position.ts`). `<SeekBar>` runs the animation-frame loop and is deliberately a leaf — that state must never be lifted, or it will repaint a virtualised 30k-row list sixty times a second.
