# Tracks: rows, refs and the list

What a row is made of, the source seam that says where it came from, the virtualised list that draws it, and ratings. `ARCHITECTURE.md` has why the library is one flat set of columns, what a ref is, and how it arrives.

## Ratings

**A rating tag is a bare number with no declared scale, so the magnitude picks the scale.** One folder tree routinely holds several taggers' conventions at once with nothing in the field saying which is which, so `rating.ts` bands the raw value: unrated, foobar2000's native 0–5, the 0–10 scale, the 0–100 one FLAC's `RATING` converged on, then a POPM byte written out as text on the lopsided thresholds Windows Explorer, foobar2000 and MediaMonkey share. **Anything larger is not read as a rating, and is not clamped to five stars either.** A number that big means the field is being used for something else.

Two boundaries are genuinely ambiguous and both go to the lower, more common scale. **Do not replace the banding with one detected scale per library**: a library holding two conventions at once would have most of its ratings misread to rescue a handful.

**The rating field is `%rating%`, not `$meta(rating)`, and the difference is whose ratings Jean can see.** `foo_playcount`, the standard way to rate in foobar2000, takes over `%RATING%` and answers from its own database rather than from the files, so a user who rates in foobar's own UI has nothing in their tags and `$meta(rating)` shows an empty column. On a player without it the two return identical values. It fixes the capability probe as a side effect, since `$meta()` can never be feature-detected.

**Halves are displayed, never invented.** A file that says `3.5` gets three and a half stars; rounding it up would be Jean disagreeing with the player about what the library contains. The rating control's increment is **whole stars**, full stop: introducing halves into a library that has none is a change to somebody's tags they did not ask for. `hasHalfStars()` is the hook for offering halves where they already exist; nothing reads it yet.

**The rating column is never hidden.** A library with nothing rated yet still needs the column to rate through, so it is the one field detection does not get to remove. **Which fields resolve at all is one answer per install**, held in `fieldAvailability.ts` and refreshed from the library snapshot alone. A view never computes it from the rows in front of it: a playlist nobody has played would then hide the play count column that the shelf beside it shows. Until the library has answered nothing is ruled out, so no view opens with columns missing. **Five stars are always drawn and only the fill varies.** A row whose stars end somewhere different each time cannot be scanned down.

### Writing one

**Read on four scales, write on one.** A write has no licence to guess: Jean writes foobar2000's native 0–5 integers, so a track whose raw value is above that renders **read-only rather than rescaled**. Rescaling is not reversible from the five stars on screen and nothing about the row would show it happened. `isWritableScale()` is asked **per track**, so a library holding both conventions gets a control on the tracks it can be right about.

**The empty string removes the tag.** `"0"` would be a rating of zero, which some taggers write and others read as unrated; `""` is the component's own spelling of "there is no rating here".

**Nothing pushes a tag change, so the optimistic value is the only value.** beefweb's stream says nothing whatever when a track's tags change, so there is no update to reconcile against and no re-reading the library to learn one number. `ratingStore.ts` is that overlay, **keyed by `columns.load` and the ordinal**. That object is minted once per load and shared by every table the load publishes, so the entry survives the next chunk arriving and a delta being patched in, and disappears exactly when a fresher load replaces the rows it patches. The overlay cannot outlive the data it patches and no invalidation has to be written. The cost is that one track present in two loads is two entries, so rating it in one view leaves the other on the player's older value until that load is replaced.

**A ref is not an address, and the source it came from answers its own.** `ARCHITECTURE.md`, *The two seams*, has the two address forms and which of them wins. A rating therefore costs one request, the write, with nothing asked beforehand to find out what to write to.

**Coalesced per row, not globally.** A star clicked on a second row while the first is in flight would otherwise drop one of the two. Superseding a value on the *same* row is right.

**A 403 is a bug, not a condition.** It means the install's allowlist does not name the field, so the control should never have been offered. Log it and stop offering that field for the session. **A 504 is the one failure that is not rolled back**: the player did not answer in time and the write may still land, so the value is re-read rather than assumed lost. Everything else rolls back.

**Rating is silent on success and speaks on failure**, and the failure names the track: that is the one outcome the stars cannot show, and the digits can be pressed with the track nowhere on screen.

**A hover may not make a rated track look unrated.** Hovering a set star means "click to remove", and emptying all five makes a five-star row read as unrated with nothing clicked, so fade them instead. **Committing must drop the preview**, since the star just clicked becomes the one that would now clear. Re-arm on `pointerenter` and **not** on `pointermove`, which re-renders at the pointer's sample rate and is felt immediately as a laggy hover.

**`0`–`5` rate from anywhere and resolve their own target**: what a layer over the list is showing, else the cursor row when a track list is on screen, else the playing track. **A list stays mounted under a layer, so the layer has to take the digits with it**. `ratingTarget.ts` is where a layer publishes what it would do with a rating, and it publishes even where the value it draws is read-only, so the digits are refused there rather than falling through to the row behind. Without that, a digit pressed on the now-playing screen writes a tag to a different track, silently, with the stars on screen belonging to somebody else.

**The playing-track branch is handed in rather than resolved here**: rating the playing track means reading the copy that is *audible* and asking which scale that copy is on, and `features/now-playing` already answers both. The digits, the stars and the menu cannot come to disagree about which track is being rated or whether it may be.

**The stars in a row are a pointer control, and the menu is the other two devices'.** A star is not a touch target and the list owns keyboard focus, so touch and keyboard get a Rating page in the track menu instead. That is a *device* question, asked as `(hover: hover) and (pointer: fine)` rather than a width breakpoint: a mouse on a narrow window keeps the stars.

## The list

**Find-in-list is not the search, and every list has one.** The top-bar search filters the library down to matches and takes you elsewhere; the finder walks you to a track inside the list already on screen, changing neither its rows nor their order. `useFinder.tsx` owns the whole of it and returns the node rather than the pieces, since a caller that assembles its own is the one that will assemble it wrongly.

**Adding tracks to a playlist does not check for duplicates.** foobar2000 playlists are ordered lists, not sets; inventing a uniqueness rule the player does not have would be lying about the data. There is no cheap check available either: items have no id, so identity is `%path%`, and reading it is a request of its own before the drop could land.

**Undo instead, as the general rule for anything that writes.** The write answers exactly where the rows landed, so undo needs no path matching, and a fill by library ordinals answers the structure generation it landed at exactly as a copy does, so undo costs no extra request either way. **A `409` on the removal, not a re-read of `itemCount`, is what says the desktop changed the playlist underneath.**

### Following playback

**The list follows playback, and only when the track actually changes.** Scrolling away does not change which track is playing, so nothing re-fires and the view stays where it was put. Off for search results, whose rows change under every keystroke.

**It moves only when the row is off screen, and then it centres.** The measurement is the row against the scroll container rather than the virtualiser's index range, since **overscan mounts rows past the fold and rendered is not visible**. An unmounted row counts as off screen. Note that "only if needed" is **not** the virtualiser's `align: "auto"`, which is minimal scrolling under another name and parks the playing track against whichever edge it crossed.

That condition is on the follow effect and nowhere else. Every other jump, whether the shortcut, the pill, the finder or the now-playing header, is somebody asking to be taken to the track, and centring is the whole of what they asked for.

**A jump asked from outside the list travels as a store** (`jumpToPlaying.ts`). Three things about it:

- **Raised when the route lands, never at the click.** More than one view can locate the playing row, so a click that asked immediately would be answered by the view being left, and the view being opened would find nothing outstanding.
- **The ask stands until a list can act on it.** A route opens before its rows arrive, and a browser that cannot answer yet must not swallow it. Clearing it is the jump's own job, which is what stops a later track change reading as a second ask.
- **Independent of the follow settings.** Following is a standing preference about tracks changing; this is one instruction, given once.

**Following moves the cursor as well**, or the rating digits would write to a track chosen an hour ago while a different one plays.

**Playback follows cursor** is the other half, off by default: when the player leaves a track it plays the cursor row instead of the next one. One effect owns both, and it needs three guards:

- **Not on arrival**, or opening a view with the cursor on row 0 restarts the library.
- **Not onto the track that just ended.** With both settings on, the cursor is on the outgoing track when the incoming one arrives, so without this the pair replays one song forever. Compare against what *was* playing, not just the active index.
- **Evaluated before the cursor moves**, or cursor-follows-playback has already put the cursor on the incoming track and there is nothing left to compare.

Read the cursor through a ref; as a dependency the effect would re-run on every arrow key.

## Holding a library

The rules that are not obvious from the code, on top of the chunking in `ARCHITECTURE.md`:

- **Nothing per row is held at all.** A column is a dictionary and one id per track, both read straight out of the bytes the snapshot arrived in, and a row is built on the way out for the few dozen a screen draws. `TrackRows` is that binding of columns to a set of refs, and `rowAt()` is the only thing that materialises one.
- **Sweep the dictionary, never the rows.** Anything asking a question of the whole library reads each distinct value once and then works in integers: `byValue()` for a per-value table, `tagGrouper()` for values that fold together, `columnReader()` where one fact is spelt two ways. That is what makes the album, artist and genre indices integer grouping, and it is why `tagKey()` runs once per name rather than once per track.
- **Never hold per-track-unique strings you do not need.** Fetch `%path%` on demand for the one track that needs it, and the same for lyrics.
- **The one path Jean does have to hold is interned**, since the media library addresses a row by its path and it cannot be fetched on demand the way a rating can. `pathTable.ts` keeps a directory once and a remainder per row. Two facts about strings decide the shape: **slicing a string keeps the whole original alive**, so remainders sliced straight out of the responses cost *more* than the paths they replace and a run has to be joined into one string before the originals can go; and **a string is one byte per character only if every character in it is**, so remainders are joined in blocks rather than into one, or a single accented filename doubles the library. A read is then a concatenation rather than an array index, which is nothing outside a whole-library sweep.
- **Integers, not strings**, for dates, durations and counts. Sorting a typed array is trivial.
- **`noUncheckedIndexedAccess` is off**, so every read of a dictionary-encoded column is indexed by construction and unguarded on purpose.

### Patching one

`ARCHITECTURE.md` has where the generations live and why a cache is keyed on one. The rest is local:

- **A patched column owns its ids and stops being a view over the bytes it arrived in**, widened where the dictionary outgrew the width it was sent at. That copy is the whole cost of a patch, and it is one array per column a delta named.
- **Its dictionary is the one it already holds plus what the delta appended**, and `shared/api/CLAUDE.md` has why that is a flat array rather than a chain.
- **Anything cached across the rows declares the fields it reads.** `growingIndex` takes that list and `foldCache` has its own; both compare by column identity, so a delta naming a column nothing reads costs nothing. The list has to match what the collector actually touches: an album's play total is summed from the play count, so `albumIndex` names it and a play does rebuild that index.
- **A delta that does not fit is exported again rather than half-applied.** A moved spine leaves the path table describing the rows it was published with, a `dict.base` that is not what is held would misalign every appended id, and a column Jean did not declare means the two sides disagree about the library. `patchedColumns` answers null for all three. A playlist's own patch adds a fourth: a changed row whose `libraryPath` and `subsong` no longer match the address already held at that position means the position named something else by the time the patch arrived, so `applyPlaylistChanges` reloads the whole playlist rather than trust the ordinal. A fifth belongs to the playlist route alone: a response carrying rows but a different number of dictionaries than the columns it declared means the two sides disagree about what was asked for, and `patchedPlaylistColumns` answers null rather than index past the end. A sixth is why the cap exists at all: the changes route only deduplicates a column's values within its own response, so a slow drizzle of changes across many revisions still grows a cache entry one distinct value at a time; `MAX_APPENDED_CHARS` is the cap that catches that, and `applyPlaylistChanges` reloads once a feed's patches have crossed it.

## Rendering

**React does not virtualise.** Render every row and you get every DOM node. `content-visibility: auto` is not a substitute: it skips paint but still builds every node.

### Virtualiser traps

- **Measurements are cached by *item key*, and the default key is the index.** Two different traps come out of that and need different answers. *Different data at the same index*, such as a new set of search results where group 0 is a different album, is a **key** problem, and `getItemKey` is the answer; forcing a re-measure actively breaks it, since it runs after the refs have measured the new elements and throws those measurements away, and nothing re-measures afterwards: the measurer reports on mount and on resize only. *The same data in a different shape*, switching layout or crossing the compact breakpoint, is what an explicit `measure()` is for.
- **The virtualiser thinks its list starts at scroll offset 0.** It does not: the view header and the toolbar sit above it, and without `scrollMargin` every `scrollToIndex` lands short by exactly their height. Rendering still looks right, since rows are positioned inside a list that is itself in normal flow, and only the scroll arithmetic is wrong. `scrollMargin` MUST be measured and re-measured, since a wrapping title, stats appearing once rows load and the finder opening all move the list; and as `start` then includes it, the row transform has to subtract it back off.
- **In album mode the virtualiser's index is not the track's index.** Its items are groups, so centring index N centres the *album* and the track lands wherever it sits inside it, off screen entirely once an album is longer than the window. Centring is therefore measured off the row's own rect rather than computed from an index, falling back to the group's offset until the row is mounted. The scroll animation re-reads its target every frame, so the first frames aim at the album, that brings the row into existence, and the target refines to the track.
- **Rendered is not visible.** Anything asking "is this row on screen?" must measure the element against the scroll container.

Prefer computed sizes where they are genuinely fixed and measurement where they are not. Album group heights depend on caption wrapping and breakpoint.

### The mosaic

**It counts albums, never tracks.** Counted by tracks, a single-album playlist draws the same cover four times, since the tile count comes from the track count and the covers are picked by striding across *rows*.

**Identity is `coverIdentity()`, the same thing the artwork cache keys on, and never the picture.** Comparing bytes would mean downloading them, which is the whole cost this avoids. A row with no album tag falls back to its own artist and title, so a folder of loose singles is a wall of different covers rather than one record repeated.

**One hold for the whole mosaic, not one per tile.** `Artwork`'s per-tile placeholder is right for a single cover and wrong here: a grid of identical disc icons reads as a fault rather than as covers on their way. The tiles mount from the first frame, which is what makes them load, and stay hidden until the last has answered. `Artwork` reports through `onSettled`, from its *state* rather than from the `<img>` handlers, so the paths that never mount one report too.

### Artwork in a list

**`loading="lazy"` is not the mechanism.** It asks whether a row is visible, and a virtualised list moves rows through the viewport by the hundred: one jump across a long playlist starts an artwork request for every row it passed. What that costs is not frames, it is the rest of the app. Nothing blocks the main thread, but the browser gives an origin six HTTP/1.1 connections, and an unbounded request per row spends all of them on covers for rows that are already gone, so everything Jean asks for afterwards queues behind them. `shared/ui/artworkQueue.ts` is the answer; see `shared/ui/CLAUDE.md` for why the settle gate rather than the queue is the load-bearing half.

**A cover belongs to an album, but it is addressed per row, so ask once.** Runs are contiguous and a record's rows need not be: search results and a genre page interleave albums, so the cover is chosen by album identity rather than by adjacency. Untagged rows are grouped by their artist alone, which is as much as there is to go on. That an album has one cover was checked rather than asserted.

**There is no way to ask either server for a thumbnail**, so the request count is the only thing there is to reduce. And **an ETag being content-derived is worth knowing and never worth relying on**: an HTTP cache is keyed by URL and so never matches across two rows unless the URL is shared.

## Rows

**One gutter per row, and the wash follows it.** `TrackRow` exposes a gutter custom property and the play-count wash is derived from it rather than stated again; hardcoded, the two drift the moment a layout sets its own padding. The rule the numbers encode: **the wash's edge sits on the view's content line, and the row's content sits inside it.** Three things want that line: the number, the wash, and a gap between them, and only two can have it. The wash takes it.

**Compare tag values loosely, display them exactly.** Tags drift in case and spacing between files in the same album, and those are one artist. Anything comparing tags to decide what the user sees goes through `sameTagValue()`; anything rendering a value shows the original spelling. A strict `===` makes a track look like a guest on its own album and splits one album into two groups mid-run.

**`<Artwork>` takes a URL, not an address.** *Where* artwork lives is the source's business.

**List components take `source`, not `playlistId`.** A component wanting a playlist id for anything other than *identifying a playlist* is a sign the seam has been bypassed.

**Queueing goes through the seam too, and it is the case that justifies it.** A playlist row is queued by position, but a row read from the media library API is in no playlist at all, so the library source queues it by its handle instead: `librarySource.ts`'s two `queueTargets` build different requests for `foo_jean`'s own `/api/queue`, and `useQueueActions.queue()` is where the two converge on one call.
