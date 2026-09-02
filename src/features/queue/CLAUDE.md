# The queue panel

What the user has explicitly queued, drawn as the stretch of time it occupies.
General rules are in the root `CLAUDE.md`; the state, the mutations and the
measured player behaviour behind them are in `src/domain/player/CLAUDE.md`.

**The panel is a timetable, not a list of songs, and that is the one idea in it.**
A rail runs from *now* down through everything that is going to play. Each cover
sits *on* the rail as a tick rather than beside it, and the gap under a row grows
with how long that track runs, so the shape of the next twenty minutes is legible
before a single title is read. Every row says when it will play -- `in 2:41`, `in
6:03`.

**It is honest only because Jean's queue is exhaustive.** foobar2000 takes the
whole queue, in order, before it returns to the playlist, and it consumes an entry
the moment that track starts -- both measured. So the arithmetic is exact rather
than an estimate, and there is nothing unaccounted for between one tick and the
next. A streaming client's queue trails off into an infinite implicit tail, which
is precisely why none of them can do this and why it was worth building.

**The empty state is the feature, not the fallback.** An empty queue means nothing
has been asked for -- *not* that nothing will play -- and the panel says that in
words, because the two are easy to confuse and only one of them is true. It is
always openable. The gesture hint is chosen by `(pointer: coarse)` rather than by
width, for the reason the keyboard-shortcuts button is: a narrow desktop window
still has a right mouse button and a phone at any width does not.

**Nothing in here is what is playing.** By the time a track is playing it has left
the queue, so the head of the rail is the *current track's remaining time* instead
-- which is also what the first countdown is measured from. Without that origin the
first `in 3:42` looks invented.

**The status bar button and the menu action share one glyph, `ListEnd`.** Its
mirror, `ListStart`, draws the one thing foobar2000 will not do -- `queueIndex` is
ignored on add, so there is no inserting at the front -- and the badge sits in
exactly the top-right corner where `ListStart` puts its arrow, which leaves three
lines and a stray tick. `ListEnd`'s arrow is bottom-right, clear of it. The reuse
across a surface and an action is deliberate: one glyph means *the queue*, and
what it does is given by where it is.

## Things that will bite

**The countdowns are their own leaf, on a shared clock.** `queueClock.ts` is a
module-level store with one interval behind it, subscribed through
`useSyncExternalStore`. Lifting the tick into the panel would re-render every row
-- artwork, drag transforms and all -- once a second to move a handful of
characters, which is the same reason `Times` is a leaf in the status bar. The clock
stops entirely while playback is not playing, because the numbers are then standing
still.

**Row keys are identities, never positions.** They double as `useSortableList`'s
`keys` (which it joins to notice a drop has landed) and as React's key. Position
would satisfy the first and break the second: a reorder would remount every row
below the drop and re-request its artwork. Reordering identities reorders the join
just as well. The `#n` occurrence counter is load-bearing -- the same track can be
queued twice, and two rows sharing a key animate to the wrong places.

**`--stretch` is set inline and the sortable hook owns `transform` on the same
element.** So the row's `style` is composed after the spread rather than replacing
it; passing `style` before `{...merged}` silently loses the rail segment.

**An orphaned entry is drawn, not hidden.** When a queued track is removed from its
playlist the entry stays, reporting `itemIndex: -1`, and its `columns` hold garbage
rather than nothing -- one probe came back titled `NEIN`. Hiding it would leave a
gap in a numbering the player still honours and Jean could not explain, so it is
drawn as the fault it is, with a button to be rid of it. Branch on the index; never
on the columns.

**The grip is for coarse pointers only.** A mouse drags the row itself, which is
what `useSortableList` does everywhere else in the app. On touch the vertical axis
already belongs to the scroller and the hold-then-drag gesture is spent on the
context menu, so nothing but an explicit handle can claim it -- and the remove
button becomes permanent alongside it, because there is no hover to reveal either.
