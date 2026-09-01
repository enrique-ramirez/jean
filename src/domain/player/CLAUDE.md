# The player

Playback state and the controls over it. General rules are in the root `CLAUDE.md`.

**Shuffle is two controls, not one.** The *mode* is global player state and lives
in the status bar, left of the transport -- quiet until it is on, and one of it
rather than one per view. The *action* lives in a playlist header next to Play,
where it reads as "play these, shuffled", and that is all it does: start a random
track and turn the mode on. Two requests. Verified against the live player:
`POST /player/play/{plref}/{index}` makes that playlist the active one, and
Shuffle (tracks) then draws from it -- p5 index 3, then 953, 540, 218, never
leaving p5. So the mode does the shuffling and the action only opens the door.

The play queue was the other candidate and is worse. `/playqueue/add` takes one
item per request with no bulk form -- measured, both `{items:[…]}` and an array
`itemIndex` return 400 -- so any set means hundreds of calls behind a lookahead
cap nobody can see the edge of, and it has to clobber whatever the user had
queued to mean anything.

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
