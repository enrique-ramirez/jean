# Jean

A replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin,
controlling foobar2000 (and, best-effort, DeaDBeeF) over HTTP.

Named for how it feels to use. Rhymes with *pan*, not *bean*.

## What this is

**A general-purpose UI meant for public release, not a personal dashboard.** It happens
to be developed against one person's library, but nothing may assume that library. No
hardcoded playlist IDs, no assumed paths, no assumed scale, no assumed components.

The primary axis of quality is **UX/UI, and performance is part of UX**. A feature that
makes the interface slower needs to justify itself. When in doubt, favour the choice that
keeps interaction responsive.

## Look it up before you draw it

**Every piece of UI gets a reference pass before it gets written.** Search for how good
products solve the same problem, then decide. Worth having in the rotation: **Mobbin**,
**Refero**, **Screenlane**, **UI Sources**, **Godly**, **Awwwards**, **Land-book**,
**Dribbble**, **Behance**, **DeviantArt**, **Pinterest**. Naming the component and the
platform is usually enough of a query -- "action sheet mobile", "context menu desktop
dark", "sidebar drag reorder".

The point is not to copy. It is that the shape a component takes when you write it from
memory is the median of everything you have ever seen, and the median is exactly what
makes an interface look templated. Look at several, take the one decision from each that
is actually good, and know what you rejected.

Two standing rules fall out of it:

- **Never look like Spotify.** It is the obvious reference for a music player and
  therefore the one place Jean has nothing to gain by resembling. If a screen could be
  mistaken for it, redraw it.
- **Record the choice.** A comment saying "this is an action sheet, not a bottom sheet,
  because ..." is worth more than the code under it. Vocabulary is a design decision --
  the two are different components and only one of them is detached from the edges.

## Ground rules

- **Fully responsive.** One codebase, no separate mobile build.
- **Desktop is keyboard-first.** Rich, discoverable keyboard navigation via
  `@tanstack/react-hotkeys`. Anything reachable by mouse should be reachable by key.
- **Mobile is aggressively optimised** — touch targets, safe-area insets, and a much
  tighter payload and interaction budget than desktop.
- **Light and dark themes, both designed.** Neither is `#000` / `#fff`.
- **Minimum required components: beefweb alone.** Everything beyond that is optional,
  auto-detected, and individually toggleable in Jean's own settings UI. A bare beefweb
  install must get a complete, coherent app — never a dead panel or an empty shelf.
- Keep the supported-component list in `README.md` current as features are added.

## foobar is the source of truth

Prefer the player's own metadata over anything Jean invents. In order of preference:

1. **Read it from foobar** via title-formatting columns. Always check this first — the
   player computes, so the reachable surface is much wider than beefweb's own schema.
2. **Get it to live in foobar**, if a component or tag can supply it. Requiring an
   optional component for an optional feature is acceptable and expected.
3. **Store it locally in Jean**, only when foobar genuinely cannot hold it. This is a
   legitimate fallback, not a failure — but reach for it third, not first.

Writing a custom foobar component to feed Jean is a deliberate last resort. Don't design
toward it.

Corollary: **Jean's own settings live server-side** in `/api/clientconfig/{id}`, so they
follow the user between devices. Fall back to `localStorage` only when
`permissions.changeClientConfig` is false.

## Product decisions already made

**A shelf's heading opens it; its covers play it.** Two verbs on one row, and which
is which has to be legible without trying either. The heading is a link -- hash
routing, so cmd-click opens it in a tab -- carrying a chevron off the end of the
words rather than a "Show all" parked at the right of the row. That shape is Apple
Music's and Disney+'s; the right-aligned one is Spotify's, and it would also be
promising "all of them" when the route opens the same albums already on screen, as
tracks. The blurb is not part of the target: it is a sentence about why these
records qualified, and a sentence that navigates when you brush past it is a trap.
Opening writes nothing and starts nothing -- the scratch playlist keeps whatever it
was holding, which is the browsing/playing separation the whole design rests on.

**Home opens with a claim, not a label.** The header leads with the library's total
*duration* -- "85 days 11 hr of music" -- because 30,441 is a number and 85 days is a
feeling, and a front door should be the second thing. "Your library" drops to the
eyebrow, alongside the years the collection spans, so orientation costs a line
nobody has to read. Under it a **rail** of counts -- tracks, albums, artists,
genres, playlists -- separated by hairlines rather than boxed into cards, because
they are one sentence about one library and a card apiece would make five unrelated
readings of it. Then the top genres as chips.

Reference pass: the dashboards this could have become (Dribbble's music dashboards,
every KPI grid) put each figure in its own shadowed card, which turns a music
player's front door into an analytics tool and fights the shelves below -- already a
grid of boxes. Spotify's library header is chrome and filter chips and its Wrapped
is gradient panels with enormous sans type; both rejected, the second emphatically.
Taken from Awwwards' stats elements: the hairline between figures, labels pinned in
one place relative to the number, tabular figures so the row shares a grid, and an
asymmetric composition. Taken from Letterboxd's all-time page -- the closest
analogue anywhere, a personal collection counted and characterised -- the move that
makes it a portrait rather than a readout: it *names* things as well as counting
them, which is what the genre chips are for.

**Home's header ends in the same two buttons a playlist's does, meaning the same
two things.** Play starts at the beginning, Shuffle starts anywhere and turns the
mode on; both then land you on All Music, because that is the view of the set they
just started and pressing play should not leave you looking at the screen you
pressed it from. Neither touches the mode the other way round -- it is global
player state, the status bar owns it, and a Play that quietly switched shuffle off
would be reaching across the app to do it. There are two rather than one because a
single button would have had to be Play doing a shuffle's job, which contradicts
the header two clicks away; **Shuffle is the one worth pressing on thirty thousand
tracks, and Play is the one that has to exist for Shuffle to be honest.** They sit
across the gap on the right, which is the room a header with no mosaic has spare,
and on a phone they drop to the two edges at their own size -- stretched to half a
screen each they read as a dialog asking a question.

Filling the scratch and playing a position in it is `library/usePlaySet.js`, one
implementation for the shelves, the front door and All Music: a set filled in the
wrong order plays the wrong track and a player that refuses playlist writes has to
degrade rather than do nothing, and neither is worth getting right twice.

**A rating tag is a bare number with no declared scale, so the magnitude picks
the scale.** *Measured* over one real 30,441-track library, every rating on it:
375 tracks at `5`, 39 at `100`, 40 at `-1` and 27 at `0`, 14 at `2.5` and 3 at
`3.5`, spread over MP3, FLAC, Vorbis, AAC and WMA. Four taggers' conventions in
one folder tree, and the field says which one it is using nowhere. Reading only
0-5 would call 39 of those unrated, and that is not "Jean cannot tell" -- it is
Jean ignoring a rating that is plainly there. So `playlist/rating.js` bands it:
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
rescaled value has a star to land on. The corollary is for the rating control
that does not exist yet: its increment is whole stars unless the library already
contains halves -- `hasHalfStars()` samples for that -- because introducing
halves into a library that has none is a change to somebody's tags they did not
ask for.

**A library nobody has rated does not get the column.** Every other column
answers `--` per track and is quiet about it; five empty stars on thirty thousand
rows is not, and it states "unrated" thirty thousand times about a question the
player was never asked. So Rating's probe is not "does the field resolve" but
"is there a rating anywhere", and it is a **full scan rather than a sample** --
ratings are sparse, 500 in 30,441, and a 200-row sample misses them outright
about one library in twenty-five. One array index over 30k rows is well under a
millisecond, once. Five stars are always drawn and only the fill varies, which is
Letterboxd's and Plex's shape rather than drawing three stars for a three-star
record: a row whose stars end somewhere different each time cannot be scanned
down. The empty star is `--border-strong`, because it is the one drawn most.

**A figure at nothing is not drawn, and nouns are pluralised only when the count
earns it.** Somebody trying Jean against a folder of four songs is looking hardest
at this screen, and "1 albums" tells them it was written for another library. The
same goes for a rail of noughts on a fresh install: zero genres is not a library
without genres, it is Jean unable to tell, and either way an absence dressed as a
fact. `test/e2e/library-header.spec.js` holds the shapes -- four songs, one artist
on repeat, six thousand tracks over three hundred artists, no year tags, no
durations, no albums, no playlists, and one artist spelled two ways. The fixture
option is `libraryShape`, and it states a shape rather than passing built tracks
because **an option's top level does not survive the trip to the Playwright worker
as an array** -- it arrives as `{0: …, 1: …}` with no `.map` on it. Nested arrays
are fine, which is why `omit: ['%year%']` inside the object works.

Two rules it inherits. **A figure the player cannot answer for is not drawn** --
no genre tag means no genres figure, never "0 genres", because zero is a claim and
this is an absence. And **the counts are the user's music, not Jean's plumbing**:
`#Jean Library` and the scratch are filtered out, or the header would disagree with
the sidebar two centimetres to its left. The rail becomes a three-column grid below
720px, because a wrapping flex row puts a hairline at the *start* of its second
line, separating a figure from the edge of the screen rather than from another
figure.

**The home screen is rows of shelves, and a shelf is a filter with a reason.** Most
played, Recently played, "You used to love this", "Worth a better copy", "You starred
these", "Never opened". Each carries a caption saying *why this record is here* --
"1,300 plays", "Not since 2016", "128 kbps" -- because that sentence is the whole
difference between a shelf and a query result.

Not a carousel. Cover Flow was removed from iTunes in 2015 because it is a beautiful
thing that cannot browse: one album at a time across two thousand is a flick-fest. A
shelf is small on purpose and the browsing lives in All music.

Three rules hold the shelves honest on somebody else's library:

- **Thresholds are percentiles of this library, never constants.** A library whose
  busiest album has three plays still has a top quartile.
- **A percentile is not a promise that the title is true.** *Measured* on a library
  played daily, the bottom quartile of recency was still *last year* -- so "played to
  death, then forgotten" was offering records from months ago. Where a shelf claims
  something about time it carries an absolute floor as well.
- **A shelf that cannot fill honestly does not render**, and a claim needs the data
  behind it. No ratings, no starred shelf. No playback statistics at all and "Never
  opened" is not "you never played these", it is *Jean cannot tell* -- so it says
  nothing. If nothing at all qualifies, Home falls back to **one row drawn at random**,
  because every install has a library and an apology is not a home screen.

**Every set that plays says so on the row it already has; only a shelf gets one
made for it.** All music and a live search have permanent sidebar entries, so they
are marked in place; a shelf has none, so it borrows a temporary row for as long as
it is the thing playing. One answer feeds all of them -- `usePlayingFrom` reads the
scratch playlist's own title, and the route it belongs to is worked out once in
`App`. The rows that ask anything else get it wrong: marking the search row from
`isScratchPlaylist && isCurrent` lit it up for a *shelf* playing, because
`isCurrent` outlives playback and that test never asked what the scratch was
holding. A user's own playlist is the exception and keeps `isCurrent`, deliberately
-- see "Showing playlists".

**Browsing and playback are allowed to point at different things, so the app has to
say where the sound is coming from.** The scratch playlist holds *the last set you
chose to play*, not the thing you are looking at -- so you can start a shelf and wander
into All music without touching it. That freedom is only tolerable with the affordances
that account for it: a temporary sidebar row named after the shelf, and `from <label>`
in the status bar. Both read the scratch playlist's own title through
`library/usePlayingFrom.js`, so they cannot disagree and neither needs state of Jean's
own. **The accent on a sidebar icon means "this is playing" and nothing else** --
tinting it by selection made the row you were looking at and the row you were listening
to identical, which is precisely the pair this design exists to separate.

**Find-in-list is not the search, and every list has one.** The search in the top
bar filters the library down to matches and takes you to `#/search`; the finder
walks you to a track inside the list already on screen, changing neither its rows
nor their order. Both exist because they answer different questions, and the button
says which list it is searching -- "Find in all music", "Find in this shelf" -- so
the two are never mistaken for each other. It lived inside `PlaylistView` and so
existed only for playlists, which left the two longest lists in the app without it;
`playlist/useFinder.jsx` owns the whole of it now -- state, deferred scan, button
and field -- and returns the node rather than the pieces, because a caller that
assembles its own is the one that will assemble it wrongly.

**Search is a persistent, always-visible control** that is *also* bound to `⌘K` and `/`.
Not a keyboard shortcut with an icon added later — mobile has no keyboard, and an invisible
affordance means the feature does not exist there. On mobile it belongs within thumb reach.

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

**Confirm only what is not already visible.** Creating a playlist needs no notification
-- the row appears, named, waiting to be renamed. Adding forty tracks to a playlist you
are not looking at does, and that is what a toast is for; it is also where the undo
lives. A message about something already on screen is noise.

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

**Search results shuffle too, because playing them makes them a real playlist.**
That was not true for a while and the button was removed: the order draws from
the active playlist, so shuffling a set of results started inside them and then
wandered the whole library. Materialising the results on play fixes the cause
rather than the symptom -- see *Search results are a view until you play them*.
Without `permissions.changePlaylists` there is no playlist to make, so the
button goes again.

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

**Anything ambient enough to need explaining gets explained once, where it happens.**
The play-count shading is the case in point: it is legible only if you already know what
it means, so it introduces itself the first time it is actually on screen, in a popover
anchored to its own control, and any click at all dismisses it for good. What it must not
be is a modal on first run -- that teaches things before there is anything to attach them
to. It also needs a permanent home for whoever meets it later or forgets, which is the
columns menu; a thing you can only be told once is a thing most people never learn.

Icons come from **`lucide-react`**, imported per-icon so they tree-shake.

## Architecture decisions already made

### The library

> **This describes released beefweb (0.10), which is the fallback rather than the
> target.** The development player runs a pre-release 0.11 that has a real library
> API -- see "The library API" below. Everything here still has to work, because it
> is what DeaDBeeF and every un-upgraded install get, but it is no longer the path
> to design *from*.

beefweb has **no library API**. It sees playlists and the filesystem, and that is the whole
surface. foobar's Media Library is invisible to it.

The way through is an **autoplaylist**: a live Media Library query, created once inside
foobar (query `ALL`), which then appears in `/api/playlists` like any other playlist and
stays in sync as the library changes. That converts "there is no library API" into "there
is one, you switch it on once". Jean's first run must guide the user through creating it.

> **`foo_jean` may retire that guided setup**, and it is worth knowing before anyone
> invests in polishing it. The component being built at `~/Projects/personal/foo_jean`
> lists autoplaylist creation as one of its three goals, via the SDK's
> `autoplaylist_manager` — so where it is installed, Jean can create `#Jean Library`
> itself rather than talking a user through a desktop dialog. **The guided path still has
> to exist and still has to work**, because beefweb alone remains the minimum and always
> will; this only means the manual route stops being the only route.

Three rules follow, all of them load-bearing:

- **Never read or write `Default Playlist`.** It is foobar's scratch buffer — selecting an
  album in the library view replaces its entire contents. Measured: it went from 30,441
  items to 12 in the space of an hour. Any design that treats it as a library is broken.
- **The name is the contract: `#Jean Library`, matched exactly.** Playlist IDs are neither
  contiguous nor guaranteed stable — creating one produced `p7`, not `p6`, and the spec only
  promises stability while the player runs — so the title is the identity and there is no id
  to pin. This replaced a stored-id → remembered-title → *anything loosely called "Library"*
  ladder, which adopted a handful of production-music cues under that name as someone's whole
  collection and then reported its size as theirs. A name nobody types by accident removes the
  guess rather than guarding it, so the `itemCount` sanity-check that ladder needed is not
  required and was never built.
- **It is Jean's, so it is not furniture.** Anything titled `#Jean…` is filtered out of the
  sidebar, the command palette and the routing fallback — see `library/jeanPlaylists.js`,
  which owns the namespace for both this and the search scratch.

Fallback for users who won't create an autoplaylist: Jean can build its own playlist from
`/api/browser/roots` via `POST /playlists/add` + `items/add`. That mirrors the *disk* rather
than the library and needs manual refresh, so it is a second choice, not the default.

### The library API — wired, behind a source seam

**The development player runs a pre-release beefweb**: `0.11~git.dc0fdfc`, CI's merge
of [PR #382](https://github.com/hyperblast/beefweb/pull/382) into master, installed
from the GitHub Actions artifact. Jean uses it when it is there and falls back when it
is not. Released beefweb is 0.10 and has none of it; DeaDBeeF never will.

#### The endpoints

| | |
|---|---|
| `GET /library/info` | `{supported, enabled, itemCount}` -- 8 ms, and the only one that answers without the API |
| `GET /library/items` | `{offset, totalCount, items:[{path, subsong, columns}]}`; `columns` required, `range` optional |
| `GET /library/items/by-path` | one tree level; folders with a recursive `itemCount`, then tracks |
| `GET /artwork/library?path=&subsong=` | artwork with no playlist involved |
| `POST /playlists/{id}/items/add-from-library` | `{items \| query, index, replace, play}`, needs `changePlaylists` |

Full shapes and measurements in `API.md`.

#### `library/librarySource.js` is the seam, and the only place that knows

Two sources, one interface: `{ kind, playlistId, needsHeldCount, artworkUrl(ref),
fill(targetId, refs, heldCount), addTo(targetId, refs), playingPosition(refs, track,
activeItem) }`.

**A ref is an integer.** The playlist source's is a playlist index; the library
source's is a position in its own `paths` array. That is what keeps the seam from
leaking: `indices`, `useTrackSelection`, the search index and the whole virtualised
list stay integer-keyed and never learn which source they are looking at. Only the
things that *act* on a row resolve the ref, and they do it through the source.

**If something outside that file has to ask which source it is, the seam is in the
wrong place.**

#### Which view uses which, and why

**`#/search` uses the library API. A playlist route never does.** *Measured* against
the live player: `#/p7` issues five `playlists/p7/items` reads and 370
`artwork/{plid}/{index}`; `#/search` issues two `library/items` and thirty
`artwork/library`.

That is deliberate. **Playlists are playlists** -- `p7` is a real playlist on the
player, Jean shows it under its real name and reads it as one. It cannot tell that a
user made it to stand in for the library, and reading it through the library API
would be lying about which object is on screen. The two are not even the same set
once the autoplaylist's query drifts from `ALL`.

Consequence: the autoplaylist is **not** the browse view. On a 0.11 player it is not
read at all -- it is only resolved when there is no library API, or when
`changePlaylists` is false and playing in place is the only way to play anything --
and on every player it is hidden from the sidebar. That was **parity, chosen over a
feature**: the visible autoplaylist was an accident of it being a real playlist, and
letting people browse through it would have made a contract out of something a 0.11
install cannot honour.

The library is browsable now, and it took the home screen to make that honest.
`#/all` is a *view over the library array*, projected through the source seam like a
shelf or a set of results, so both sources produce it identically and neither is
pretending to be a playlist. What is still not built is a **folder tree**:
`/library/items/by-path` is measured and documented in `API.md` for when that happens
-- one request per level, 32-175 ms, ordering that needs a client-side re-sort.

#### Rules that are not obvious

- **The source is chosen by what can actually play**, not only by what exists:
  `useApi = hasLibraryApi && (canWrite || !playlist)`. Playing a set of results always
  needs a playlist to play it *in* -- there is no "play this library item" -- so on a
  player that refuses playlist writes the API can browse but never play, while an
  autoplaylist can still be played in place. Prefer the one that works.
- **`Array.from(refs, …)`, never `refs.map(…)`.** Refs arrive as an `Int32Array` from
  the search index, and mapping a typed array returns a typed array: the objects are
  coerced to `NaN` and the request body serialises as `{"0":0,…}` rather than a list.
  `copyPlaylistItems` has guarded this for the same reason since before the seam.
- **Search filters client-side, always.** `query` is the player's own syntax and does
  not agree with Jean's `fold()`-based token matching, so filtering client-side and
  adding server-side by `query` would add tracks that are not the ones on screen.
  Address adds by explicit `items: [{path, subsong}]`.
- **Chunking inverts on this endpoint.** One small chunk to paint, then a **single**
  request for the rest -- never wide. See "Loading it" for the numbers.
- **The library is read with an explicit `sort=%path%`**, which is what the endpoint
  defaults to anyway -- verified, `sort=%path%` and no sort return byte-identical lists
  over 30,441 tracks. It is stated so that the expression a filled playlist is sorted
  by is demonstrably the same one the rows on screen are in, rather than two defaults
  that agree today. Change one and you change the other.
- **Row order is the API's default (file path)**, and that is deliberate. *Measured*
  on a 30,441-track library: path order gives 2,382 contiguous album runs against
  2,386 for a tag sort, for 2,366 albums. A tag sort is fractionally *worse*, because
  server-side sort is exact-string lexicographic and splits `5 Seconds Of Summer` from
  `5 Seconds of Summer` -- the drift `sameTagValue()` exists to absorb, except once
  the order is wrong the client cannot fix it. A badly-foldered library gets more,
  smaller album groups; that is a degradation, not a requirement, and no user is ever
  forced into a file layout.
- **`%path%` and `%subsong%` are in `TRACK_COLUMNS`** for identity, not display -- one
  string per player update, not per row. The player reports an **absolute** path and
  the library a **relative, forward-slashed** one, and Jean is never told where the
  library folders are, so they are matched by suffix: `pathMatchesLibraryPath()`.

#### Filling a playlist from the library

Playing a set means writing it to the scratch playlist and playing a position in it,
and both halves of that were wrong on a real player while every test passed.

- **Do not name the whole library.** 30,441 tracks as explicit `{path, subsong}` is a
  2.9 MB body, and **beefweb hangs up over 1 MiB** -- measured, 1,018,757 bytes
  accepted and 1,049,652 refused mid-upload, which arrives as a network error rather
  than a status. So `fill` threw and the play waiting on it never happened: that was
  the whole of "All music will not play". Omitting `items` and `query` means *the whole
  library*, in one request with no body, in **299 ms**. Anything smaller is named, in
  chunks well under the cap -- the player resolves paths at ~1.2 ms each, so going wide
  buys nothing.
- **Then sort the playlist by `LIBRARY_SORT`, because the fill order is the player's,
  not Jean's.** A set comes back in the media library's browse order, and the view is
  in path order; every position Jean computes from a row therefore addressed a
  different track. Not predictable (no `sort` expression reproduces the browse order --
  `%album artist%` matches 9 positions out of 30,441) and not worth learning (reading
  the filled playlist back is 3.2 MB and 680 ms here, ~21 MB at 200k, and there is
  **no library-change event** to invalidate it against -- `library` is not a valid
  `/api/query` key). So it is overwritten rather than predicted: one `items/sort` by
  the same expression the library was read with, ~340 ms, no client state, nothing to
  go stale. Verified at 100, 1,000, 4,000 and all 30,441 -- every position correct.
- **`addTo` does not sort.** That playlist is the user's and its order is theirs;
  re-sorting it to suit Jean would be rearranging somebody's music as a side effect of
  adding to it. Undo is unaffected either way -- it removes the range that was
  appended, not particular rows.
- **The fake models all of it** -- the 1 MiB hang-up, the browse order, `items/sort`.
  It used to preserve whatever order it was given, which made every position correct in
  tests and wrong on a real player. A fixture whose folders match its tags cannot tell
  the two orders apart, so `mediaLibrarySize` synthesises a library where they disagree.

#### Still open

- No folder tree. `#/all` browses the library as one flat list; walking it by folder
  is a separate feature and `/library/items/by-path` is measured for it.
- Reconciling a stale `itemCount` is **partly** built: `usePlaylists` and `useLibraryInfo`
  refetch on window focus, so a count edited on the desktop is corrected on the way back
  and the views keyed on it re-key. The live `playlistItems` tripwire in `API.md` is still
  not wired; the arithmetic that cannot survive being wrong re-reads the count itself.
- `Mosaic` is **on hold at the owner's request** -- changes coming there, do not test or
  rework it yet. Artwork loading was on hold with it and no longer is; see the artwork
  queue under *Rendering*.

### Never mutate playlists as a side effect

**Browsing and playing must never create, clear, reorder or overwrite a user's playlist.**
The library being a real playlist makes this easy to hold:

- **Play a track** — `POST /player/play/{playlistId}/{index}` plays it in place. Nothing is
  written.
- **Play a *set* — a search, a selection — and a playlist is the only mechanism.** This
  used to say to use the play queue and specifically not to build a scratch playlist.
  That was wrong on the measurement: `/playqueue/add` takes one item per request with no
  bulk form, so any real set is hundreds of calls, and the player has no other way to say
  "these tracks, in this order". Search results therefore materialise into a playlist —
  see *Search results are a view until you play them*. It is not a side effect: browsing
  and typing still write nothing, and it happens only when someone asks to hear something.
- **Never `POST /playlists/{id}/items/sort` to browse.** It mutates. It is a tool for
  building derived playlists on explicit request only.

This is about side effects, not capability. **Explicit user intent is different** — if the
user asks to add an album to a playlist, reorder one, or delete tracks, do exactly that. A
player UI that cannot manage playlists is crippled.

What Jean does legitimately change: **playback state** (play, pause, seek, volume, playback
order, output), **the play queue**, and **`/api/clientconfig/{id}`**, which is Jean's own
data. Note also that playing a track has downstream effects on the user's data — it
scrobbles and increments play counts, and on some setups rewrites the file's mtime.

### Showing playlists

**Show playlists under their real names. Never relabel or reinterpret them.** The one
exception is the `#Jean…` namespace, and it is not an exception to the *reason*: those
playlists are Jean's own, either created by it (the search scratch) or handed to it by
name (`#Jean Library`), so hiding them is not a guess about what a playlist means. Never
infer that role from a name the user chose. `Default
Playlist` is a volatile scratch buffer on one install and someone's primary working playlist
on the next; Jean cannot tell which, and guessing wrong means confidently mislabelling a
user's own data.

Use **`isCurrent`** to mark the playlist the player is playing from. It is maintained by the
player, it means the same thing on every install, and it is the honest way to surface "what
is happening on the desktop right now".

### Playlist kinds — real, but undetectable

There is a genuine functional split between playlist kinds:

| Kind | Editable? | Stable? |
|---|---|---|
| Regular playlist | yes | yes — only the user changes it |
| Smart / autoplaylist | **no** — rejects add, remove, reorder | no — the library drives it |
| `Default Playlist` | yes | **no** — foobar's own UI clobbers it |

**The API cannot express it.** `PlaylistInfo` has exactly six fields — `id`, `index`,
`title`, `isCurrent`, `itemCount`, `totalTime` — verified against both the live API and
`docs/player-api.yml`. `GET /playlists/{id}` returns the same six. **There is no
autoplaylist flag. Do not go looking for one again.**

Every detection route is worse than not detecting: probing with a mutation is destructive,
inferring from `itemCount` drift is slow and cannot separate a smart playlist from
`Default Playlist` churn, and name heuristics only catch foobar's `#Quicksearch` prefix.

So handle the split by design rather than detection:

- **Volatility mostly does not matter.** Only the library playlist gets the expensive
  indexed treatment. Every other playlist is small enough to read on demand, so there is no
  stale cache to protect and auto-updating is harmless.
- **Editability is graceful failure.** `permissions.changePlaylists` can already deny an
  edit, so that code path must exist anyway. Attempt, catch, explain. Then *learn* — record
  the refusal in `clientconfig` so edit affordances disappear from that playlist afterwards.
- **Hierarchy belongs to the user.** Let people pin, group and order playlists in Jean's
  sidebar, stored in `clientconfig` so it follows them across devices. Library pinned at the
  top as the primary browse entry. This is tier three of the source-of-truth ladder, and
  legitimate precisely because foobar exposes no such concept.

### Search results are a view until you play them

Searching is a client-side filter over the in-memory library index: **no request, no
playlist created, nothing written to the player.** Do not render it as a playlist in the
sidebar — that invites the expectation that it persists.

**Playing is the exception, and it has to be.** beefweb plays from playlists and knows
nothing else, so playing a result in place — by its index in the library playlist — leaves
the player carrying on from *there*. The next track is the library's next track, and with
shuffle on it is a random one out of everything. Neither is what a list of matches on
screen promises. So the results are materialised into a real playlist at the moment
someone asks to hear them, and playback happens inside it. Every playback order then means
what it says: Default stops at the end of the results, Repeat loops them, Shuffle shuffles
them.

- **One playlist, reused, not one per search.** `#Jean [query]` — the title carries the
  query so the thing is self-describing wherever it surfaces, including foobar's own
  sidebar next to its `#Quicksearch [...]` playlists, and on another device. Reusing it
  avoids id churn and means never deleting something that is currently playing.
- **Resolved by stored id, falling back to the title**, the same ladder the library
  playlist climbs and for the same reason.
- **Hidden from Jean, visible in foobar.** There is no hidden-playlist concept and beefweb
  cannot fake one, so it is filtered out of the sidebar, the command palette, the library
  and the routing fallback — the last of those because playing a set makes it the
  *current* playlist, and landing there on next open would show those results stripped of
  the search that made them. Reordering is where the hidden row still has to be counted:
  the player orders the real list, so a drop position among the visible rows is translated
  through whichever playlist currently occupies it.
- **Lazy.** Nothing is written while typing or refining. The player only hears about a
  result set once someone plays from it, and a second play of the same set reuses what is
  already there.
- **The playlist is how a search survives, and how it travels.** The query was only
  ever in memory, so a reload lost it and another device never had it. The player is
  holding a playlist named after it, which every client can already see -- so a reload
  onto `#/search` takes the query back, and the sidebar offers it wherever you open Jean
  next, marked as the thing being played from since the playlist itself is hidden. Reading
  the title costs nothing and, in particular, does not touch the library: a session that
  never searches still never loads it, and taking a remembered search back is what pays
  for the index. Jean needs no state of its own for this; `clientconfig` would be a second
  copy of something the player already knows.
- **Saving results as a playlist renames the scratch rather than copying it.** When the
  scratch already holds exactly these results it *is* what is being saved, so it is
  renamed and stops being Jean's. Nothing is copied, no near-duplicate is left beside the
  original, and -- measured against the live player -- playback carries straight on
  through the rename, same track, same position, because it is the same playlist. The
  search then leaves the sidebar on its own: there is no scratch playlist to remember it
  by. Falls back to create-and-copy when the scratch holds something else, or when there
  is none because nothing was played.

  The stored id must be re-checked against the title after this, and the pin cleared:
  the id now points at the *user's* playlist, and resolving the scratch by it would hand
  their playlist to the next search, which empties what it finds before refilling it.
  Two guards for one mistake, because the cost of it is their data rather than a wrong
  view.

- **Dismissing the search deletes it, unless the player is on it.** Nobody asked for a
  leftover playlist named after a search they closed, and saving results as a real
  playlist finishes the search off the same way. But *measured*: deleting the playing
  playlist does not end playback at the end of the track -- the player falls back to
  another playlist and carries on, which is exactly the wandering out of the results this
  arrangement exists to stop. So it outlives the search for as long as it is being
  listened to, and the next search played from takes it over. The check is the active
  item's `playlistId`, not `isCurrent`: that stays pointing at the last playlist played
  from long after playback stopped, and would have kept the scratch alive forever once it
  had been used once.
- **`permissions.changePlaylists: false` means no scratch playlist**, so results fall back
  to playing in place and the Shuffle button goes. Degraded, and honestly so.

**Do not reach for the play queue here.** `/playqueue/add` takes one item per request and
has no bulk form — measured, both `{items: [...]}` and an array `itemIndex` return 400 —
so any real set means hundreds of calls behind a lookahead cap nobody can see the edge of.

*Measured* against the live player: copying 500 indices takes 17 ms, 5,000 takes 33 ms and
20,000 takes 166 ms, so materialising is cheap even at library size. Emptying a playlist
that is currently playing leaves the track playing but detached — `activeItem.index` goes
to -1 — which is harmless only because a play always follows immediately.

**beefweb cannot reach other components.** `/api/commands`, `/api/mainmenu`,
`/api/contextmenu`, `/api/plugins` are all 404. `foo_quicksearch` builds a real playlist
that Jean can read like any other, but nothing can trigger it from here.

### Loading it

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
  search — and neither may fetch its own copy. `playlist/playlistStore.js` owns it.
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

### Rendering

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

`ui/artworkQueue.js` is the answer, and the load-bearing part of it is **time, not
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
in `playlist/grouping.js` points every row at its album run's first row, off the
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

### Menus, gestures and other shared behaviour

`ui/ActionMenu.jsx` is the only menu surface in the app. Actions are declared as **data**
and the surface decides how to draw them -- a popover at the pointer on a desktop
viewport, a floating action sheet on a compact one. Adding a menu anywhere means writing
an array, not another component.

- **An action sheet, not a bottom sheet.** Detached from every edge, all four corners
  rounded, floating above the safe-area inset. The edge-to-edge kind is Spotify's, and is
  also the less interesting of the two.
- **Nested pages slide in place, on desktop too**, rather than flying out to the side. A
  flyout that closes when the pointer strays is the wrong place to put a confirmation,
  and one drill-in implementation beats two half-tested ones. **Destructive actions
  confirm on a nested page** -- same machinery, no dialog component, identical on both
  surfaces.
- **A nested page can be typed at.** `filter: '<placeholder>'` on a submenu node puts a
  field at the top of its page, pinned rather than scrolling away with the list it
  filters; Enter takes the first match. It matches through the same `fold()` the library
  search uses, so typing at a menu behaves like typing at the search field.
- **A sheet with a field in it has to follow the visual viewport.** A `position: fixed`
  element is laid out against the *layout* viewport, which neither platform shrinks for
  the keyboard -- iOS does not resize it at all and Chrome defaults to
  `interactive-widget=resizes-visual` -- so a bottom-anchored sheet puts its own field
  under the keyboard the moment you tap it. `ui/useVisualViewport.js` sizes the scrim to
  `visualViewport`, which makes "above the keyboard" fall out of the existing
  `align-items: flex-end`, and follows `offsetTop` as well, because iOS scrolls the page
  to reveal a focused field. It writes to the element, not to state: iOS fires a stream
  of these while the keyboard animates.
- **The field takes focus on the popover and waits to be tapped on the sheet.** Most opens
  of a menu are scroll-and-tap, and those should never cost half the screen.
- **`touch-action: none` intersects down the tree.** It was on the sheet's scrim and would
  have left a long list unscrollable on touch. It was never needed either: the scrim
  portals to `<body>`, which has nothing to scroll.
- **The accent budget of a menu is the two-pixel rail on the item under the cursor.**
  Scaled, not faded, so it grows out of its own centre.
- **A tap plays; a click selects and a double-click plays.** The split is the
  pointer, not the viewport -- the same rule `useSortableList` uses to decide
  that only a mouse drags a row. On a pointer a selection is worth having,
  because the modifier keys exist to build one and every file manager separates
  choosing from opening. Touch has neither, and a tap that only highlighted left
  the phone with no way to play an individual track at all: the header Play
  button was the entire surface. Bound to `click` rather than `pointerup`,
  because the browser withholds it when the gesture turns out to be a scroll --
  which is most of what a finger does in a list -- and because `useLongPress`
  already swallows the one that follows a hold. Both handlers sit on the rows
  container and find their row through `targetsFrom`; 30,000 rows must not each
  carry a closure.
- **A list that appears under a stationary pointer gets a `mouseenter` it did
  not earn.** The mouse has not gone anywhere; the element beneath it changed.
  The finder's results render exactly where the button that opened them was, and
  again under the same cursor on every keystroke -- so hover handed the active
  result to whatever happened to land there, measured as the fifth match, and
  Enter played that instead of the first. Hover has to prove the pointer moved:
  a flag re-armed per result set covers the ordinary case, and comparing the
  event's coordinates against the last seen ones covers the first move onto a
  result, where `mouseenter` arrives before the `mousemove` that would have set
  the flag.
- **`useContextMenu` unifies the three ways of asking for one**: right-click,
  press-and-hold, and the Menu key -- which reports no coordinates, so a keyboard
  invocation has to anchor to the element rather than to `0,0`.
- **`useLongPress` owns the echoes of the gesture, not just the gesture.** The synthetic
  click and, on Android, a native `contextmenu` both arrive after a hold has already been
  answered, and both have to be swallowed. Suppression is time-boxed rather than cleared
  by whichever event turns up, because which one turns up differs by platform: iOS sends
  the click and no contextmenu, Android the reverse, and waiting for a specific one
  leaves the guard permanently on.
- Anything long-pressable needs `-webkit-touch-callout: none` or iOS draws its own
  selection callout over the menu. `useLongPress` returns the style to spread.
- **While a menu is open, no key belongs to the app behind it.** Without stopping
  propagation, the arrow keys seek the player while you are choosing an action.
- **An exit animation's "closing" flag must be derived during render, not set in an
  effect.** An effect leaves one commit in which the menu is neither open nor leaving:
  it unmounts, the effect brings it straight back to play the exit, and that remount
  re-runs the surface's focus effect. Anything the chosen action just focused loses it —
  which is how Rename came to close itself on the phone, one frame after opening.
- **A menu returns focus only if it still has it.** An action is allowed to send focus
  somewhere on purpose; restoring blindly on close undoes that.

`ui/useSortableList.js` is drag-to-reorder for lists short enough to see at once. Rows
are measured on drag start, so variable heights need no special case. What is
load-bearing:

- **The drop is held, not cleared.** The reorder goes through the query cache, which is a
  microtask away at best, so clearing the transforms on `pointerup` flicks the row back
  to where it started for a frame. It keeps the landing transform until the caller's
  `keys` actually change, with a timeout in case the player refuses the move.
- **On a pointer the row itself drags, with no affordance at all.** That is what a
  sidebar of links does everywhere -- Finder favourites, Chrome bookmarks, Slack
  sections -- and a grip on every row is a permanent cost for something done twice a
  year. Grips are an *editor* idiom: they exist where a row has several parts and one of
  them has to be named as the one that drags.
- **Touch is a different question, not a smaller one.** There the vertical axis is
  already the scroller's, and the gesture that would normally settle it -- hold, then
  drag -- is spent on the menu. So a coarse pointer gets a permanent handle, because
  nothing else can claim the axis. Same fact, stated once in CSS and once in JS: the row
  starts a drag for `pointerType === 'mouse'` only.
- **A drag that starts on a link ends with a click on that link.** Reordering would also
  navigate. The gesture has to swallow its own click, exactly as the long press does --
  and the flag is cleared on the next pointer-down rather than on a timer, so a gesture
  that produced no click leaves nothing armed.
- **`setPointerCapture` moves the click, not just the pointer events.** It retargets the
  compatibility `mousedown` and `mouseup` too, and `click` is dispatched at the common
  ancestor of those two -- so capturing on a row makes every click land on the row
  instead of on the button inside it, and plain navigation silently stops working with
  no error anywhere. Capture only once the gesture is definitely a drag. A small handle
  is the exception and has to claim the pointer up front, because it can be left behind
  inside the threshold distance; a full-width row cannot.
- **Two behaviours on one element share their handler names.** A row that both
  press-and-holds and drags wants `onPointerDown/Move/Up/Cancel` twice over, and
  spreading one props object after the other drops the first silently. Compose them
  through `ui/mergeHandlers.js`.
- `Alt+Arrow` does the same from the keyboard, registered only while a row has focus.

### Dragging across containers

`ui/dnd.js` is the other drag primitive, and it is deliberately *not* built on
`useSortableList`. That one reorders a single list, where the dragged element stays
mounted and the drop position is arithmetic. Dragging tracks onto a sidebar playlist is a
different problem: the source row can be unmounted by the virtualiser mid-gesture, and
the target is elsewhere in the tree entirely. So the drop is decided by hit-testing the
document (`elementFromPoint` up to a `[data-drop-target]`), and what follows the pointer
is a ghost rather than the row.

- **No pointer capture, here of all places.** Capture retargets every later event to the
  capturing element, so a handler on a *descendant* of it never fires again -- and the
  natural capture element is the scroll container, which is an ancestor of the rows.
  Window listeners for the length of the gesture have none of that ambiguity.
- **The store carries only coarse facts** -- dragging or not, which target is armed.
  Those change rarely, so subscribing is free, and the track list does not subscribe at
  all. It must never re-render during a drag.
- **The ghost is moved imperatively**, because position is the one thing that changes
  every frame. It is two elements: a CSS animation beats an inline style, so an entrance
  touching `transform` would override the position and the ghost would fly in from the
  top-left. Outer element owns position, inner owns anything that animates.
- **Pressing inside a multi-track selection must not collapse it on pointer-down.** That
  decision waits for the release -- otherwise the selection is gone before the pointer has
  moved a pixel and a multi-track drag cannot exist. Every file manager does this.
- Hit-testing runs on a frame rather than on the move event, so a target that autoscrolls
  under a stationary pointer still arms.
- Drag is mouse-only, and the mobile path is the menu. There is nothing to drag onto on a
  phone: the sidebar is a drawer that covers the list it would be dragged from.

### Layout

The app shell is a `100dvh` grid, rows `auto / 1fr / auto` — chrome, content, status bar —
where **the content row is the only scroll container**. Not `vh`; mobile browser chrome
breaks it.

That one choice buys three things: the status bar is pinned by construction rather than
`position: sticky` (no z-index fights, no iOS sticky bugs), the virtualizer gets the
explicit scroll element it needs, and safe-area insets have somewhere to live. Do not move
scrolling to `<body>`.

The status bar is **one component with two shapes**, not two components: a full-width
footer on desktop, a compact strip that expands to a full-screen sheet on mobile.

Model **what is playing** separately from **where it is playing**. Output is a named
target, not an assumption that audio comes from the remote player.

### Two breakpoints, and they are not the same one

**CSS switches at 720px. JavaScript switches at 860px.** `useIsCompactViewport()` drives
the things that are a different *component* below it — the sidebar becoming a drawer, the
action sheet instead of a popover, the album cover stacking above its tracks, how many
columns are worth showing. The media queries drive the things that are the same component
at a different *size*: gutters, type, row heights.

That split is defensible, but the band between them is real and easy to forget. An album
group once took its horizontal gutter from `data-compact` — a JS-driven attribute — while
the toolbar above it took its own from a media query, so between 720 and 860 the list
indented itself to the phone gutter and nothing lined up with anything. **Anything
spatial belongs to the media query.** If a JS flag is setting padding, that is the bug.

### One gutter per row, and the wash follows it

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

### Keyboard

Virtualization and keyboard navigation collide: the virtualizer unmounts the focused row
when it scrolls out of view, and DOM focus evaporates. So **the active row is an index in
state**, and the virtualizer is told to scroll that index into view. A roving `tabindex`
alone will not survive. Every list component must be built knowing this.

**A hotkey that has stopped working in dev is probably a stale registration, not a bug.**
`useKeymap` registers into a module-level manager that resolves conflicts when two
registrations claim the same key. HMR remounts a component and re-registers while the
previous module instance's registration may still be in the registry; the survivor can be
holding a callback from the dead closure, so the binding looks bound and does nothing.
Full reload before debugging.

**`=` and `-` are only reachable on layouts where they are unshifted.** The matcher
compares modifier state strictly, so on Spanish, French and German layouts — where `=` is
`Shift+0` — volume up is simply unreachable, with no error. It falls back to `event.code`
only when `event.key` does not match, and the code there is `Digit0`, not `Equal`. Known,
unfixed: the fix is to declare both spellings in the keymap, or to pick keys that are
unshifted everywhere.

Position updates arrive only on change events, so the progress display **interpolates**
locally (`src/player/position.js`). `<SeekBar>` runs the animation-frame loop and is
deliberately a leaf — that state must never be lifted, or it will one day repaint a
virtualised 30k-row list sixty times a second.

### Theming

The accent is `#ffb454` on `#0e1013` — effectively the Ayu Dark palette, and the
identity of the app. Keep the warmth.

`#ffb454` on white is ~1.7:1 and unreadable, so the **light theme must darken the accent**
(Ayu Light's `#fa8d3e` is the reference), not reuse it. Define both themes in `oklch` as
one hue with different lightness ramps, so they stay in sync rather than drifting into two
hand-tuned palettes.

## Capability detection

A title-formatting field that **does not exist returns `?`**. A field that exists but is
empty returns `0`, `''` or `N/A`. That difference is the whole feature-detection mechanism:
probe a set of columns against a few sample tracks on connect, and enable features for
whatever resolves. Users can override in settings when detection guesses wrong.

*Measured* against a real foobar2000 install, probing 50 expressions across both
sources: **the autoplaylist and the media library API resolve byte-identical values for
every field**, so a column that works on one works on the other and capability
detection never has to ask which is in play. What that install resolves, and what it
does not, is worth knowing before designing a feature on it: `%genre%` (144 distinct),
`%year%` (69), `%album artist%` (742), `%lastfm_play_count%` (every track),
`%lastfm_last_played%` (69% of them), `%publisher%`, `%date%`, `%length_seconds%`,
`%codec%`, `%bitrate%` and `$len($meta(unsynced lyrics))` all answer. `%added%`,
`%play_count%`, `%last_played%`, `%rating%`, `%composer%`, `%bpm%`, `%totaltracks%`
and `%replaygain_*%` do not. **Ratings exist but are sparse**: `$meta(rating)` and
`%rating%` both answer on exactly 500 of 30,441 tracks — an earlier note here said
they were empty on every track, which was a five-row sample landing on unrated ones.
Sparse is its own trap: 375 of those 500 are the value `5`, so anything sorting by
rating is sorting a flat tie, and a 200-row capability sample misses the field
entirely about one library in twenty-five. Those are one install's components, not a
rule: detect, never assume, and sample properly — or, where the field is this sparse,
do not sample at all. **`$meta(x)` cannot be feature-detected**: it answers `''` for
a field that does not exist, where `%x%` answers `?`. Verified across `$meta(rating
wmp)`, `$meta(popularimeter)`, `$meta(rating winamp)`, `$meta(popm)` and
`$meta(fmps_rating)`, all of which return `''` on every one of 30,441 tracks and none
of which distinguishes "no such field" from "nothing in it".

`player.info.name` distinguishes foobar2000 from DeaDBeeF. Support DeaDBeeF on a best-effort
basis — feature detection covers most of it. Do not invest in a second title-format dialect
without a real report.

## API facts that will bite you

`API.md` is the full surface. The traps worth repeating:

- **The column list is split on commas before evaluation**, so any title-format function
  taking more than one argument is unusable — `$if(a,b,c)` arrives as three columns.
  **Single-argument functions do nest**, though: `$len($meta(unsynced lyrics))` works. Use
  that for cheap server-side computation.
- **`%added%` does not exist** — it returns `?` on every track, so there is no
  date-added field at any price. `%date%` is a different story and the previous note
  here was wrong: *measured* over 30,441 tracks it resolves on 30,347 of them —
  26,891 year-only (`2010`), **3,022 full ISO dates** (`1992-10-13`), and 434 untidy
  (`1997, 1997-02-10`, `2011-00`, `2010-09-28T07:00:00Z`). It is an ordinary messy
  user tag, not a mangled constant. **Still sort and group by `%year%`**, which is
  clean and integer-shaped; reach for `%date%` only where a real release date is worth
  having, and parse it leniently.
- **`%last_modified%` is not a date-added field.** Playback can rewrite tags, which bumps
  the file mtime — measured, the mtime moves ~55 s before the scrobble lands, and 21% of
  played tracks have an mtime within ten minutes of their last play. It is
  `max(added, last played or retagged)`, and it is wrong precisely at the recent end. Build
  "recently added" from Jean's own first-seen index instead, seeded from mtime on first
  sync.
- **Lyrics are `$meta(unsynced lyrics)`** — with a space, and it holds LRC-timestamped
  content despite the name. Reading them needs **no component**; they're an ordinary tag.
  `%lyrics%` returns `?` and `$meta(unsyncedlyrics)` finds nothing.
- **`GET /api/player` ignores `trcolumns`** and returns `"columns": []`. Use
  `GET /api/query?player=true&trcolumns=…`.
- **Volume is decibels** (`-100..0`), not a percentage, and `volume.type` says so --
  another player may report a linear range. `src/player/volume.js` maps the fader
  **linearly in perceived loudness**: +10 dB is about twice as loud, so the
  fraction becomes `max + 10 * log2(f)` and half the slider is half as loud, a
  quarter is a quarter as loud. Equal distances are equal *ratios* of loudness
  wherever they are taken from, which is the only promise a fader makes.
  It replaced squaring the distance from the top -- the same instinct applied far
  too hard, which put the midpoint at -25 dB and 15% at **-72 dB**, silence rather
  than quietness, so the bottom third of the travel did nothing and the top third
  did all of it: ten points from 70 to 80 crossed 5 dB while ten from 10 to 20
  crossed 17 dB of inaudible nothing. Linear in *amplitude* (`20 * log10(f)`,
  roughly macOS) fails the other way on a range reaching -100 -- the midpoint
  lands at -6 dB and everything under -26 dB is crammed into the bottom
  twentieth.
- **`itemCount` in `PlaylistInfo` goes stale and nothing corrects it.** *Measured*:
  the update stream pushes `playlists` when a playlist is added, renamed or deleted,
  and pushes nothing at all when its *items* change. So a cached count is wrong from
  the first `items/copy` onwards. Re-read it from the player before doing arithmetic
  with it — how many rows to remove, whether a cached view still matches, whether an
  undo range is still the range it was. Trusting it emptied 99 rows out of a 113-row
  playlist and then played whatever had drifted into the row that was clicked. A
  one-item `playlistItems` subscription is a cheap tripwire if you need to notice;
  see `API.md`.
- **A set arrives in an order of the player's choosing, never the order you asked
  for.** `items/copy` returns playlist indices ascending, so the playlist source is
  safe once refs are sorted. `add-from-library` is **not**: it returns the
  media library's *browse* order -- album artist, album, track -- which is not the
  file-path order `/library/items` pages in. *Measured* on 30,441 tracks: of 100 sent
  in path order 10 landed elsewhere, of 1,000 426 did, of 8,000 3,945 did. Sorting
  refs ascending is necessary and **not sufficient**; see "Filling a playlist from the
  library" below for what is.
- **Playlist items have no ID.** Index is identity, so any mutation invalidates indices
  you were holding.
- **SSE is change-driven, not a ticker.** Long silences are normal; `position` alone never
  triggers a message.
- **The static server has no SPA fallback** — `/playlists/p2` is a 404. Use hash routing.

## Generality constraints

Things that vary between installs and must never be assumed:

| | |
|---|---|
| Which playlist is "the library" | An autoplaylist the user creates and names `#Jean Library`. Guide them through it on first run; match the name exactly and never a title they chose. Never assume `p1` — that is scratch space. |
| `permissions` | `changePlaylists`, `changeOutput`, `changeClientConfig` come from the player. Gate the UI on them — a read-only instance gets a read-only Jean, not buttons that 403. |
| `authRequired` | May be on. Support Basic auth and a credentials prompt. |
| `pathSeparator` | From `/api/browser/roots`. `\` on Windows, `/` elsewhere. |
| Library size | Anywhere from empty to 200k+. |
| Components | Detect, never require. |
| Player | foobar2000 or DeaDBeeF. |
| Keyboard layout | A binding written as an unshifted key is not unshifted everywhere. See the keyboard section. |

CORS is off in beefweb by default, so Jean must be served same-origin — either by beefweb
itself, or through a dev proxy. See `README.md`.

## Code layout and conventions

```
src/
  api/        beefweb client -- every fetch to the player lives here
  app/        shell: App, Sidebar, CommandPalette, theme, hash routing
  home/       the home screen: the library's own stats, album aggregation, shelves
  library/    the library as one array, its source seam, and the views over it
  hooks/      shared, generic (useDebounced, useMediaQuery, useStoredState, ...)
  keyboard/   keymap.js, useKeymap, ShortcutSheet
  player/     transport, seek bar, player state and mutations
  playlist/   the playlist view and everything it needs
  ui/         shared presentational pieces and DOM helpers
  styles/     tokens.css and base.css -- the only global CSS
```

**Styling is CSS Modules, colocated with the component.** The only global stylesheets
are `styles/tokens.css` (the palette and scale, as custom properties) and
`styles/base.css` (reset and a couple of utilities). That split is deliberate:
someone re-theming Jean should only ever need to edit ~30 lines of custom properties,
with no build step and no knowledge of our class names. Do not add global classes for
component styling.

**Context menus come from `ui/ActionMenu.jsx`, as an array of actions.** Never hand-roll
a popover, an action sheet or a confirmation dialog -- the gestures, the keyboard
handling, the nested pages and both surfaces already exist there, and a second
implementation of any of them will be the one that is wrong on a phone. `ui/Menu.jsx` is
a different thing and stays: a dropdown anchored under a button you can see, which needs
none of that. Menu *you asked for* against menu *you summoned*.

**Notifications come from `ui/toasts.js`, and only for things you cannot see.** Pushing
one is a bare function call from anywhere, deliberately -- it is a module-level store
rather than a context because a provider holding the list would re-render the virtualised
track list every time a toast appeared or expired.

**Keyboard bindings are declared in `keyboard/keymap.js` and nowhere else.**
`useKeymap(scope, handlers)` registers whatever that scope declares and has a handler
for, and `ShortcutSheet` renders the help overlay from the same array — so the
documented shortcuts cannot drift from the real ones. Adding a binding means adding a
row there and a handler; never call `useHotkey` directly in a component.

**Anything the user types at a list is matched through `fold()` in `ui/text.js`**, which
lowercases and strips diacritics, so `babasonicos` finds `Babasónicos`. Requiring people
to type the accents in their own library taxes exactly the tracks they are most likely
to be hunting for, and from outside it does not look strict, it looks broken. Fold when
the haystack is *built*, never per keystroke: measured over 30,441 rows, folding the
whole index costs ~6 ms against the ~0.6 ms a plain lowercase took, and a search is still
one `includes()`. Both sides have to go through it -- fold the query too, or an accented
query stops matching the folded index.

**Tag hygiene is the library owner's business, never Jean's.** Jean reads tags, and
never writes or normalises them to make its own life easier. A genre spelled two ways
is two rows in a list, and that is the correct amount of harm: the owner can fix it in
foobar2000, where genres are actually browsed and where the fix sticks for every other
client too. Building a normalisation layer to hide it would make Jean disagree with the
player about what the library contains, which is a worse bug than the one it papers
over. The corollary is the rule below, and it is the whole of Jean's involvement.

**Compare tag values loosely, display them exactly.** Tags drift in case and spacing
between files in the same album -- `5 Seconds Of Summer` and `5 Seconds of Summer` are
one artist. Anything comparing tags to decide what the user sees goes through
`sameTagValue()` in `playlist/fields.js`; anything rendering a value still shows the
original spelling. A strict `===` here makes a track look like a guest on its own
album, and splits one album into two groups mid-run.

**Never gate behaviour on a `mounted` ref set only in an effect cleanup.**
StrictMode mounts, unmounts and remounts in development, so the cleanup sets the
flag false and nothing sets it back -- the guard is then permanently on, in dev
only, and silently disables whatever it protects. If a guard is genuinely needed,
set it true in the effect body as well. Usually it is not needed: work that only
touches refs and network calls is safe to finish after unmount, and finishing it
is often the correct behaviour.

**A touch target is not a pointer target, and a fader is where that shows.** The
mobile volume column was 26px of track -- a thumb is about 44px of contact, so it
missed often, and a miss there does nothing at all: the popover sits in the status
bar, outside the only scroll container, so there is not even a page pan to blame
it on. A control that ignores every second attempt feels broken without ever being
wrong. The hit area is widened on `(pointer: coarse)` while the visible rail stays
4px, and the thumb is drawn permanently there, because on touch there is no hover
to reveal it with and a thumb that appears once you are already dragging is one
you aimed at from memory. The keyboard-shortcuts button goes on the same query and
for the same kind of reason -- and nothing is lost where a keyboard exists, since
the sheet is bound to `?`.

**A control you drag must be unselectable.** Press on a slider without
`user-select: none` and the browser starts a text selection running out across
whatever sits beside it; dragging a selection is a native drag, so it paints a
translucent snapshot of the control and follows the pointer with that instead of
moving the thumb. It looks like the slider has come loose, and it reads as
intermittent because it depends on where the press landed and what was already
selected. `useDragFraction` returns the style with its handlers so the two
cannot be separated. It carries `touch-action: none` as well, which each consumer
used to declare in its own CSS: without it the browser keeps the gesture for
panning and cancels the pointer stream mid-drag -- *measured*, a swipe aimed at
25% lands at 74% -- and a guarantee a primitive depends on should not be one every
caller has to remember.

**Writes driven by a drag must be coalesced, not fired per event.** One pointer
gesture is ~40 pointer moves; a request each floods the player, and the responses
can land out of order so the last value to arrive wins rather than the last one
sent. `useCoalescedWrite` keeps one request in flight and sends the newest value
after it. Drag state stays local to the control -- writing it into shared player
state on every move re-renders every subscriber, including the virtualised list,
for the whole gesture.

**`<Artwork>` takes a URL, not an address.** It used to take `playlistId` and
`index` and build the URL itself; it now takes `src` and is purely presentational.
*Where* artwork lives is the source's business -- a playlist addresses it by index,
the media library by path, and the status bar by whatever the player is currently on.
Anything drawing a row's cover calls `source.artworkUrl(ref)`.

**List components take `source`, not `playlistId`.** `TrackBrowser`, `TrackList`,
`TrackRow`, `AlbumGroup` and `Mosaic` all receive the source; so do
`useTrackContextMenu`, `useTrackDragSource` and `useAddTracks`. A component that
wants a playlist id for anything other than *identifying a playlist* is a sign the
seam has been bypassed.

**Comments explain why, not what.** No JSDoc. If a line needs a comment to say what it
does, rename something instead. The comments worth writing are the ones recording a trap
or a decision that looks wrong until you know the reason.

**Measurements belong in this file, not in the code.** A number in a comment is useful
while the thing is being written and noise for everyone who reads it afterwards -- it
dates, nobody re-runs it, and it is describing a machine that is not the reader's. Record
the constraint the measurement established ("beefweb hangs up on a body over 1 MiB",
"there is no way to ask for a thumbnail") and put the figures here.

**An animated scroll must not treat every wheel event as a decision.** Trackpad
and mouse momentum keep emitting for a second or more after the fingers have
left, so a jump asked for at the end of a flick gets cancelled by the tail of
the gesture that preceded it -- measured, a single delta of one pixel stranded
the scroll partway and left the target row not merely off centre but unmounted.
That is the whole of "jump to playing works sometimes": it depended on whether
the list happened to still be coasting. `animateScrollTo` accumulates wheel
delta and gives up at 40px, which deliberate scrolling passes in one or two
events and a decaying tail never reaches. A touch still cancels on contact,
because a finger on the glass is unambiguous where a wheel event is not.

**Animation is compositor-only by default** — `transform`, `scale`, `rotate`,
`opacity`. `border-radius` and layout properties repaint every frame; that is
acceptable for a single small element and not for anything in a list. Continuous
motion should layer animations with coprime durations rather than repeat a single
short loop, and must never move an element's position on screen.

That last rule is about the thing being *aimed at*, not about the pixels. The "Now
playing" pill's arrow nods, and it is on the icon rather than on the pill
precisely because the pill is a button: a transform on a child leaves the parent's
laid-out box exactly where it was, so what you are clicking holds still while what
you are looking at does not. It runs only while the pill is on screen -- the pill
stays mounted so it can animate out, and an animation ticking behind an invisible
element for a whole session costs something and shows nothing.

**Slow is not the same as smooth, and speed is not the whole of it either.** That
arrow first moved 2.1px over a 2.3s cycle -- about **1.8px a second** -- and read
as stuttering; raising it to 1.6px over 850ms, ~3.8px a second, was necessary and
not sufficient. It still read as *two frames*, up and down, and the cause was the
curve's shape rather than its speed: **any easing on a two-stop keyframe brings
the element to a dead stop at 0%, 50% and 100%.** *Measured*, 18% of frames moved
less than 0.02px -- visually nothing -- so the eye integrated the rest into two
resting positions with a flick between them. It is now a sine sampled into six
stops and interpolated `linear`, which has a non-zero slope in every segment: 2%
still frames, 2.4px over the same 850ms. `linear` there is load-bearing, not a
default -- an easing would turn the six stops into six little ease-in-outs and
reintroduce the stop six times over.

Two things were ruled out before the curve was, and both are worth ruling out
first next time. **Sub-pixel rasterisation**: pausing the animation at 34 phases
and hashing the rendered icon gave 31 distinct images at 1x DPR, so the browser
was drawing the in-between positions perfectly well -- there was nothing there to
draw. And **a per-frame figure judges the monitor, not the motion**: the same
animation moves half as far per frame at 120Hz, which is how the first
measurement here looked conclusive while being wrong. Per-frame numbers are only
good for comparing two curves on one display; state the speed in px/s and the
still-frame fraction, which are both display-independent.

## Development

```sh
pnpm install
pnpm dev            # http://localhost:5173, proxies /api to the player
```

Vite proxies `/api` to a real player, so development runs against live playlists and live
playback with no deploy step and no CORS. Point it elsewhere with
`BEEFWEB_URL=http://host:8880 pnpm dev`. The dev server binds on the LAN, so a phone can
load it directly for real-device testing.

Deploying is only for making it permanent — see `README.md`.

**Stack:** React 19 · Vite 8 · TanStack Query 5 · TanStack Virtual · TanStack Hotkeys ·
lucide-react · CSS Modules · pnpm · Playwright. No unit tests and no jsdom, on
purpose: the things that break here need real layout, real pointers and a real
viewport. See `test/README.md`.

Playing from All music, a shelf or a set of search results goes through the same
`fill`, and what makes the position it then plays mean anything is the sort that
follows -- see "Filling a playlist from the library".

**Built so far:** the app shell, both themes, a home screen that opens with what the
library adds up to and two buttons to start it, the playlist view (compact and album
layouts, heat/patina, the finder, column picker, keyboard navigation, transport with a
seekable progress bar), and library-wide search — a persistent field bound to `⌘K`, its
own `#/search` route with a sidebar entry, and per-view scroll and cursor memory so
leaving a result set and coming back returns you to where you were. Search is
accent-insensitive both ways, through `fold()` in `ui/text.js`. The shared list machinery
both views render through is `playlist/TrackBrowser.jsx`, and `indices` is how a filtered
view maps a row back to the playlist index the player addresses.

Tracks can be added to another playlist by dragging them onto it in the sidebar, or from a
context menu on the rows — both selection aware, so a multi-track selection copies in one
`items/copy` request, and both leaving an undo in the toast that follows. Playlists
themselves can be created, renamed, deleted and reordered from the sidebar: a `+` on the
section heading that makes an empty one and drops it straight into rename, an action menu
on secondary-click or press-and-hold, inline renaming in the row, delete behind a
confirmation page, and drag-to-reorder through `/playlists/move/{id}/{index}`. Results can
also be saved as a real playlist — `/playlists/add` returns the new id and the **source**
fills it, so an autoplaylist copies by index and the media library adds by `(path,
subsong)` — gated on `permissions.changePlaylists` and on the library having finished
loading, and skipping the fill entirely when the results are already playing from a
playlist that is exactly them. Reaching past the source for a playlist id here was wrong
and silent: a ref only indexes its own source, so on a 0.11 player twelve saved
Babasónicos matches came back beginning "Jaws Theme Swimming". The play-count shading explains itself once, on first sight, and lives in the
view-options menu after that.

Playing from search results confines playback to them, by materialising them into a
`#Jean [query]` playlist on the player — which is also what carries a search across a
reload and onto another device. Both shuffles exist: the playback-order mode in the status
bar, and the action beside Play that starts a random track and turns it on.

There is an end-to-end suite in `test/e2e`, run against a fake player in `test/fake-api`
whose fixture was captured off a real one. It covers both layouts and both surfaces; see
`test/README.md` for why there are no unit tests and none of it uses jsdom.

Search reads the **media library API** when the player has one (beefweb 0.11+,
foobar2000), and the autoplaylist otherwise; both go through the source seam in
`library/librarySource.js`, and the whole test suite passes against either --
`JEAN_NO_LIBRARY_API=1 pnpm test` runs it against the fallback. Playlist routes are
always read as playlists.

The **home screen** is built: `#/home` (where `/` lands), shelves of albums in
`home/shelves.js`, and `#/all` for the whole library. Clicking an album plays the
*shelf* it is on, starting at that album, and opens it as a view of its own -- a filter
over the library array, never a playlist. The Web Worker and IndexedDB persistence are
not built yet. A library
*browse* view is not built **and is not next**: the library is deliberately a hidden
concept, reachable only through search, until the home screen — which is what the play
history shelves are for — gives it a real home. Both sources are equally unbrowsable,
which is the parity that keeps a 0.11 install from being second-class.
