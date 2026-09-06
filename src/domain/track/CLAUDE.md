# Tracks: rows, refs and the list

The virtualised list, what a row is made of, and how the library is loaded and drawn.

## Ratings

**A rating tag is a bare number with no declared scale, so the magnitude picks the scale.** One real 30,441-track library holds 375 tracks at `5`, 39 at `100`, 40 at `-1`, 27 at `0`, 14 at `2.5` and 3 at `3.5`, spread over MP3, FLAC, Vorbis, AAC and WMA — four taggers' conventions in one folder tree, with the field saying which one nowhere. So `rating.ts` bands it: `<= 0` unrated, `<= 5` the native scale, `<= 10` the 0-10 one, `<= 100` the 0-100 one FLAC's `RATING` has converged on, `<= 255` a POPM byte written out as text. Anything larger is not read as a rating and specifically is **not clamped to five stars** — a number that big means the field is being used for something else.

Two boundaries are genuinely ambiguous: `5` is full marks natively and half marks on 0-10, `10` is full marks on 0-10 and a twentieth of 0-100. Both go to the lower, more common scale. **Detecting one scale per library is worse than banding, not better** — the library above holds `5` and `100` at the same time, so picking one would misread 375 tracks to rescue 39.

**POPM never arrives through this field, which is what makes the bands safe.** POPM is a binary ID3 frame, not text, and `%popm%` and `%rating wmp%` both return `?` — foobar2000 has no such field without a component. That matters because a 0-255 byte and a 0-100 percentage overlap on 1-100 and cannot be told apart by value: Windows Media Player's `64` is two stars as POPM and three as a percentage. If a POPM field ever does surface it needs its own column and its own scale, never this one's bands.

**The rating field is `%rating%`, not `$meta(rating)`, and the difference is whose ratings Jean can see.** `foo_playcount` — the standard way to rate in foobar2000 — takes over `%RATING%` and answers from its own database rather than from the files, so a user who rates in foobar's own UI has nothing in their tags and `$meta(rating)` shows an empty column. On a player without it the two return byte-identical values. It fixes the capability probe as a side effect: **`$meta()` returns `''` for a field that does not exist, never `?`**, so it can never be feature-detected.

**Halves are displayed, never invented.** A file that says `3.5` gets three and a half stars; rounding it to 4 would be Jean disagreeing with the player about what the library contains. Rounding to the nearest *half* is only so a rescaled value has a star to land on. The rating control's increment is **whole stars**, full stop, because introducing halves into a library that has none is a change to somebody's tags they did not ask for. `hasHalfStars()` is the hook for offering halves where they already exist; nothing reads it yet.

**The rating column is never hidden.** Ratings are sparse — 500 in 30,441 — so a 200-row sample misses them entirely about one library in twenty-five, and the column vanishing from a library that plainly has ratings is a far worse failure than a quiet column. Once ratings can be **written**, hiding the column also removes the control that would fill it. So Rating behaves like every other column: on when you ask for it, empty where there is nothing to say. **Five stars are always drawn and only the fill varies** — a row whose stars end somewhere different each time cannot be scanned down — and the empty star is `--border-strong`, because it is the one drawn most.

### Writing a rating

**Read on four scales, write on one.** A write has no licence to guess: Jean writes foobar2000's native 0-5 integers, so a track whose raw value is above 5 renders **read-only rather than rescaled**. Turning a `100` into a `5` is a 4% rating becoming four stars, it is not reversible from the five stars on screen, and nothing about the row would show it happened. `isWritableScale()` is asked **per track**, so a library holding both conventions gets a control on the tracks it can be right about. Halves stay writable.

**The empty string removes the tag.** `"0"` would be a rating of zero, which some taggers write and others read as unrated; `""` is the component's own spelling of "there is no rating here".

**Nothing pushes a tag change, so the optimistic value is the only value.** beefweb's stream says nothing whatever when a track's tags change, so there is no update to reconcile against and no re-reading the library to learn one number. `ratingStore.ts` is that overlay, **keyed by the row array itself** — rows are the arrays `playlistStore` published, so the entry disappears exactly when a fresher load replaces them. The overlay cannot outlive the data it patches and no invalidation has to be written. The cost is that one track in two loads is two arrays, so rating it in a playlist leaves `#/all` on the player's older value until that load is replaced — the staleness every other column already has.

**A ref is not a file, and `foo_jean` needs a file.** The component takes a plain absolute local path; the media library reports relative forward-slashed paths and a playlist row carries none. So `LibrarySource.identify()` resolves a ref by asking the player for `%path%` — one round trip, on a deliberate action against a single track, which is exactly the budget `%path%` was left out of `TRACK_EXPRESSIONS` to protect. It **verifies rather than trusting the index**: the library compares the relative path it already holds, the playlist compares the title, and either mismatch answers null. Indices move, and the failure mode is writing a tag to somebody else's file.

**Coalesced per row, not globally.** `useCoalescedWrite` holds one pending value, and these belong to different tracks: a star clicked on a second row while the first is in flight would drop one of the two. Superseding a value on the *same* row is right.

**A 403 is a bug, not a condition.** It means the install's allowlist does not name the field, so the control should never have been offered — log it and stop offering that field for the session. **A 504 is the one failure that is not rolled back**: the player did not answer inside its own thirty seconds and the write may still land, so the value is re-read rather than assumed lost.

**Rating is silent on success and speaks on failure.** A rating is small, reversible, one click and mostly visible; confirming it is the failure mode toasts exist for. A failure names the track, because that is the one outcome the stars cannot show and `0`-`5` can be pressed with the track nowhere on screen.

**A hover may not make a rated track look unrated.** Hovering a set star means "click to remove", and emptying all five makes a five-star row read as unrated with nothing clicked. It fades them instead. **Committing must drop the preview**, because the star just clicked becomes the one that would now clear, and leaving it armed redraws the control with no pointer movement to explain it. Re-arm on `pointerenter` and **not** on `pointermove` — the latter re-renders at the pointer's sample rate and is felt immediately as a laggy hover.

**`0`-`5` rate from anywhere and resolve their own target**: the cursor row when a track list is on screen, the playing track otherwise. Declared once in the global scope rather than in the list's scope as well — `TrackBrowser` publishes its cursor to `ratingTarget.ts` and `useRateShortcut` reads it. The cursor wins because it is marked on screen; `N` moves it to the playing track.

**The stars in a row are a pointer control, and the menu is the other two devices'.** Hovering previews and clicking commits, and clicking the star already set clears the rating, labelled "Clear rating". Twelve-pixel targets are not a touch target and the list owns keyboard focus, so touch and keyboard get a Rating page in the track menu instead. That is a *device* question, asked as `(hover: hover) and (pointer: fine)` rather than a width breakpoint: a mouse on a narrow window keeps the stars.

## The list

**Find-in-list is not the search, and every list has one.** The top-bar search filters the library down to matches and takes you to `#/search`; the finder walks you to a track inside the list already on screen, changing neither its rows nor their order. The button says which list it is searching — "Find in all music", "Find in this shelf". `useFinder.tsx` owns the whole of it — state, deferred scan, button and field — and returns the node rather than the pieces, because a caller that assembles its own is the one that will assemble it wrongly.

**Adding tracks to a playlist does not check for duplicates.** foobar2000 playlists are ordered lists, not sets; inventing a uniqueness rule the player does not have would be lying about the data. There is no cheap check available either — items have no id, so identity is `%path%`, and reading it is a request of its own before the drop could land.

**Undo instead, as the general rule for anything that writes.** Because tracks are appended, the indices just created are exactly `[itemCount, itemCount + n)`, so undo costs no extra request and needs no path matching. **Re-read `itemCount` before undoing and abandon it if it no longer matches**: the desktop may have changed the playlist underneath, and removing the wrong rows is far worse than not offering the undo.

### Following playback

**The list follows playback, and only when the track actually changes.** Scrolling away does not change which track is playing, so nothing re-fires and the view stays where it was put. Off for search results: those rows change under every keystroke.

**It moves only when the row is off screen, and then it centres.** Two rules, each arrived at separately.

*Only when off screen*, because a view that re-centres on a row you were already looking at answers a question nobody asked. `scrollToTrack`'s `ifNeeded` measures the row against the scroll container rather than reading the virtualiser's index range, because overscan mounts rows past the fold and **rendered is not visible**. An unmounted row counts as off screen. The consequence to know is that advancing no longer creeps the list by a row per track: the playing row walks down the view and the list moves once, when it reaches the edge.

*Centred*, when it does move. Minimal scrolling brings a row in from whichever edge it crossed and leaves it there, which parks the playing track on the status bar going forwards and tucks it under the sticky toolbar going backwards. Centre has no edge to land on, so direction stops mattering. Note that `ifNeeded` is **not** the virtualiser's `align: "auto"`, which is that same minimal scroll under another name; the two are opposites here.

`ifNeeded` is on the follow effect and nowhere else. `N`, the "Now playing" pill, the finder and the now-playing screen's "Playing from" line are all somebody asking to be taken to the track, and centring is the whole of what they asked for.

**That last one is asked from outside the list, so it travels as a store** — `jumpToPlaying.ts`, one boolean, raised by `App` and answered by whichever `TrackBrowser` the route lands on. Three things about it:

- **Raised when the route lands, never at the click.** More than one view can locate the playing row — All music finds the track the search results are playing — so a click that asked immediately would be answered by the view being left, and the view being opened would find nothing outstanding.
- **The ask stands until a list can act on it.** A route opens before its rows arrive, and a browser that cannot answer yet must not swallow it; it is cleared by the jump itself, which is what stops a later track change reading as a second ask.
- **Independent of the follow settings and of `canFollowPlayback`.** Following is a standing preference about tracks changing; this is one instruction, given once. It is also the only thing that takes the search results to a row.

**It moves the cursor as well**, or `0`-`5` would rate a track chosen an hour ago while a different one plays. Cursor follows playback is on by default, under `jean.followPlayback`.

**Playback follows cursor** is the other half, off by default: when the player leaves a track it plays the cursor row instead of the next one. One effect owns both, and three guards were each a bug:

- **Not on arrival**, or opening a view with the cursor on row 0 restarts the library. `followedView` holds the key the last follow was made under.
- **Not onto the track that just ended.** With both settings on, the cursor is on the outgoing track when the incoming one arrives, so without this the pair replays one song forever. Compare against `wasPlaying`, not just `activeIndex`.
- **Evaluated before the cursor moves**, or cursor-follows-playback has already put the cursor on the incoming track and there is nothing left to compare.

The cursor is read through a ref; as a dependency the effect would re-run on every arrow key.

## Loading it

At 30,441 tracks and 12 columns: 1.03 MB gzipped, 6.95 MB raw, ~680 ms fetch, ~46 ms parse. Scaling to 100k–200k needs all of the following, none of them optional:

- **Fetch in chunks (`offset:count`), but count the requests, not the rows.** A request costs ~270 ms before it returns anything and only ~30 ms more to return 2,000 rows instead of 500, so sixteen sequential chunks of 2,000 take 5.5 s where one small chunk followed by four concurrent large ones paints at ~730 ms and finishes in ~1.5 s. **Chunk for time to first paint, then go wide, and never issue many small sequential requests.** (On the media library endpoint this inverts: one small chunk to paint, then a *single* request for the rest.)
- **One load, shared.** The playlist view and search both consume it and neither may fetch its own copy. `playlistStore.ts` owns it.
- **Parse and index in a Web Worker.** A 46 ms parse at 30k is a ~300 ms main-thread freeze at 200k.
- **Dictionary-encode into columns.** Parallel `Uint32Array`s of indices into shared string tables. The fields users browse and sort by have few distinct values (743 album artists, 145 genres in a 30k library). Naive objects at 200k tracks are ~100 MB of heap; encoded columns are under 20 MB.
- **Never hold per-track-unique strings you do not need.** `%path%` alone is ~31 MB at 200k and is not needed — fetch it on demand for the one track that needs it. Same rule for lyrics.
- **Integers, not strings**, for dates, durations and counts. Sorting a typed array is sub-millisecond.
- **Persist to IndexedDB.** `structuredClone` handles TypedArrays natively, so a warm start is a buffer read. Revalidate in the background against `itemCount`.

## Rendering

**React does not virtualise.** Render 30k rows and you get 30k DOM nodes. Use TanStack Virtual for any list that can grow unbounded. `content-visibility: auto` is not a substitute — it skips paint but still builds every node.

### The mosaic

**It counts albums, never tracks.** Counted by tracks, a 21-track single-album playlist drew the same
cover four times and a two-album one drew four copies of the first while the second never appeared —
because the tile count came from the track count and the covers were picked by striding across
*rows*. One, four or nine, by how many distinct albums are actually in the set.

**Identity is album artist and title through `tagKey`, never the picture.** Comparing bytes would mean
downloading them, which is the whole cost this avoids. A row with no album tag is its own entry: a
folder of loose singles is a wall of different covers, not one record repeated.

**The figure appears only where the picture is not the whole answer** — four tiles for four albums says
everything, and `4 albums` under it repeats the tiles back. So it is drawn at 2–3, 5–8 and 10+, and
not at 1, 4 or 9.

**One hold for the whole mosaic, not nine.** `Artwork`'s per-tile placeholder is right for a single
cover and wrong here: a grid of nine identical disc icons reads as a fault rather than as covers on
their way. The tiles mount from the first frame — that is what makes them load — and stay hidden until
the last has answered, then fade in together. `Artwork` reports through `onSettled`, from its *state*
rather than from the `<img>` handlers, so the paths that never mount one (a cover already answered for
this session, an address of `null`) report too. It is the only caller that needs this.

### Artwork

**`loading="lazy"` is not the mechanism.** It asks whether a row is visible, and a virtualised list moves rows through the viewport by the hundred: one jump to the playing track across a 30,441-row playlist started **499 artwork requests** for a screen that comes to rest showing 41. What that costs is not frames, it is the rest of the app — nothing blocks the main thread, but the browser gives an origin six HTTP/1.1 connections, the update stream holds one open forever, and everything Jean asks for afterwards queues behind covers for rows that are long gone. Against a player taking 200 ms a cover, a play/pause pressed a second and a half after the jump waited 122 ms for a socket and the queue drained for 19.8 s.

`shared/ui/artworkQueue.ts` is the answer, and the load-bearing part is **time, not capacity**: a row has to still be mounted 100 ms after it appeared before it is even queued. A queue on its own is worse than nothing — against a player that answers instantly it drains as fast as the rows churn and lets every one through, measured at 1,115 requests, *more* than the native behaviour. With the settle gate the same jump costs **41 requests, one per row on screen**. Three run at a time, so the API always has connections left over, and both outcomes are remembered: a track with no embedded cover 404s, and on a mostly-uncovered library that was most of the traffic on every scroll back over ground already covered.

**A cover belongs to an album, but it is addressed per row — so ask once.** A playlist addresses artwork by index and the media library by path, so a record's twelve tracks are twelve URLs for one picture and the browser cannot know they are the same: twelve requests, identical ETag on every one, 633 KB each. `albumCoverRows` in `grouping.ts` points every row at its album run's first row, off the runs the album layout already groups for, so it costs nothing new — a 54-track, 12-album playlist goes from 54 requests to 12. That an album has one cover was checked rather than asserted, including on the most compilation-shaped runs available.

Two related facts. **The player's ETag is content-derived**, which is worth knowing and never worth relying on, because an HTTP cache is keyed by URL and so never matches across two rows unless the URL is shared. And **`Cache-Control: max-age=3, must-revalidate`** is all the player gives, so a cover redrawn more than three seconds later costs a revalidation; the fake models both, because a fake sending no headers reproduces the bug permanently and unfixably from the client. There is **no way to ask for a thumbnail** — every query parameter is ignored — which is why the request count is the only thing there is to reduce.

### Virtualiser traps

- **Measurements are cached by *item key*, and the default key is the index.** Two different traps come out of that and need different answers. *Different data at the same index* — a new set of search results, where group 0 is a different album — is a **key** problem, and `getItemKey` is the answer; `measure()` actively breaks it, because it runs after the refs have measured the new elements and throws those measurements away, and nothing re-measures afterwards since `measureElement` reports on mount and on resize only. *The same data in a different shape* — switching layout, or crossing the compact breakpoint — is what `virtualizer.measure()` is for.
- **The virtualiser thinks its list starts at scroll offset 0.** It does not: the view header and the toolbar sit above it, and without `scrollMargin` every `scrollToIndex` lands short by exactly their height. Rendering still looks right, because rows are positioned inside a list that is itself in normal flow — only the scroll arithmetic is wrong. `scrollMargin` must be measured and re-measured (a wrapping title, stats appearing once rows load, the finder opening all move the list), and because `start` then includes it, the row transform has to subtract it back off.
- **In album mode the virtualiser's index is not the track's index.** Its items are groups, so centring index N centres the *album* and the track lands wherever it sits inside it — up to 271px out on a 735px viewport, and off screen entirely once an album is longer than the window. Centring is therefore measured off the row's own rect rather than computed from an index, falling back to the group's offset until the row is mounted. `animateScrollTo` re-reads its target every frame, so the first frames aim at the album, that brings the row into existence, and the target refines to the track.
- **Rendered is not visible.** `overscan` deliberately mounts rows past the fold. Anything asking "is this row on screen?" must measure the element against the scroll container.

Prefer computed sizes where they are genuinely fixed (compact rows are exactly one height) and `measureElement` where they are not. Album group heights depend on caption wrapping and breakpoint.

## Rows

**One gutter per row, and the wash follows it.** `TrackRow` exposes `--row-gutter` and the play-count wash is derived from it (`inset: 2px max(0px, calc(var(--row-gutter) - var(--heat-lead)))`) rather than stated again. Hardcoded, the two drift the moment a layout sets its own padding. The rule the numbers encode: **the wash's edge sits on the view's content line, and the row's content sits `--heat-lead` inside it.** Three things want that line — the number, the wash, and a gap between them — and only two can have it. The wash takes it.

**Compare tag values loosely, display them exactly.** Tags drift in case and spacing between files in the same album — `5 Seconds Of Summer` and `5 Seconds of Summer` are one artist. Anything comparing tags to decide what the user sees goes through `sameTagValue()` in `fields.ts`; anything rendering a value shows the original spelling. A strict `===` makes a track look like a guest on its own album and splits one album into two groups mid-run.

**`<Artwork>` takes a URL, not an address.** *Where* artwork lives is the source's business. Anything drawing a row's cover calls `source.artworkUrl(ref)`.

**List components take `source`, not `playlistId`.** `TrackBrowser`, `TrackList`, `TrackRow`, `AlbumGroup` and `Mosaic` all receive the source; so do `useTrackContextMenu`, `useTrackDragSource` and `useAddTracks`. A component wanting a playlist id for anything other than *identifying a playlist* is a sign the seam has been bypassed.

**Queueing goes through the seam too, and it is the case that justifies it.** `/playqueue/add` addresses a track as `(playlist, index)`, and a row read from the media library API is in no playlist at all. `LibrarySource.queueTargets` answers that: a playlist source hands back the refs it has, and the library source appends to `#Jean Queue`, a holding playlist in Jean's namespace, and **reads the tail back to learn where the tracks actually landed** — the player files a set in the media library's browse order, not the order it was sent, and a queue in the wrong order is the one bug a queue cannot have. That playlist is **append-only and emptied rather than deleted**, and only when the play queue is provably empty: appending never disturbs an entry already queued, and deleting a playlist the queue points into crashes the player.
