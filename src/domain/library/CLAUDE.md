# The library

Where "the library" comes from, how a set is played, and why search results are a
view until you play them. General rules are in the root `CLAUDE.md`.

**Every set that plays says so on the row it already has; a shelf and a genre get
one made for them.** All music and a live search have permanent sidebar entries, so
they are marked in place; a shelf and a genre have none, so each borrows a temporary
row for as long as it is the thing playing. A genre differs from a shelf in one
way worth knowing: **its route is recoverable from the scratch playlist's label
alone**, because the label *is* the tag, where a shelf's has to be matched back
against `SHELVES` by title. One answer feeds all of them -- `usePlayingFrom` reads the
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
`domain/library/usePlayingFrom.ts`, so they cannot disagree and neither needs state of Jean's
own. **The accent on a sidebar icon means "this is playing" and nothing else** --
tinting it by selection made the row you were looking at and the row you were listening
to identical, which is precisely the pair this design exists to separate.

## Without a library API

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
  sidebar, the command palette and the routing fallback — see `domain/track/jeanPlaylists.ts`,
  which owns the namespace for both this and the search scratch.

Fallback for users who won't create an autoplaylist: Jean can build its own playlist from
`/api/browser/roots` via `POST /playlists/add` + `items/add`. That mirrors the *disk* rather
than the library and needs manual refresh, so it is a second choice, not the default.

## The library API — wired, behind a source seam

**The development player runs a pre-release beefweb**: `0.11~git.dc0fdfc`, CI's merge
of [PR #382](https://github.com/hyperblast/beefweb/pull/382) into master, installed
from the GitHub Actions artifact. Jean uses it when it is there and falls back when it
is not. Released beefweb is 0.10 and has none of it; DeaDBeeF never will.

### The endpoints

| | |
|---|---|
| `GET /library/info` | `{supported, enabled, itemCount}` -- 8 ms, and the only one that answers without the API |
| `GET /library/items` | `{offset, totalCount, items:[{path, subsong, columns}]}`; `columns` required, `range` optional |
| `GET /library/items/by-path` | one tree level; folders with a recursive `itemCount`, then tracks |
| `GET /artwork/library?path=&subsong=` | artwork with no playlist involved |
| `POST /playlists/{id}/items/add-from-library` | `{items \| query, index, replace, play}`, needs `changePlaylists` |

Full shapes and measurements in `API.md`.

### `domain/track/librarySource.ts` is the seam, and the only place that knows

Two sources, one interface: `{ kind, playlistId, needsHeldCount, artworkUrl(ref),
fill(targetId, refs, heldCount), addTo(targetId, refs), playingPosition(refs, track,
activeItem) }`.

**A genre view is a filter over rows Jean already holds -- no request, no
playlist, and nothing the player knows about.** `refsOfGenre` in
`domain/track/project.ts` is the whole of it, and it matches the tag **whole and
through `tagKey`**, which is how `summarise` counts genres: the bar on the front
door says "Indie Rock, 2,667" and this is what opening it shows, so the two have to
agree about what a genre is or the count is a lie. An empty key returns nothing
rather than everything -- `tagKey('')` matches every untagged row, which on an
install with no genre tags is the whole library.

The route carries a tag somebody typed, so it can hold a slash, a hash or an
accent: `genreRoute` percent-encodes and `resolveRoute` decodes inside a `try`,
because a hand-edited hash with a stray `%` throws rather than returning something
odd.

**A ref is an integer.** The playlist source's is a playlist index; the library
source's is a position in its own `paths` array. That is what keeps the seam from
leaking: `indices`, `useTrackSelection`, the search index and the whole virtualised
list stay integer-keyed and never learn which source they are looking at. Only the
things that *act* on a row resolve the ref, and they do it through the source.

**If something outside that file has to ask which source it is, the seam is in the
wrong place.**

### Which view uses which, and why

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

### Rules that are not obvious

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
  request for the rest -- never wide. See "Loading it" in
  `src/domain/track/CLAUDE.md` for the numbers.
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

### Filling a playlist from the library

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

### Still open

- No folder tree. `#/all` browses the library as one flat list; walking it by folder
  is a separate feature and `/library/items/by-path` is measured for it.
- Reconciling a stale `itemCount` is **partly** built: `usePlaylists` and `useLibraryInfo`
  refetch on window focus, so a count edited on the desktop is corrected on the way back
  and the views keyed on it re-key. The live `playlistItems` tripwire in `API.md` is still
  not wired; the arithmetic that cannot survive being wrong re-reads the count itself.
- `Mosaic` is **on hold at the owner's request** -- changes coming there, do not test or
  rework it yet. Artwork loading was on hold with it and no longer is; see the artwork
  queue under *Rendering* in `src/domain/track/CLAUDE.md`.

## Playing a view, and marking it

`usePlaySet` fills the scratch and plays a position in it; `useScratchPlaylist.holdsView`
decides whether the scratch currently *is* a given set; `useActivePosition` needs that
answer to read the player's index straight off it rather than sweeping every ref. All
three are keyed on the same `(kind, label, count)`, so a view wiring them up itself can
pass three different answers to one question and mark the wrong row.

`useViewPlayback` is that triple, bound once. `LibraryListView` and `SearchResults` both
take it. `useHomePlayback` still uses `usePlaySet` directly, because it plays sets it is
not showing -- the kind and label arrive per call there rather than per hook.

## Never mutate playlists as a side effect

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

## Showing playlists

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

## Playlist kinds — real, but undetectable

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

## Search results are a view until you play them

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
