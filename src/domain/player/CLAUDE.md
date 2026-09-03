# The player

Playback state and the controls over it. General rules are in the root `CLAUDE.md`.

**Shuffle is two controls, not one.** The *mode* is global player state and lives
in the status bar, left of the transport -- quiet until it is on, and one of it
rather than one per view. The queue button is its mirror on the right, and the
pair is what centres Play in the group: order is the rule the transport follows
when nothing is queued, and the queue is what overrides it. The *action* lives in a playlist header next to Play,
where it reads as "play these, shuffled", and that is all it does: start a random
track and turn the mode on. Two requests. Verified against the live player:
`POST /player/play/{plref}/{index}` makes that playlist the active one, and
Shuffle (tracks) then draws from it -- p5 index 3, then 953, 540, 218, never
leaving p5. So the mode does the shuffling and the action only opens the door.

The play queue was the other candidate for *that* and is still worse for it.
`/playqueue/add` takes one item per request with no bulk form -- measured, both
`{items:[…]}` and an array `itemIndex` return 400 -- so any set means hundreds of
calls behind a lookahead cap nobody can see the edge of, and it would have to
clobber whatever the user had queued to mean anything. That argument is about
playing a *set*, and it has not changed. The queue as a feature in its own right
is below, and none of it contradicts this: the user puts a handful of tracks
there deliberately, and Jean never writes to it on their behalf.

## The queue

**Jean shows what was queued and nothing else, and that is a design position
rather than a limitation to apologise for.** The player will not say what it
would otherwise play next -- there is no lookahead in the API -- so a "next from
this playlist" section would be Jean guessing, and it would be wrong the moment
playback order was anything but Default. An empty queue means *nothing has been
asked for*, not *nothing will play*, and the panel says so in those words.

**That constraint is what makes the panel's one real idea possible.** Because the
queue is finite, ordered and exhaustive -- measured, foobar2000 takes all of it
before returning to the playlist -- the time until any entry plays is exact
arithmetic rather than an estimate, so every row can say *when*. A streaming
client cannot do this: its queue trails off into an infinite implicit tail. The
rail in `features/queue` is drawn to that scale, gap proportional to duration,
which is the whole reason it does not look like everyone else's queue.

**The queue is consumed, so what is playing is never in it.** An entry leaves the
moment its track starts -- measured. There is therefore no "now playing" row to
draw, and no risk of the panel disagreeing with the status bar about what is on.

**A reorder is a rebuild, because there is no insert.** `queueIndex` is accepted
and *silently ignored* on `/playqueue/add` -- 204, appended anyway -- so moving an
entry means removing everything from the earlier of the two positions and adding
it back in the new order. Three things follow, and all three are in `useQueue`:

- **Only the tail is rebuilt.** Everything above `min(from, to)` is untouched, so
  a drag near the bottom is cheap and a drag from the top is not.
- **The queue is re-read before the plan is built.** This is the one operation
  whose arithmetic cannot survive being stale -- a track ending mid-drag consumes
  the head and shifts every index under it -- so a queue that moved is refused
  rather than half-applied. Same discipline as `useAddTracks` re-reading
  `itemCount`, and for the same reason.
- **The stream is held for the length of a mutation.** The player genuinely passes
  through every intermediate state and genuinely pushes each one; drawn, the panel
  sheds its rows and grows them back. `holdQueue` lives in `queue.ts` with no React
  and no import of `usePlayer`, because both `usePlayer` (which drops the pushes)
  and `useQueue` (which takes the hold) need it -- reaching across for it made
  those two modules import each other.

**Deleting a playlist the queue points into crashes the player**, so
`dequeuePlaylist` clears it first and the delete is abandoned if it cannot. That
guard is in `usePlaylistActions.remove` rather than in the sidebar, because it is
a property of the operation: the next caller would not know to repeat it, and the
failure mode is the whole of foobar2000. The measurement and the crash report are
in `API.md`.

**The fader is linear in perceived loudness, not in decibels or in amplitude.**
+10 dB is about twice as loud, so the fraction becomes `max + 10 * log2(f)`: half
the slider is half as loud and a quarter is a quarter as loud. Equal distances are
equal *ratios* of loudness wherever they are taken from, which is the only promise a
fader makes.

It replaced squaring the distance from the top -- the same instinct applied far too
hard, which put the midpoint at -25 dB and 15% at **-72 dB**, silence rather than
quietness, so the bottom third of the travel did nothing and the top third did all of
it: ten points from 70 to 80 crossed 5 dB while ten from 10 to 20 crossed 17 dB of
inaudible nothing. Linear in *amplitude* (`20 * log10(f)`, roughly macOS) fails the
other way on a range reaching -100 -- the midpoint lands at -6 dB and everything under
-26 dB is crammed into the bottom twentieth.

## Listening on this device

**It is a handoff, not a second speaker.** The sound is in one place and the
control says which -- the player, or this browser. That is why it is drawn as a
two-row picker rather than a "listen here too" toggle: the player is meant to go
quiet while a listener is attached, so there is only ever one answer to draw, and
releasing hands it back. The one idea worth taking from Roon's zone menu and
Sonos's room tray is that you read *where* it is playing without opening
anything, which is what the collapsed icon does. Deliberately **not** a cast
glyph: casting pushes audio away to a box you are not holding, and this moves it
to the device you are.

**Muting the player is the component's job, not Jean's, and it is not built
yet.** So today both play at once: the sound arrives here and the player's
speakers carry on. An earlier draft made it an explicit toggle beside the picker
on the argument that automatic muting becomes a reference count once there are
two listeners. It does -- and the component is where that count actually lives,
so it is the only place that can get it right. Jean sends no mute and reads
none, and must not grow one: a client counting listeners it cannot see would be
the bug that argument predicts.

**Only two devices can be named, and that is the whole list.** "This device" is
always true on the device you are holding and needs no label and no user-agent
string; the player has a name because `player.info` carries one. *Other*
listeners cannot be named at all -- the component counts connections for
`maxConcurrentStreams` and publishes nothing about them, an IP is not a name, and
a UA string is both banned here and useless. Naming them needs a component route
(a listener count, or a label each client sends with its ticket), not a guess
here.

**The seam is `listener.ts` and the connection is `listenerStore.ts`.** Nothing
outside those two asks which listener it holds: a control renders or it does not,
and the reason is `canListen`. `canStream` **absent means false**, so an older
component gets no button rather than a button that fails. A component that offers
only codecs this browser cannot decode resolves to *none* as well -- the same
rule as an empty write allowlist being indistinguishable from no component.

**The codec is chosen by `canPlayType` and the server's order, and there is no
user-agent string anywhere in it.** The server's order is the quality order; the
client only *excludes*. `canPlayType` returns `''`, `'maybe'` or `'probably'` and
only `''` is a real answer, so nothing ranks by it. Two traps: bare `audio/ogg`
can answer for Vorbis alone, so the codecs parameter is not optional, and
`MediaSource.isTypeSupported` answers a different question about a thing this
does not use. **Detection picks the order and failure picks the next** --
`canPlayType` lies in both directions -- so a format that fails with
`MEDIA_ERR_DECODE` or `MEDIA_ERR_SRC_NOT_SUPPORTED` is written off for the
session and the next one is tried.

**`error.code` is the only thing separating "cannot play this" from "the Wi-Fi
dropped"**, and they want opposite responses. But it cannot separate either from
a refused ticket: the component answers 401 identically for a missing, unknown
and expired ticket on purpose, and that reaches the element as the same
`MEDIA_ERR`. So when every format is exhausted the message says *"could not play
the stream"* and offers Try again, rather than naming a cause it is guessing at.

**A stalled live stream does not fire `error`.** It fires `stalled` and
`waiting`, or nothing at all. If `currentTime` has not advanced for a few seconds
while the element believes it is playing, something is wrong and nothing else
will say so -- so a watchdog asks beefweb which of the two it is. **A stopped
player and a broken stream are identical from the stream**: you get the container
headers and then silence, with no error and no timeout. "foobar2000 is stopped"
and "could not reach the stream" are different sentences and only one of them is
Jean's fault.

**One fader, one target at a time.** The capture is taken *before* foobar2000's
volume -- measured -- so while the sound is on this device the status bar's fader
is provably dead: dragging it changes nothing anyone can hear. It therefore
**retargets** rather than growing a second one beside it, and says which it is
pointed at. The device is presented on the same decibel scale the player uses so
one fader law serves both; `audio.volume` is an amplitude multiplier at the other
end of that conversion and is not a scale to put in front of anybody. Where the
platform will not have it at all -- iOS, where `audio.volume` is a documented
no-op -- the control is not drawn, and the picker says the hardware keys own it.
That is **probed, never sniffed**: set `0.5`, read it back.

**No Web Audio, and no `crossorigin`.** A `GainNode` would trade background
playback for a volume slider, because the context is suspended when the screen
locks. `crossorigin` makes the media request CORS-checked for no benefit and is
only needed for Web Audio.

**Tickets are asked for immediately before connecting, never stored and never
logged.** A ticket is good until it expires rather than once -- Safari sends a
`Range: bytes=0-1` probe before fetching for real, so one playback start is two
requests. A reconnect takes a fresh one. The bearer token stays in a header and
never reaches a URL. **Never open a second element to probe with**: Safari
already holds two connections per listener and `maxConcurrentStreams` counts
connections, not people.

**`play()` after an `await` has lost its user gesture**, so a rejection with
`NotAllowedError` degrades to a control the user presses synchronously. One extra
tap, and it is the only thing that works. Holding a ticket in advance would avoid
it and is not worth the unused tickets until the tap proves annoying.

**The screen reads what is audible, in one branch in one place.** A device
listening to the stream is a second or two behind the player, so anything drawn
from beefweb alone runs ahead of the sound -- and it is the *track*, not only the
position, that runs ahead: beefweb names the next one while the last is still
coming out of the speaker, so the title, the artwork, the lyrics and the row
highlight all change a beat early. Nothing is slow; one thing is early, which on
a screen is the same complaint.

`audible.ts` is that seam. It keeps the last four player snapshots, keyed by
track, and hands back the one describing what `listenerStore` says is audible;
`useAudiblePlayer` is what every surface drawing the current track reads, and it
returns the live snapshot **by object identity** whenever nothing is listening,
so an install without the component is untouched. `listeningPosition` is the same
correction for the position and still answers null whenever it cannot be sure,
which still means drive it from beefweb -- but its caller now passes the audible
path, so the mark matches through the transition instead of falling back inside
it. It is read per animation frame rather than pushed, because `currentTime`
advances continuously and a store notifying on it would repaint the app sixty
times a second. The *identity* is pushed, on `timeupdate` and only when it
changes: the path is stable for the length of a track.

**Only `activeItem` is delayed, and that line is the design.** Volume,
`playbackState`, permissions and `info` are the player's rather than the track's
and have no buffered copy running late. Delaying them would mean a Pause pressed
here not moving for a second and a half -- trading this lag for a worse one, on a
control the user touched themselves. So a track change is held and a transport
press is not, and the two are asserted separately.

**A whole-API throttle was the other candidate and is worse three ways.** It
would delay writes that have no audio behind them and fight the optimistic
patches in `usePlayer`; it would freeze a figure that moves on every reconnect
and rebuffer, which is why the timeline is re-polled at all; and a timer delays
the *snapshot* rather than the audio, so it only lines up if the buffer is
exactly what it was when measured. Releasing on "the audio reached this track"
needs no figure and self-corrects.

**The anchor is the component's clock at the moment of connection, and nothing
else.** `BroadcastRing::subscribe` hands a new listener the **live edge** -- no
backlog, no priming burst -- and the stream is then delivered at 1x. So the first
sample this element renders *is* the audio that was live when it connected, and:

```
anchor  = streamTimeAtConnect - buffered.start(0)
audible = anchor + currentTime
```

`buffered.start(0)` is the timebase origin rather than a depth: browsers disagree
over whether `currentTime` starts at zero or at the stream's own granule
position, and this is that number whichever it turned out to be. Fixed **once per
connection** and never re-derived -- both terms are constant, so a later poll
would only add noise. The poll refreshes the *marks*.

**But it is retried until it takes, and that is not the same thing.** The two
terms become available in either order -- a timeline response and the element's
first buffered range -- so the derivation runs on `playing`, on every
`timeupdate` and on every poll, and no-ops once set. Computing it from a single
request at connect and giving up was worse than the bug it replaced: one lost
response left a whole session with **no correction at all**, and a null anchor is
indistinguishable on screen from not listening. The stream clock runs at 1x with
the wall clock -- measured -- so any later answer carries back to the connection
and nothing is lost by asking again.

**The lag is never measured, which is the point.** It falls out as wall time
since connecting minus audio played, so it is whatever the browser spent
buffering to start plus whatever it has stalled for since, and it corrects itself
without being told: a rebuffer stops `currentTime` and the lag grows on its own.

**Subtracting a measured buffer depth was the previous form, and it under-read so
badly it was nearly a no-op.** `bufferedEnd - currentTime` counts only what the
media pipeline has ingested. The audio the server sends while the element is
still buffering to *start* sits in the socket, which no browser reports -- and on
a live stream that startup gap is most of the lag. The seek bar looked corrected
and the lyric, which is where a second actually shows, did not.

**Three things measured against the real component, all of which this rests on.**
Taken by reading Ogg granule positions off the wire:

- **`streamTime` is the live edge.** It tracks beefweb's reported position to
  within **50-90 ms**, so the encoder sits at the speaker and none of the lag is
  upstream.
- **Delivery is exactly 1x with a constant offset** -- granule advanced 11.52 s
  over 11.61 s of wall clock, holding to ±50 ms from the first sample. Nothing
  accumulates on the wire, so every second of lag is the browser's.
- **The component keeps encoding through a pause**, 5.52 s of audio over 5.58 s
  of wall clock with the player stopped. See the paragraph on not pausing the
  element, which is the same fact pointed at a different mistake.

**Everything that draws the passage of time must read `audibleAt`, and the lyric
is why that is written as a rule.** It had its own animation-frame loop calling
`positionAt` directly while the correction lived in the seek bar's private
helper, so the one surface where a second is most visible -- a line lighting up
before it is sung -- was the only surface the correction never reached. The
helper lives in `position.ts` beside `positionAt`, which is where the second
caller would have found it.

**The marks go stale two ways and both are silent.** A **track change** lays a
mark, and a **seek** lays another -- the same stream time now means a different
place in the track. `audible.ts` asks for a refresh on each, because it is the
one place that already tells a new track from a fresh snapshot of the same one,
and a seek from the interpolation drifting. Left to the ten-second poll a
2.8-second lag was drawn as **8.3**: the correction was right and arrived late,
which on a screen is indistinguishable from being wrong.

**`__jeanStream()` in a dev console prints the whole clock** -- anchor,
`currentTime`, the buffered range, the marks and `lagSeconds`, which is what the
correction actually comes to. It exists because this is the one part of Jean
whose correctness cannot be read off the screen: too early and exactly right look
identical unless the lag is already known, and the port the numbers come from is
not reachable from every machine this gets debugged on. Dev only, and stripped
from a build.

**A stream that has not started is not a stream that has stalled**, and the two
want opposite responses -- reconnecting restarts the very buffering a slow start
is waiting on, so a browser needing longer than `STALL_MS` to reach its first
sample loops and never plays. `START_MS` is the longer wait that applies until
the first sample. The *stopped* check still runs at `STALL_MS`, because naming
that state costs nothing and is not destructive; only giving up waits.

**`marks[].path` and beefweb's `%path%` are the same file under two different
names, and comparing them exactly killed the entire feature.** *Measured* on a
portable install: beefweb answers `F:\Musica\J\...` and the component answers
`file-relative://..\Musica\J\...` for that identical track, because the profile
sits beside the library rather than under `%APPDATA%`. Exact comparison is
`false` forever -- and a failed match reads as *cannot say*, so every correction
downstream turned itself off while `phase`, `anchor`, `lagSeconds` and
`audiblePath` all stayed healthy. On screen it was indistinguishable from the
feature never having been built: the trackbar never once stepped back.

So `samePlayerPath` matches by **suffix**, the way `libraryPathMatcher` already
does and for the same reason -- the two sources root the same file differently,
Jean is never told where either root is, and the tail is what survives that. It
strips a scheme and any leading traversal, then anchors on a separator so
`Live.mp3` cannot match `Alive.mp3`.

**The suite was green through all of it, and that is the lesson.** Both halves of
every fixture came from one string, so the fake compared a path with itself and
could not fail. `componentPath` in `test/fake-api/fooJean.ts` now rewrites the
component's answers into the portable form: with it in place, reverting the
matcher fails the two correction specs, which is the only reason to trust them.
**Anywhere the fake supplies both sides of a comparison, it has to supply them
the way the two real sources do -- or the comparison is untested.**

**Jean must not pause the element when the player pauses, however much the
handoff argues for it.** Pressing pause leaves a second or so of sound coming out
of this device -- the buffer draining -- and pausing the element would stop it
dead. *Measured*: the component **keeps encoding at 1x through a pause**, 5.52
seconds of audio over 5.58 seconds of wall clock with the player stopped. So a
paused element would go on filling, and resume however long the pause lasted
further behind. The tail is the buffer, it is the component's to shorten, and
this is the second thing on this screen that only the component can fix.

**The transport itself is not slow and should not be tuned as though it were.**
*Measured* against the live player: the button flips in **17-29 ms**, because the
patch is optimistic and `playbackState` is never delayed. Anything that still
feels late after a press is the audio, and the paragraph above says why.

**The toggle is per device and is never synced.** Not through `clientconfig`, not
through anything `useStoredState` might one day sync. Two devices decide for
themselves, and one device's button must never silence another's. It is not
persisted across a reload either: autoplay policy would block the reconnect
anyway.

**Position updates arrive only on change events, so the progress display
interpolates locally** (`position.ts`). `<SeekBar>` runs the animation-frame loop and
is deliberately a leaf -- that state must never be lifted, or it will one day repaint
a virtualised 30k-row list sixty times a second.
