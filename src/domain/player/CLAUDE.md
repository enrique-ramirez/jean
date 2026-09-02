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

**Position updates arrive only on change events, so the progress display
interpolates locally** (`position.ts`). `<SeekBar>` runs the animation-frame loop and
is deliberately a leaf -- that state must never be lifted, or it will one day repaint
a virtualised 30k-row list sixty times a second.
