# Tracks: rows, refs and the list

The virtualised list, what a row is made of, and how the library is loaded and
drawn. General rules are in the root `CLAUDE.md`.

**A rating tag is a bare number with no declared scale, so the magnitude picks
the scale.** *Measured* over one real 30,441-track library, every rating on it:
375 tracks at `5`, 39 at `100`, 40 at `-1` and 27 at `0`, 14 at `2.5` and 3 at
`3.5`, spread over MP3, FLAC, Vorbis, AAC and WMA. Four taggers' conventions in
one folder tree, and the field says which one it is using nowhere. Reading only
0-5 would call 39 of those unrated, and that is not "Jean cannot tell" -- it is
Jean ignoring a rating that is plainly there. So `domain/track/rating.ts` bands it:
`<= 0` unrated, `<= 5` the native scale, `<= 10` the 0-10 one, `<= 100` the
0-100 one FLAC's `RATING` has converged on, `<= 255` a POPM byte written out as
text. Anything larger is not read as a rating and specifically is **not clamped
to five stars** -- a number that big means the field is being used for something
else, and inventing full marks out of it is the loudest possible way to be wrong.

Two boundaries are genuinely ambiguous: `5` is full marks on the native scale and
half marks on a 0-10 one, `10` is full marks on 0-10 and a twentieth of a 0-100
one. Both go to the lower, more common scale. **Detecting one scale per library
is worse than banding, not better** -- the library above holds `5` and `100` at
the same time, so there is no single answer for it, and picking one would misread
375 tracks to rescue 39.

**POPM never arrives through this field, which is what makes the bands safe.**
POPM is a binary ID3 frame, not text, and *measured* against the live player
`%popm%` and `%rating wmp%` both return `?` -- foobar2000 has no such field
without a component. Every MP3 rating on that library arrives as `5`, `3` or `0`,
i.e. from `TXXX:RATING`. That matters because a 0-255 byte and a 0-100 percentage
overlap on 1-100 and cannot be told apart by value: Windows Media Player's `64`
is two stars as POPM and three as a percentage. Since only one of the two can
reach a text field, there is nothing to disambiguate. If a POPM field ever does
surface it needs its own column and its own scale, never this one's bands.

**The rating field is `%rating%`, not `$meta(rating)`, and the difference is
whose ratings Jean can see.** `foo_playcount` -- the standard way to rate in
foobar2000 -- takes over `%RATING%` and answers from its own database rather than
from the files, so a user who rates in foobar's own UI has nothing in their tags
at all and `$meta(rating)` shows Jean an empty column. *Measured* on a player
without it, the two return byte-identical values, so nothing is lost by
preferring the one that also works with the component. It fixes the capability
probe as a side effect: **`$meta()` returns `''` for a field that does not exist,
never `'?'`**, so it can never be feature-detected, while `%rating%` answers `?`
per track and behaves like every other column.

**Halves are displayed, never invented.** A file that says `3.5` gets three and a
half stars, because rounding it to 4 would be Jean disagreeing with the player
about what the library contains. Rounding to the nearest *half* is only so a
rescaled value has a star to land on. The corollary, now that there *is* a rating
control: its increment is **whole stars**, full stop, because introducing halves
into a library that has none is a change to somebody's tags they did not ask
for. `hasHalfStars()` samples for the library that already has them and is the
hook for offering halves there one day; nothing reads it yet.

## Writing a rating

**Read on four scales, write on one.** `starsOf` bands a bare number because the tag
declares no scale; a *write* has no such licence. Jean writes foobar2000's native 0-5
integers, so a track whose raw value is above 5 is on somebody else's scale and renders
**read-only rather than rescaled** — turning a `100` into a `5` on the way out is a 4%
rating becoming four stars, it is not reversible from the five stars on screen, and
nothing about the row would show it had happened. `isWritableScale()` is that rule and
it is asked per track, so a library holding both conventions gets a control on the
tracks it can be right about and none on the rest. Halves stay writable: `3.5` is on the
native scale, and a whole-star control replacing it is a choice the user made.

**The empty string removes the tag.** `"0"` would be a rating of zero, which some
taggers write and others read as unrated; `""` is the component's own spelling of "there
is no rating here" and is what clearing sends.

**Nothing pushes a tag change, so the optimistic value is the only value.** beefweb's
stream fires when the *set* of playlists changes and says nothing whatever when a
track's tags do — so a rating that is true in foobar2000's database a millisecond after
the write is still absent from every row Jean holds, with no update coming to reconcile
against and no re-reading the library to learn one number. `ratingStore.ts` is that
overlay, and it is **keyed by the row array itself**: rows are the arrays
`playlistStore` published, so the entry disappears exactly when a fresher load replaces
them. The overlay cannot outlive the data it patches and no invalidation has to be
written. The cost is that one track in two loads is two arrays, so rating it in a
playlist leaves `#/all` on the player's older value until that load is replaced — the
staleness every other column already has, not a new one.

**A ref is not a file, and `foo_jean` needs a file.** The component takes a plain
absolute local path; the media library API reports paths **relative to the library
folders and forward-slashed**, and a playlist row carries no path at all. So
`LibrarySource.identify()` resolves a ref back to a real file by asking the player for
`%path%`, which it renders absolutely on both sources — one round trip, on a deliberate
action against a single track, which is exactly the budget `%path%` was left out of
`TRACK_EXPRESSIONS` to protect. It **verifies rather than trusting the index**: the
library compares the relative path it already holds, the playlist compares the title,
and either mismatch answers null. Indices move — the desktop can edit a playlist
mid-session — and the failure mode of getting this wrong is writing a tag to somebody
else's file.

**Coalesced per row, not globally.** `useCoalescedWrite` holds one pending value, and
these belong to different tracks: a star clicked on a second row while the first is in
flight would drop one of the two. Superseding a value on the *same* row is right, since
the last star clicked is the one meant, and re-tagging is a real disk write on the
player rather than a UI update.

**A 403 is a bug, not a condition.** It means the install's allowlist does not name the
field, so the control should never have been offered — Jean logs it and stops offering
that field for the session rather than failing again on the next click. **A 504 is the
one failure that is not rolled back**: the player did not answer inside its own thirty
seconds and the write may still land, so the value is re-read rather than assumed lost.

**A hover may not make a rated track look unrated, and this took two goes.**
Hovering the star that is already set means "click to remove", and the first
drawing of that emptied all five -- so sweeping the pointer across a five-star
row made it read as unrated, constantly, with nothing clicked. It now fades them
instead: same claim about the same click, still legibly a rating. The second
half is that **committing must drop the preview**, because the star just clicked
becomes the one that would now clear, and leaving it armed redraws the control
with no pointer movement to explain it. Re-arm on `pointerenter` and *not* on
`pointermove` -- the latter looks equivalent and re-renders at the pointer's
sample rate, which is felt immediately as a laggy hover.

**`0`-`5` rate from anywhere, and resolve their own target**: the cursor row when
a track list is on screen, the playing track otherwise. Declared once in the
global scope rather than in the list's scope as well, because six keys in two
scopes is an arbitration this does not need -- `TrackBrowser` publishes its
cursor to `ratingTarget.ts` and `useRateShortcut` reads it. The cursor wins
because it is marked on screen and is the thing being looked at; `N` moves it to
the playing track, so rating what is playing from inside a list is two keys
rather than a special case.

**A successful rating is silent, and it used to speak.** Rating the playing
track from elsewhere has no stars on screen to update, so `rateTrack` confirmed
it in a toast -- the general rule being to confirm only what is not already
visible. That held while the keyboard shortcut was its only caller and stopped
holding the moment the now-playing screen grew its own stars: rating from there
drew the new value *and* threw a toast over the transport, which is the app
congratulating itself for doing exactly what was asked. A rating is small,
reversible, one click, and mostly visible; confirming it is the failure mode a
toast exists for. **A failure still speaks and names the track**, because that
is the one outcome the stars cannot show and `0`-`5` can be pressed with the
track nowhere on screen.

**The stars in a row are a pointer control, and the menu is the other two devices'.**
Hovering previews and clicking commits — Letterboxd, Plex and Apple Music all do this,
because a five-way choice made in a 60px strip has to show its answer before it takes
it — and clicking the star already set clears the rating, labelled "Clear rating" so the
way back out is stated rather than discovered. Twelve-pixel targets are not a touch
target and the list owns keyboard focus, so a row cannot hold five tab stops without
fighting the virtualiser; touch and keyboard get a Rating page in the track menu
instead, one track at a time. That is a *device* question, asked as
`(hover: hover) and (pointer: fine)` rather than a width breakpoint: a mouse on a narrow
window should keep the stars.

**The rating column is never hidden, and this is a reversal.** It used to be
gated on there being a rating somewhere in the view -- the argument being that
every other column answers `--` per track and is quiet about it, while five empty
stars across thirty thousand rows state "unrated" thirty thousand times about a
question the player was never asked. Two things killed that rule.

It is a **sample**, and ratings are sparse: 500 in 30,441 on the library this was
built against, so 200 sampled rows miss them outright about one library in
twenty-five. *Observed*, not predicted -- the column vanished from a library that
plainly has ratings, with nothing on screen to explain why, which is a far worse
failure than a quiet column. And once ratings can be **written**, hiding the
column is exactly what removes the control that would fill it, so a library with
none could never acquire a first one.

So Rating behaves like every other column: on when you ask for it, empty where
there is nothing to say. The original worry is answered by drawing the empty
state quietly rather than by hiding it, which is why the empty star is
`--border-strong` -- it is the one drawn most. Five stars are always drawn and only the fill varies, which is
Letterboxd's and Plex's shape rather than drawing three stars for a three-star
record: a row whose stars end somewhere different each time cannot be scanned
down. The empty star is `--border-strong`, because it is the one drawn most.

**Find-in-list is not the search, and every list has one.** The search in the top
bar filters the library down to matches and takes you to `#/search`; the finder
walks you to a track inside the list already on screen, changing neither its rows
nor their order. Both exist because they answer different questions, and the button
says which list it is searching -- "Find in all music", "Find in this shelf" -- so
the two are never mistaken for each other. It lived inside `PlaylistView` and so
existed only for playlists, which left the two longest lists in the app without it;
`domain/track/useFinder.tsx` owns the whole of it now -- state, deferred scan, button
and field -- and returns the node rather than the pieces, because a caller that
assembles its own is the one that will assemble it wrongly.

**Adding tracks to a playlist does not check for duplicates.** foobar2000 playlists are
ordered lists, not sets; the player appends without comment, and Jean inventing a
uniqueness rule the player does not have would be Jean lying about the data. There is no
cheap check available either -- items have no id, so identity is `%path%`, and reading
it is a request of its own before the drop could land.

**Undo instead, as the general rule for anything that writes.** Because tracks are
appended, the indices just created are exactly `[itemCount, itemCount + n)`, and
`itemCount` is already in `PlaylistInfo` -- so undo costs no extra request and needs no
path matching. Re-read `itemCount` before undoing and abandon it if it no longer
matches: the desktop may have changed the playlist underneath, and removing the wrong
rows is far worse than not offering the undo.

**The list follows playback, and only when the track actually changes.** Scrolling
away from the playing track does not change which track is playing, so nothing
re-fires and the view stays where it was put; the "Now playing" pill and `n` are
how you get back. It **centres the track, in both directions**.
Minimal scrolling was the obvious choice and the wrong one: it brings a row in
from whichever edge it crossed and leaves it there, so going forwards parked the
playing track on the status bar -- measured at zero pixels from the bottom edge,
ten track changes running -- and going backwards tucked it under the sticky
toolbar, in view by the letter and needing a nudge of the wheel to be seen.
Centre has no edge to land on, so the direction stops mattering, and where the
playing track sits becomes a fact rather than a consequence of how you got
there. Advancing a track then scrolls the list by exactly one row, which is
cheaper than it sounds: the row is already rendered, so it is one compositor
scroll and not a re-render. Off for search
results: those rows change under every keystroke, and jumping to the playing
track the moment it appears among them would take the view away from the matches
just typed for. Stored as `jean.followPlayback`, on by default, with no UI yet.

## Loading it

Measured on a 30,441-track library, 12 columns: 1.03 MB gzipped, 6.95 MB raw, ~680 ms
fetch, ~46 ms parse. That scales to 100k–200k libraries only with the following, all of
which are required, not optional:

- **Fetch in chunks** (`offset:count`), but count the requests, not the rows. Measured
  since: a request costs ~270 ms before it returns anything and only ~30 ms more to return
  2,000 rows instead of 500, so sixteen sequential chunks of 2,000 took 5.5 s where one
  small chunk followed by four concurrent large ones paints at ~730 ms and finishes in
  ~1.5 s. Chunk for **time to first paint**, then go wide, and never issue many small
  sequential requests.
- **One load, shared.** The library has more than one consumer — the playlist view and
  search — and neither may fetch its own copy. `domain/track/playlistStore.ts` owns it.
- **Parse and index in a Web Worker.** A 46 ms parse at 30k is a ~300 ms main-thread
  freeze at 200k.
- **Dictionary-encode into columns.** Parallel `Uint32Array`s of indices into shared string
  tables. The fields users browse and sort by have few distinct values (743 album artists,
  145 genres in a 30k library) so they cost almost nothing. Naive objects at 200k tracks
  are ~100 MB of heap; encoded columns are under 20 MB.
- **Never hold per-track-unique strings you don't need.** `%path%` alone is ~31 MB at 200k
  and is not needed — tracks are addressed by playlist index. Fetch it on demand for the
  one track that needs it. Same rule for lyrics.
- **Integers, not strings**, for dates, durations and counts. Sorting a typed array is
  sub-millisecond; sorting objects by a string field is not.
- **Persist to IndexedDB.** `structuredClone` handles TypedArrays natively, so a warm start
  is a buffer read. Revalidate in the background against `itemCount` and SSE playlist
  events.

## Rendering

**React does not virtualize.** Render 30k rows and you get 30k DOM nodes. Use
[TanStack Virtual](https://tanstack.com/virtual/latest) for any list that can grow
unbounded. `content-visibility: auto` is not a substitute — it skips paint but still
builds every node.

Artwork is per-playlist-index (`/api/artwork/{playlistId}/{index}`, ~46 KB each), and
**`loading="lazy"` is not the mechanism.** It asks whether a row is visible, and a
virtualised list moves rows through the viewport by the hundred: *measured*, one jump to
the playing track across a 30,441-row playlist started **499 artwork requests** for a
screen that comes to rest showing 41. What that costs is not frames, it is the rest of
the app. Nothing blocks the main thread -- zero long tasks for the whole flight -- which
is exactly why it reads as the player ignoring you rather than as jank: the browser
gives an origin six HTTP/1.1 connections, the update stream holds one of them open
forever, and everything Jean asks for afterwards queues behind covers for rows that are
long gone. Against a player taking 200 ms a cover, a play/pause pressed a second and a
half after the jump waited **122 ms** for a socket, and the queue drained for **19.8 s**.

`shared/ui/artworkQueue.ts` is the answer, and the load-bearing part of it is **time, not
capacity**: a row has to still be mounted 100 ms after it appeared before it is even
queued. A queue on its own is worse than nothing -- against a player that answers
instantly it drains as fast as the rows churn and lets every one of them through,
measured at 1,115 requests, *more* than the native behaviour it replaced. With the
settle gate the same jump costs **41 requests, one per row on screen**. Three run at a
time, so the API always has connections left over, and both outcomes are remembered:
a track with no embedded cover 404s, and on a library that is mostly uncovered that was
most of the traffic on every scroll back over ground already covered.

**A cover belongs to an album, but it is addressed per row -- so ask once.** A
playlist addresses artwork by index and the media library by path, which means a
record's twelve tracks are twelve URLs for one picture and the browser cannot
know they are the same. *Measured* against the live player, the first twelve
rows of the library: twelve requests, **identical ETag on every one**, 633 KB
each -- 7.6 MB fetched to draw one cover twelve times at 34px. `albumCoverRows`
in `domain/track/grouping.ts` points every row at its album run's first row, off the
same runs the album layout is already grouping for, so it costs nothing new.
*Measured* on the fixture: walking a 54-track, 12-album playlist went from **54
requests to 12**.

That an album has one cover is not a new assumption -- the album layout has only
ever drawn one -- but it was checked rather than asserted: 35 random albums and
then the 14 most compilation-shaped runs on the player, Various Artists
collections with fifteen different track artists in them. Every track of every
one returned the same ETag. Across the 35, 462 requests became 35 and 328 MB
became 24 MB.

Two related facts. **The player's ETag is content-derived** -- two indices off
one album carry the same one -- and that is worth knowing and never worth relying
on, because an HTTP cache is keyed by URL and so never matches across two rows
unless the URL is shared too. And **`Cache-Control: max-age=3, must-revalidate`**
is all the player gives, so a cover redrawn more than three seconds later costs a
revalidation; the fake models both, because a fake sending no headers at all
reproduces the bug permanently and unfixably from the client, which is how it
went unnoticed. There is **no way to ask for a thumbnail**: every query parameter
is ignored and the full-size image is what you get, which is why the request
count is the only thing there is to reduce.

Two traps, both of which have already shipped bugs:

- **Measurements are cached by *item key*, and the default key is the index.** Two
  different traps come out of that, and they need different answers.
  *Different data at the same index* — a new set of search results, where group 0 is
  a different album — is a **key** problem, and `getItemKey` is the answer: new keys
  are new items and are measured when they mount. `measure()` cannot fix this one and
  actively breaks it, because it runs after the refs have measured the new elements
  and throws those measurements away; nothing re-measures afterwards, since
  `measureElement` reports on mount and on resize and a mounted group does neither.
  That left the first album of a search lying 133px under the second until you
  scrolled, which remounts them.
  *The same data in a different shape* — switching layout, or crossing the compact
  breakpoint — is what `virtualizer.measure()` is for: row 4 is a track in one layout
  and an album group in the other, and reusing those heights looked like list rows
  suddenly being 200px tall.
- **The virtualiser thinks its list starts at scroll offset 0.** It does not:
  the view header and the toolbar sit above it, and without `scrollMargin`
  every `scrollToIndex` lands short by exactly their height. Rendering still
  looks right, because the rows are positioned inside a list that is itself in
  normal flow -- only the scroll arithmetic is wrong. Measured on one viewport
  it was 292px, which read as "jump to playing centres a bit off" on a tall
  window, as "it does not scroll at all" on a short one, and as "it works
  sometimes" near the end of the list, where the scroll offset clamps and
  absorbs the error. `scrollMargin` has to be measured and re-measured -- a
  wrapping title, the stats appearing once rows load, and the finder opening
  all move the list -- and because `start` then includes it, the row transform
  has to subtract it back off.
- **In album mode the virtualiser's index is not the track's index.** Its items
  are groups, so asking it to centre index N centres the *album*, and the track
  lands wherever it happens to sit inside it -- measured at up to 271px out on a
  735px viewport, and off screen entirely once an album is longer than the
  window. Centring is therefore measured off the row's own rect rather than
  computed from an index, falling back to the group's offset only until the row
  is mounted. `animateScrollTo` re-reads its target every frame, so the first
  frames aim at the album, that brings the row into existence, and the target
  refines to the track. In list mode a row and its index are the same thing, so
  the two agree and it is one path rather than a special case.
- **Rendered is not visible.** `overscan` deliberately mounts rows past the fold, and
  an album group is tall enough that its rows can be mounted while sitting well below
  the screen. Anything asking "is this row on screen?" must measure the element
  against the scroll container, not check whether the virtualizer rendered it.

Prefer computed sizes where they are genuinely fixed (compact rows are exactly one
height) and `measureElement` where they are not. Album group heights depend on
caption wrapping and breakpoint, and hand-computing them left visible gaps between
groups.

## One gutter per row, and the wash follows it

`TrackRow` exposes `--row-gutter`, and the play-count wash is derived from it
(`inset: 2px max(0px, calc(var(--row-gutter) - var(--heat-lead)))`) rather than stated
again. Hardcoded, the two drift the moment a layout sets its own padding: album rows did,
and the wash kept the list layout's inset, so it began *inside* the content and left the
track number stranded outside the tint.

The rule the numbers encode: **the wash's edge sits on the view's content line, and the
row's content sits `--heat-lead` inside it.** Three things want that line — the number,
the wash, and a gap between them — and only two can have it. The wash takes it, because
it is the larger shape and because a number touching the edge of its own highlight reads
as a mistake.

**A ref is an integer, and now the compiler says so.** `Refs` is
`Int32Array | number[]` in `domain/track/project.ts`, and `LibrarySource` in
`domain/track/librarySource.ts` is the seam written down. Anything outside that file
reaching for `playlistId` to do something other than identify a playlist is now
a type error rather than a code review.

**Compare tag values loosely, display them exactly.** Tags drift in case and spacing
between files in the same album -- `5 Seconds Of Summer` and `5 Seconds of Summer` are
one artist. Anything comparing tags to decide what the user sees goes through
`sameTagValue()` in `domain/track/fields.ts`; anything rendering a value still shows the
original spelling. A strict `===` here makes a track look like a guest on its own
album, and splits one album into two groups mid-run.

**`<Artwork>` takes a URL, not an address.** It used to take `playlistId` and
`index` and build the URL itself; it now takes `src` and is purely presentational.
*Where* artwork lives is the source's business -- a playlist addresses it by index,
the media library by path, and the status bar by whatever the player is currently on.
Anything drawing a row's cover calls `source.artworkUrl(ref)`.

**Queueing goes through the seam too, and it is the case that justifies it.**
`/playqueue/add` addresses a track as `(playlist, index)`, and a row read from the
media library API is in no playlist at all -- so on Home, All music and search
results there is nothing to send. `LibrarySource.queueTargets` is where that is
answered: a playlist source hands back the refs it already has, and the library
source appends to `#Jean Queue`, a holding playlist in Jean's own namespace, and
reads the tail back to learn where the tracks actually landed. The read-back is not
caution -- the player files a set in the media library's *browse* order, not the
order it was sent, and a queue in the wrong order is the one bug a queue cannot
have.

That playlist is **append-only and emptied rather than deleted**, on the way in and
only when the play queue is provably empty. Both halves matter: appending never
disturbs an entry already queued, because the queue holds track handles rather than
positions; and deleting a playlist the queue points into crashes the player.

**List components take `source`, not `playlistId`.** `TrackBrowser`, `TrackList`,
`TrackRow`, `AlbumGroup` and `Mosaic` all receive the source; so do
`useTrackContextMenu`, `useTrackDragSource` and `useAddTracks`. A component that
wants a playlist id for anything other than *identifying a playlist* is a sign the
seam has been bypassed.
