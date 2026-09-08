# The queue panel

What the user has explicitly queued, drawn as the stretch of time it occupies. The state, the mutations and the player behaviour behind them are in `src/domain/player/CLAUDE.md`.

**The panel is a timetable, not a list of songs.** A rail runs from *now* down through everything that will play; the gap under a row grows with how long that track runs. **The arithmetic is exact rather than an estimate only while the queue stays exhaustive**, since foobar2000 takes the whole queue, in order, before returning to the playlist.

**Nothing in here is what is playing.** By the time a track is playing it has left the queue, so the head of the rail is the *current track's remaining time* instead, which is also what the first countdown is measured from.

**An empty queue means nothing has been *asked for*, not that nothing will play**, and the panel says so in words. It is always openable.

**Queueing opens it, which is why there is no toast about queueing.** Reasoning in `src/domain/player/CLAUDE.md`.

**The docked panel is put away only when it is asked to be**: the toggle, Escape, the close button, or a flick to the right. It stays up while the app is used behind it, which is what makes it somewhere to drag tracks into. **The overlay takes a press outside as well**, since a scrim that answers nothing reads as a fault. The flick is horizontal, matching the entrance: `touch-action: pan-y` keeps the browser from taking the other axis for back-navigation, and **the drag grip is marked `data-owns-touch`.** Without it the sideways drift of a row dragged down the panel reads as the flick that closes it.

**Escape closes it, and it is the front layer whenever it is up.** It takes Escape on the capture phase, since the playlist scope binds Escape to clearing a track selection and a bubbling handler would answer first, closing the panel and wiping the selection behind it in one keystroke. **A capture listener does not stop its siblings on `window`**, so standing down is each layer's own job: the layers above gate on whether the queue is open, and the queue gates on `keyboardOwner`. The press-outside rule needs the toggle button excluded, or the press outside closes what the click then reopens.

**On a desktop Escape unpins the docked panel**, which is furniture rather than an overlay and is restored between sessions.

## The drop targets

The button is a drop target, and the only one outside the sidebar and the panel. The id it registers is namespaced so it cannot collide with a playlist id. Two things about it are not the sidebar's rules:

- **It announces itself the moment a drag begins**, where a sidebar row stays quiet until the pointer is on it. There is exactly one target here and it is a small glyph that nothing says accepts tracks.
- **Its hit area grows to roughly a thumb while a drag is in flight**, through a pseudo-element with a negative inset. `elementFromPoint` reports the originating element, so the hit test climbs from the button as usual. Only mid-drag, or it would take a strip out of its neighbour for the whole session.

**A drop past the queue limit arms anyway and fails with a sentence.** A drop target cannot say why in a disabled label, so refusing to light up would be a silent no. Both routes have to produce the same message.

**The panel names the gap rather than itself.** Each row carries two zones, its halves, and every zone is a *separate* drop target with the insertion index in its id: `dnd.ts` publishes which target is under the pointer and nothing finer, and a pointer position in that store would notify the app on every frame. Two things follow from the shape:

- **The zones sit over the row's own children, and the scroller is the target of last resort.** Without the zones on top, a pointer on the artwork climbs to the scroller and the line jumps to the end of the queue while it is plainly on a row; without the scroller, a pointer in the space below the last row aims at nothing.
- **A drop into the middle costs the tail, and a drop at the end costs nothing.** There is no insert, so it is the rebuild a reorder is. `../../domain/player/CLAUDE.md` has the plan and why only the insert re-reads the queue first.

## Things that will bite

**The countdowns are their own leaf, on a shared clock.** `queueClock.ts` is a module-level store with one interval behind it. Lifting the tick into the panel would re-render every row, artwork and drag transforms and all, once a second to move a handful of characters. The clock stops entirely while playback is not playing.

**Row keys are identities, never positions.** They double as the sortable hook's keys, which it joins to notice a drop has landed, and as React's key. Position would satisfy the first and break the second: a reorder would remount every row below the drop and re-request its artwork. **The occurrence counter in the key is load-bearing.** The same track can be queued twice, and two rows sharing a key animate to the wrong places.

**The rail segment is set inline and the sortable hook owns `transform` on the same element.** Compose the row's `style` *after* the spread; passing it before silently loses the segment.

**An orphaned entry is drawn, not hidden.** When a queued track is removed from its playlist the entry stays, reporting `itemIndex: -1`, and its columns hold garbage rather than nothing. Hiding it would leave a gap in a numbering the player still honours, so it is drawn as the fault it is with a button to be rid of it. **Branch on the index, never on the columns.**

**The grip is for coarse pointers only.** A mouse drags the row itself, as the sortable hook does everywhere else. On touch the vertical axis already belongs to the scroller and the hold-then-drag gesture is spent on the context menu, so nothing but an explicit handle can claim it, and the remove button becomes permanent alongside it, since there is no hover to reveal either.
