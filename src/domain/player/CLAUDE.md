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

**The progress bar reads what is audible, in one branch in one place.** A device
listening to the stream is a second or two behind the player, so a bar driven
from beefweb alone runs ahead of the sound. `listeningPosition` answers null
whenever it cannot be sure -- not listening, no anchor yet, or a mark naming a
track beefweb has already moved on from -- and null means drive it from beefweb
exactly as before. It is read per animation frame rather than pushed, because
`currentTime` advances continuously and a store notifying on it would repaint the
app sixty times a second.

The anchor is `streamTime - roundTrip - currentTime`, re-derived after every
reconnect (`currentTime` restarts) and re-polled every ten seconds to shed drift.
**The `currentTime` term is not decoration**: browsers disagree over whether it
starts at zero or at the stream's own granule position, which for a listener
joining a long-running stream is a large number, and subtracting it is what makes
the arithmetic work either way. `marks[].path` arrives in the player's own form
-- `file-relative://..\Musica\...` on a portable install, not a drive letter --
so it is matched against **what beefweb reports** and never against an assumed
path.

**The toggle is per device and is never synced.** Not through `clientconfig`, not
through anything `useStoredState` might one day sync. Two devices decide for
themselves, and one device's button must never silence another's. It is not
persisted across a reload either: autoplay policy would block the reconnect
anyway.

**Position updates arrive only on change events, so the progress display
interpolates locally** (`position.ts`). `<SeekBar>` runs the animation-frame loop and
is deliberately a leaf -- that state must never be lifted, or it will one day repaint
a virtualised 30k-row list sixty times a second.
