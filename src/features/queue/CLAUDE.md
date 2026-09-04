# The queue panel

What the user has explicitly queued, drawn as the stretch of time it occupies. The state, the mutations and the player behaviour behind them are in `src/domain/player/CLAUDE.md`.

**The panel is a timetable, not a list of songs, and that is the one idea in it.** A rail runs from *now* down through everything that will play. Each cover sits *on* the rail as a tick rather than beside it, and the gap under a row grows with how long that track runs, so the shape of the next twenty minutes is legible before a title is read. Every row says when it will play — `in 2:41`, `in 6:03`.

**It is honest only because the queue is exhaustive.** foobar2000 takes the whole queue, in order, before returning to the playlist, and consumes an entry the moment that track starts. So the arithmetic is exact rather than an estimate. A streaming client's queue trails off into an infinite implicit tail, which is why none of them can draw this.

**Nothing in here is what is playing.** By the time a track is playing it has left the queue, so the head of the rail is the *current track's remaining time* instead — which is also what the first countdown is measured from. Without that origin the first `in 3:42` looks invented.

**Queueing opens it, which is why there is no toast about queueing.** Reasoning in `src/domain/player/CLAUDE.md`. The cost is that queueing several tracks one at a time is now press, queue, press away, queue — a fair trade for the confirmation being the thing itself, and the press away is the same gesture at every width.

**The empty state is the feature, not the fallback.** An empty queue means nothing has been *asked for*, not that nothing will play, and the panel says so in words. It is always openable. The gesture hint is chosen by `(pointer: coarse)` rather than by width: a narrow desktop window still has a right mouse button and a phone at any width does not.

**A press anywhere outside puts it away, at every width, and so does a flick up or down.** The panel is opened around whatever you were doing — by the button, or by queueing a track — so the way out is wherever you look next rather than a target to find. On a phone the scrim takes that press; on a desktop the press lands on the app behind, which stays live. The flick fires only from the end of the scroll it would otherwise be, the app's rule everywhere, and either direction works because a panel with a short queue is at both ends at once. **The grip is marked `data-owns-touch`** — without it a row dragged up the panel is read as the flick that closes it.

**It does not take Escape.** Taking Escape and claiming the keyboard are one job, and this panel deliberately leaves the app behind it live; `Q` closes it from the keyboard. That is what `useDismissable`'s `onEscape: false` is for, and its `ignore` is the other half — the toggle is in the status bar, a panel away, so the press outside would close what the click then reopened.

**The status bar button and the menu action share one glyph, `ListEnd`.** Its mirror `ListStart` would draw the one thing foobar2000 will not do — `queueIndex` is ignored on add, so there is no inserting at the front — and its arrow sits exactly where the badge does. One glyph means *the queue*; what it does is given by where it is.

## The drop target

The button is a drop target, and the only one outside the sidebar. Dragging rows onto it queues them through the same `useQueueTracks` the menu action runs; `dnd.ts` hit-tests opaque ids, so the queue takes one (`QUEUE_DROP_TARGET`, in `domain/player/queue.ts`, namespaced so it cannot collide with a playlist id). Two things about it are not the sidebar's rules:

- **It announces itself the moment a drag begins**, where a sidebar row stays quiet until the pointer is on it. That rule exists because there are dozens of rows and lighting them all up is a wall of boxes; here there is exactly one target and it is an 18px glyph that nothing says accepts tracks.
- **Its hit area grows to roughly a thumb while a drag is in flight**, via a pseudo-element with a negative inset — `elementFromPoint` reports the originating element, so the hit test climbs from the button as usual. Only mid-drag, or it would take a strip out of Next for the whole session. A miss on a 34px button costs the entire gesture, not a click.

**A drop past `QUEUE_LIMIT` arms anyway and fails with a sentence.** A menu can say why in a disabled label; a drop target cannot, so refusing to light up would be a silent no. `useQueueTracks` carries that message and both routes produce the same one.

## Things that will bite

**The countdowns are their own leaf, on a shared clock.** `queueClock.ts` is a module-level store with one interval behind it, subscribed through `useSyncExternalStore`. Lifting the tick into the panel would re-render every row — artwork, drag transforms and all — once a second to move a handful of characters. The clock stops entirely while playback is not playing, because the numbers are then standing still.

**Row keys are identities, never positions.** They double as `useSortableList`'s `keys` (which it joins to notice a drop has landed) and as React's key. Position would satisfy the first and break the second: a reorder would remount every row below the drop and re-request its artwork. The `#n` occurrence counter is load-bearing — the same track can be queued twice, and two rows sharing a key animate to the wrong places.

**`--stretch` is set inline and the sortable hook owns `transform` on the same element.** Compose the row's `style` after the spread; passing `style` before `{...merged}` silently loses the rail segment.

**An orphaned entry is drawn, not hidden.** When a queued track is removed from its playlist the entry stays, reporting `itemIndex: -1`, and its `columns` hold garbage rather than nothing. Hiding it would leave a gap in a numbering the player still honours, so it is drawn as the fault it is with a button to be rid of it. **Branch on the index, never on the columns.**

**The grip is for coarse pointers only.** A mouse drags the row itself, as `useSortableList` does everywhere else. On touch the vertical axis already belongs to the scroller and the hold-then-drag gesture is spent on the context menu, so nothing but an explicit handle can claim it — and the remove button becomes permanent alongside it, because there is no hover to reveal either.
