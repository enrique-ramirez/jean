# The player

Playback state, the play queue, the volume curve, and listening to the player's own output on this device. The player's wire surface and its traps are in [../../shared/api/README.md](../../shared/api/README.md).

## Shuffle is two controls

The **mode** is global player state, one of it rather than one per view. The **action** in a view's header only starts a random track and turns the mode on. Playback order draws from the *active* playlist, so playing a track makes that playlist active and the mode does the shuffling.

## The queue

What the queue is, and everything the player does with it, is `../../shared/api/README.md`. Three consequences shape what Jean draws.

**The player will not say what it would otherwise play next**, so an empty queue means *nothing has been asked for*, not *nothing will play*.

**The queue being exhaustive is what makes the timetable exact** rather than an estimate.

**The queue being consumed is why there is no "now playing" row to draw**, and no risk of the panel disagreeing with the status bar.

**Queueing opens the panel and raises no toast on success.** The row the track lands on is the undo; an undo carried on a toast would be a range built from the queue length before its own write, so with several on screen only the newest could still be applied. Errors do toast.

**Every queue change reaches `foo_jean` as one request, with no local copy to keep or reconcile.** `../../shared/api/README.md`, *What Jean does about the queue*, has the shape and what a stale revision answers.

**A rollback restores its snapshot only if the cache still holds what the mutation was taken against**, checked off a revision inside the data for the queue and off a sibling cache key for the playlist list, so neither ever wipes out a change that landed while the mutation was in flight.

**A playlist delete asks the queue nothing**: a queued entry outlives the playlist it pointed into, and `plugins/fb2k/ARCHITECTURE.md`'s *Facts about the player* has what foobar2000 does with it and what reading one carelessly costs.

**Queueing checks whether `foo_jean` can be reached, not what beefweb's `changePlaylists` permits.** Every queue mutation goes through the component rather than through beefweb, so one gate covers a library row, a playlist row, a move, a remove and a clear alike.

## The volume fader

**Linear in perceived loudness, not in decibels or in amplitude.** About +10 dB is twice as loud, so half the slider is half as loud and equal distances are equal *ratios* of loudness wherever they are taken from.

**The floor is the player's and has to be mapped onto the end of the travel.** The curve approaches zero without reaching it, so the level the player calls silence lands somewhere above the bottom of the fader unless it is normalised there. foobar2000 and DeaDBeeF report different floors, and without the normalisation the thumb on one of them stops short of the end and a drag to the bottom springs back up. A player reporting `min === max` has no travel to describe and reads as empty.

## Listening on this device

**Pressing a row moves the sound rather than adding to it**: the component mutes the player while anybody is listening. Playing on both is reached by raising the player's own fader, and **the handoff MUST stay the default**, because the stream runs behind the player, so both outputs in one room is slapback.

**Silencing the player is the component's job and Jean never does it itself.** The mute is reference counted over the whole audience rather than over one connection, because the component is the only place that can see the listeners to count. **Jean sends no mute and must not grow one**; it *reads* one. The component's rule is the one to design against: **a hold it sees undone is not taken again until everybody stops.**

**foobar2000 has no mute flag**, so this is not a hidden state Jean has to be told about: mute is the volume at its floor, and the component computes it from that floor and publishes the result as `muted` beside the volume. That is why the player's row can be drawn from the volume alone, and why a client still needs telling whether a listener is what silenced the player.

**A reconnect is not a departure, and only the client can tell them apart.** Both close the socket, so the component waits out a linger before unmuting; posting a leave collapses it, which is what makes pressing the player's row give the sound back at once rather than seconds later. Best effort: a closed tab says nothing and is noticed a moment later anyway.

**Count devices, never connections**, for the reason `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*, gives. The identity rides the ticket request, since an `<audio>` element sends no body and no header of its own, which also means a rename lands on the next connection rather than at once.

**A device names itself, and a browser cannot learn the name of its machine.** `device.ts` guesses at the *kind* from the UA client hints, falling back to `navigator.platform` and `maxTouchPoints`, and Settings is where anyone who cares writes something better. **That is not the user-agent detection this codebase bans**: nothing branches on it, and a label is wrong in a way its owner can see and fix in one field. **`crypto.randomUUID` is secure-context only** and Jean is routinely served over plain HTTP on a LAN, so the device id comes from `getRandomValues`, which is not restricted that way.

**The component never leaves a silent player behind**, and Jean must not build anything that assumes otherwise: the level from the start of a session comes back when the last listener stops, whether the silence was the hold's or a fader somebody dragged down mid-stream.

**`audience.ts` polls only while there is something to say**: the picker is open, this device is listening, or the player reads as muted and somebody is owed a reason. An install where none of those is true sends nothing at all. The lag figure is sampled on the same tick rather than published, since it moves continuously and a store notifying on it would repaint the app.

**The seam is `listener.ts` and the connection is `listenerStore.ts`.** Nothing outside those two asks which listener it holds: a control renders or it does not, and the reason is `canListen`. **A missing capability flag means false**, so an older component gets no button rather than one that fails. A component offering only codecs this browser cannot decode resolves to no listener as well.

### Codecs and failures

**The codec is chosen by `canPlayType` and the server's order, and there is no user-agent string anywhere in it.** The server's order is the quality order; the client only *excludes*. `canPlayType` returns `''`, `'maybe'` or `'probably'` and only `''` is a real answer, so nothing ranks by it. Two traps: bare `audio/ogg` can answer for Vorbis alone, so the codecs parameter is not optional, and `MediaSource.isTypeSupported` answers a different question about a thing the element path does not use. **Detection picks the order and failure picks the next**, because `canPlayType` lies in both directions, so a format failing with a decode or source error is written off for the session.

**`error.code` cannot separate "cannot play this" from a refused ticket.** The component answers 401 identically for a missing, unknown and expired ticket on purpose, and that reaches the element as the same error. So when every format is exhausted the message must say the stream could not be played and offer Try again, rather than naming a cause it is guessing at.

**A stalled live stream does not fire `error`.** It fires `stalled` and `waiting`, or nothing at all. So a watchdog notices that `currentTime` has stopped advancing while the element believes it is playing, and then reads the poll's own `playbackState` to tell the two apart: **a stopped player and a broken stream are identical from the stream**: container headers, then silence, no error and no timeout, and those are different sentences.

**A stream that has not started is not a stream that has stalled**, and the two want opposite responses: reconnecting restarts the very buffering a slow start is waiting on, so a browser needing longer than the stall window to reach its first sample would loop and never play. A longer deadline applies until the first sample; the *stopped* check still runs on the shorter one.

### Tickets and the element

**Tickets are asked for immediately before connecting, never stored and never logged**, and a reconnect takes a fresh one. **The bearer token stays in a header and never reaches a URL.** **Never open a second element to probe with**: Safari already holds two connections per listener and the component's cap counts connections, not people.

**`play()` after an `await` has lost its user gesture**, so a rejection with `NotAllowedError` has to degrade to a control the user presses synchronously.

**No Web Audio, and no `crossorigin`.** A `GainNode` would trade background playback for a volume slider, since the context is suspended when the screen locks. `crossorigin` makes the media request CORS-checked for no benefit and is only needed for Web Audio.

**One fader, one target at a time.** The capture is taken *before* foobar2000's volume, so while the sound is on this device the player's fader is provably dead. The control **retargets** rather than growing a second one beside it, and says which it is pointed at. The device is presented on the same decibel scale the player uses, with `audio.volume` as an amplitude multiplier at the other end of that conversion. Where the platform will not have it, as on iOS where `audio.volume` is a documented no-op, the control is not drawn and the picker says the hardware keys own it. That is **probed, never sniffed**: set a value, read it back.

**Everything that moves the volume goes through one hook**, and nothing else asks which target it holds, so a key cannot end up moving a control the ear cannot reach. The keys carry their own step, since the player's own up and down routes are inaudible while the sound is here; the player's row in the picker is the deliberate exception and reads the player's volume directly.

### The low-latency path

**It changes the container, not the audio.** The Opus packets are demuxed out of the Ogg stream and re-wrapped in WebM for MSE, untouched, so the buffer is Jean's rather than the browser's, and on a stream delivered at 1x, whatever the browser decides to gather before starting is lag for the rest of the session.

**Ogg is not an MSE container in any browser**, which is the whole reason a muxer exists:

| | `webm; opus` | `mp4; mp4a.40.2` | `mp4; flac` | `ogg; opus` |
|---|---|---|---|---|
| Chromium | yes | yes | yes | no |
| Firefox | yes | yes | yes | no |
| Safari (macOS) | **yes** | yes | no | no |

**Safari takes WebM/Opus in MSE while refusing to play Opus in an element at all**, so one muxer serves all three and there is no fMP4 path to write. **Do not take this from Playwright's WebKit**, which reports Ogg as supported and is not Safari.

**Two questions, not one: what the element can play, and what can be reached.** `playsNatively` asks the first and `isPlayable` asks the second, since the element is handed WebM and never sees the Ogg the component sent. Collapsing them is what keeps Safari off Opus: `canPlayType` for Ogg Opus is empty there and the format is filtered out before the remux can be offered it.

**Retiring the remux can retire a format with it.** Where a format was reachable only through the remux, falling back to the element would hand it a container it cannot decode, so retiring the path marks that format dead too and the reconnect picks the next one.

**The demuxer and the muxer MUST survive a flush.** The Opus header arrives once, at the top of the stream, so a demuxer started again mid-stream waits for a header that is never coming and the pump goes silent for good, which looks exactly like a stall. A flush drops the buffered range and nothing else.

**Removing the buffer leaves the playhead in the hole it made**, and the element will sit there waiting for audio that was thrown away on purpose. The next append has to move `currentTime` to the new buffered start. Firefox rebuffers more than once over the seconds after a flush where Chromium recovers in one.

**The origin is known on this path rather than measured.** The muxer's clock starts at zero on connect, so the low-latency path passes zero rather than reading a buffered range that the trim moves forward every few seconds. A timeline answer arriving after the first trim would otherwise anchor against a number that had already moved.

**On by default means it has to fail over, and there are two ways it can fail.** A stream it cannot demux never produces a first sample, so the stall counter, which needs one to tell a buffer running dry from a stream that was never going to play, cannot see it; noticing that no Ogg page ever arrived is what catches that, with a start deadline as the backstop for everything else. Repeated stalls retire the path for the session, and a flush empties the buffer on purpose, so stalls just after one are not counted.

**A fallback is held for the session and never written to the setting.** The stored key says what to *try* and a separate flag says what happened: rewriting somebody's preference to record a bad network is how a setting comes to mean nothing. Settings says so rather than showing a switch that is on while the plain path is running.

**The toggle is per device and is never synced**, not through `clientconfig` and not through anything `useStoredState` might one day sync. One device's button must never silence another's. It is not persisted across a reload either, since autoplay policy would block the reconnect.

**The e2e fake serves WAV, so it exercises the fallback and not the path.** The demuxer and the muxer are covered by the unit tests, which need no runner and no dependency since both modules import nothing.

**Jean must not pause the element when the player pauses**, however much the handoff argues for it. Pressing pause leaves a second or so of sound coming out of this device as the buffer drains, and pausing the element would stop it dead. The component **keeps encoding at 1x through a pause**, so a paused element would go on filling and resume however long the pause lasted further behind. The tail is the buffer, and it is the component's to shorten.

**The transport itself is not slow and should not be tuned as though it were.** The patch is optimistic and `playbackState` is never delayed. Anything that still feels late after a press is the audio.

### The audible clock

**The screen reads what is audible, in one branch in one place.** A device listening to the stream is behind the player, and it is the *track* that runs ahead, not just the position: the poll names the next one while the last is still coming out of the speaker, so title, artwork, lyrics and row highlight would all change a beat early.

`audible.ts` is that seam, and it returns the live snapshot **by object identity** whenever nothing is listening, so an install without the component is untouched. The audible track is pushed only when it changes; the *position* is read per animation frame rather than pushed, since `currentTime` advances continuously and a store notifying on it would repaint the app on every frame.

**Only `activeItem` is delayed.** Volume, `playbackState`, permissions and player info are the player's rather than the track's and have no buffered copy running late. **A track change is held; a transport press is not.** A whole-API throttle is not the substitute: a timer delays the *snapshot* rather than the audio, so it lines up only while the buffer is what it was when the timer was chosen.

**The anchor is the component's clock at the moment of connection, and nothing else.** The component hands a new listener the **live edge**, with no backlog and no priming burst, and delivers at 1x, so the first sample this element renders *is* the audio that was live when it connected:

```
anchor  = streamTimeAtConnect - buffered.start(0)
audible = anchor + currentTime
```

`buffered.start(0)` is the timebase origin rather than a depth: browsers disagree over whether `currentTime` starts at zero or at the stream's own granule position, and this is that number whichever it turned out to be. Fixed **once per connection** and never re-derived, because both terms are constant, so a later poll would only add noise. The poll refreshes the *marks*.

**But it is retried until it takes.** The two terms become available in either order, so the derivation has to run on several events and no-op once set. One lost response would otherwise leave a whole session with **no correction at all**, and a null anchor is indistinguishable on screen from not listening.

**The lag is never measured.** It falls out as wall time since connecting minus audio played, so it corrects itself: a rebuffer stops `currentTime` and the lag grows on its own. **Do not subtract a measured buffer depth.** `bufferedEnd - currentTime` counts only what the media pipeline has ingested; the audio the server sends while the element is still buffering to *start* sits in the socket, which no browser reports, and on a live stream that startup gap is most of the lag.

Three facts this rests on, all properties of the component rather than of one network: **the stream time it reports is the live edge**, so none of the lag is upstream; **delivery is exactly 1x with a constant offset**, so nothing accumulates on the wire and every second of lag is the browser's; and **it keeps encoding through a pause**.

**Everything that draws the passage of time MUST read the corrected position**, the lyric included. The helper lives beside the interpolation in `position.ts`.

**The marks go stale two ways and both are silent.** A **track change** lays a mark, and so does a **seek**, after which the same stream time means a different place in the track. `audible.ts` asks for a refresh on each, since it is the one place that already tells a new track from a fresh snapshot of the same one, and a seek from the interpolation drifting. Left to the poll, a correction that is right but late is indistinguishable on screen from one that is wrong. The seek mark needs a recent enough `foo_jean`; without it a **backwards** seek leaves the timeline counting from before the jump, while a forward seek looks correct whether or not it was marked, and so does a test written with one.

**A seek holds where it was put.** The audio it asks for is a lag away, so the bar and the lyric would otherwise snap back to what is still audible, run on from the old position, and jump. `beginSeek` freezes the display at the target until the audio arrives. **Held, not advanced**: ticking on from the target would put the display ahead of the sound and have to step back. Both entry points announce it: Jean's own seeks from the optimistic patch, and a seek from the desktop read off the position disagreeing with the interpolation.

**A mark's path joins the poll's own `player.path` on equality, and the component is what makes that true.** It resolves the display path, so a mark spells it exactly as the poll does; unresolved it would answer foobar2000's own canonical form, against which an equality test can never be true.

**A failed path match reads as *cannot say*, which is the trap.** Every correction downstream turns itself off while the anchor, the lag and the phase all stay healthy, on screen indistinguishable from the feature never having been built. **If a join here quietly stops working, print the two strings before anything else.** The fake cannot catch it and MUST not be trusted to: both halves of its fixtures come from one string, so it compares a path with itself.

**`__jeanStream()` in a dev console prints the whole clock.** This is the one part of Jean whose correctness cannot be read off the screen: too early and exactly right look identical unless the lag is already known. Dev only, stripped from a build.

## The gap a skip leaves

**That gap is beefweb's, and `foo_jean`'s own state never had it.** `on_playback_stop` in `plugins/fb2k/src/fb2k/playback_watch.cpp` returns early for the outgoing track of a change, so the identity the poll answers, title, path, artwork, stands until the next track's `on_playback_new_track` replaces it, with nothing empty in between. `../../shared/api/README.md` has beefweb's own version of the trap, real for a client reading `activeItem` from beefweb directly; nothing in `ui/src` does.

## Which way a skip went

**foobar2000 never says which way a track change moved.** `on_playback_new_track` hands over only the new handle, and `on_playback_stop`'s `stop_reason_starting_another` says a change is happening and not which way, so `foo_jean` has nothing to relay. `shared/api/playback.ts`'s `takeSkipAsked` holds the direction from the moment a caller asks for a skip until the cover wheel reads it back, because the wheel has to turn before the player has answered anything.

## Position

**Position updates arrive only on change events, so the progress display interpolates locally** (`position.ts`). The seek bar runs the animation-frame loop and is deliberately a leaf. That state must never be lifted, or it will repaint a virtualised list on every frame.
