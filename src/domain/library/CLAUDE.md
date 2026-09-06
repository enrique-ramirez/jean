# The library

Where "the library" comes from, how a set is played, and why search results are a view until you play them.

## Browsing and playing are separate

**The scratch playlist holds the last set you chose to play, not the thing you are looking at**, so you can start a shelf and wander into All music without touching it. That freedom is only tolerable with the affordances that account for it: a temporary sidebar row named after the set, and `from <label>` in the status bar. Both read the scratch playlist's own title through `usePlayingFrom.ts`, so they cannot disagree and neither needs state of Jean's own.

**The accent on a sidebar icon means "this is playing" and nothing else.** Tinting it by selection makes the row you are looking at and the row you are listening to identical, which is the pair this design exists to separate.

**Every set that plays says so on the row it already has; a shelf and a genre get one made for them.** All music and a live search have permanent sidebar entries and are marked in place. A genre's route is recoverable from the scratch playlist's label alone, because the label *is* the tag; a shelf's has to be matched back against `SHELVES` by title. `usePlayingFrom` reads the scratch title and `App` works the route out once. **Never mark a row from `isScratchPlaylist && isCurrent`** — `isCurrent` outlives playback and never asks what the scratch is holding. A user's own playlist is the exception and keeps `isCurrent`.

## Two sources, one seam

`domain/track/librarySource.ts` is the seam and the only place that knows which source is in play: `{ kind, playlistId, needsHeldCount, artworkUrl, identify, fill, addTo, queueTargets, playingPosition }`. **If something outside that file has to ask which source it is, the seam is in the wrong place.**

**A ref is an integer.** The playlist source's is a playlist index; the library source's is a position in its own `paths` array. That is what keeps the seam from leaking: `indices`, `useTrackSelection`, the search index and the whole virtualised list stay integer-keyed. Only the things that *act* on a row resolve the ref, and they do it through the source. `Refs` is `Int32Array | number[]` in `domain/track/project.ts`, so reaching for `playlistId` to do anything but identify a playlist is a type error.

### Without a library API

beefweb 0.10 sees playlists and the filesystem, and that is the whole surface. The way through is an **autoplaylist** created once inside foobar with the query `ALL`, which appears in `/api/playlists` like any other and stays in sync. Jean's first run guides the user through creating it, and that path must keep working: beefweb alone remains the minimum.

- **Never read or write `Default Playlist`.** It is foobar's scratch buffer — selecting an album in the library view replaces its entire contents, and it went from 30,441 items to 12 in an hour of ordinary use.
- **The name is the contract: `#Jean Library`, matched exactly.** Playlist ids are neither contiguous nor guaranteed stable beyond the run, so the title is the identity and there is no id to pin. A name nobody types by accident removes the guess rather than guarding it; a looser match would adopt somebody's small unrelated playlist as their whole collection and report its size as theirs.
- **It is Jean's, so it is not furniture.** Anything titled `#Jean…` is filtered out of the sidebar, the command palette and the routing fallback — `domain/track/jeanPlaylists.ts` owns that namespace for both this and the search scratch.

Fallback for users who will not create an autoplaylist: build a playlist from `/api/browser/roots` via `POST /playlists/add` + `items/add`. That mirrors the *disk* rather than the library and needs manual refresh, so it is a second choice.

### With the library API (beefweb 0.11+)

| | |
|---|---|
| `GET /library/info` | `{supported, enabled, itemCount}` — ~8 ms, and the only one that answers without the API |
| `GET /library/items` | `{offset, totalCount, items:[{path, subsong, columns}]}`; `columns` required, `range` optional |
| `GET /library/items/by-path` | one tree level; folders with a recursive `itemCount`, then tracks |
| `GET /artwork/library?path=&subsong=` | artwork with no playlist involved |
| `POST /playlists/{id}/items/add-from-library` | `{items \| query, index, replace, play}`, needs `changePlaylists` |

Full shapes and costs in `API.md`.

**`#/search` and `#/all` use the library API. A playlist route never does.** `#/p7` issues playlist item reads and `artwork/{plid}/{index}`; `#/search` issues `library/items` and `artwork/library`. **Playlists are playlists** — Jean shows one under its real name and reads it as one. It cannot tell that a user made it to stand in for the library, and reading it through the library API would lie about which object is on screen; the two are not even the same set once the autoplaylist's query drifts from `ALL`.

Consequence: **the autoplaylist is not the browse view.** On a 0.11 player it is not read at all — only resolved when there is no library API, or when `changePlaylists` is false and playing in place is the only way to play anything — and on every player it is hidden from the sidebar. `#/all` is a *view over the library array*, projected through the source seam like a shelf or a set of results, so both sources produce it identically and neither pretends to be a playlist.

**Jean composes exactly one player query**, in `genreQuery.ts`: `%genre% IS "x"`, for the autoplaylist
a genre view offers to make. `foo_jean` passes queries through untouched and says so — the player owns
that language — so **quoting is Jean's responsibility**, and a tag pasted in unquoted can produce a
query that parses and means something else. `POST /autoplaylists/preview` is the check.

**A genre view is a filter over rows Jean already holds** — no request, no playlist, nothing the player knows about. `refsOfGenre` in `domain/track/project.ts` matches the tag **whole and through `tagKey`**, which is how `summarise` counts genres, so "Indie Rock, 2,667" opens 2,667 rows. An empty key returns nothing rather than everything: `tagKey('')` matches every untagged row, which on an install with no genre tags is the whole library. The route carries a tag somebody typed, so `genreRoute` percent-encodes and `resolveRoute` decodes inside a `try` — a hand-edited hash with a stray `%` throws.

### Rules that are not obvious

- **The source is chosen by what can actually play**, not only by what exists: `useApi = hasLibraryApi && (canWrite || !playlist)`. Playing a set of results always needs a playlist to play it *in*, so on a player refusing playlist writes the API can browse but never play, while an autoplaylist can still be played in place.
- **`Array.from(refs, …)`, never `refs.map(…)`.** Refs arrive as an `Int32Array` from the search index, and mapping a typed array returns a typed array: objects coerce to `NaN` and the request body serialises as `{"0":0,…}` rather than a list.
- **Search filters client-side, always.** `query` is the player's own syntax and does not agree with `fold()`-based token matching, so filtering client-side and adding server-side by `query` adds tracks that are not the ones on screen. Address adds by explicit `items: [{path, subsong}]`.
- **Chunking inverts on the library endpoint.** One small chunk to paint, then a **single** request for the rest — never wide. Numbers under "Loading it" in `src/domain/track/CLAUDE.md`.
- **The library is read with an explicit `sort=%path%`.** It is the endpoint's own default, and stating it makes the expression a filled playlist is sorted by demonstrably the same one the rows are in. Change one and you change the other.
- **Row order is the API's default (file path)**, deliberately. Path order gives 2,382 contiguous album runs over 30,441 tracks against 2,386 for a tag sort, for 2,366 albums — a tag sort is fractionally *worse*, because server-side sort is exact-string lexicographic and splits `5 Seconds Of Summer` from `5 Seconds of Summer`, the drift `sameTagValue()` exists to absorb but cannot fix once the order is wrong. A badly-foldered library gets more, smaller album groups; that is a degradation, not a requirement.
- **`%path%` and `%subsong%` are in `TRACK_COLUMNS` for identity, not display** — one string per player update, not per row. The player reports an **absolute** path and the library a **relative, forward-slashed** one, and Jean is never told where the library folders are, so they are matched by suffix: `libraryPathMatcher()`.

### Filling a playlist from the library

Playing a set means writing it to the scratch playlist and playing a position in it, and both halves have a trap.

- **Do not name the whole library.** 30,441 tracks as explicit `{path, subsong}` is a 2.9 MB body and **beefweb hangs up over 1 MiB**, which arrives as a network error rather than a status — so `fill` throws and the play waiting on it never happens. **Omitting `items` and `query` means the whole library**, in one request with no body, in ~299 ms. Anything smaller is named, in chunks well under the cap; the player resolves paths at ~1.2 ms each, so going wide buys nothing.
- **Then sort the playlist by `LIBRARY_SORT`, because the fill order is the player's, not Jean's.** A set comes back in the media library's browse order while the view is in path order, so every position computed from a row addresses a different track. The browse order is not predictable — no `sort` expression reproduces it — and not worth learning, since reading the filled playlist back is 3.2 MB at 30k (~21 MB at 200k) with **no library-change event** to invalidate it against. So overwrite it: one `items/sort` by the same expression the library was read with, ~340 ms, no client state.
- **`addTo` does not sort.** That playlist is the user's and its order is theirs. Undo is unaffected either way — it removes the range that was appended, not particular rows.

## Playing a view, and marking it

`usePlaySet` fills the scratch and plays a position in it; `useScratchPlaylist.holdsView` decides whether the scratch currently *is* a given set; `useActivePosition` needs that answer to read the player's index straight off it rather than sweeping every ref. **All three are keyed on the same `(kind, label, count)`**, so a view wiring them up itself can pass three different answers to one question and mark the wrong row. `useViewPlayback` is that triple bound once, and `LibraryListView` and `SearchResults` both take it. `useHomePlayback` uses `usePlaySet` directly, because it plays sets it is not showing.

## Never mutate playlists as a side effect

**Browsing and playing must never create, clear, reorder or overwrite a user's playlist.**

- **Play a track** — `POST /player/play/{playlistId}/{index}` plays it in place. Nothing is written.
- **Play a *set*** — a playlist is the only mechanism the API has. `/playqueue/add` takes one item per request with no bulk form, so any real set is hundreds of calls, and the player has no other way to say "these tracks, in this order".
- **Never `POST items/sort` to browse.** It mutates. It is for building derived playlists on explicit request only.

This is about side effects, not capability. **Explicit user intent is different**: asked to add an album, reorder a playlist or delete tracks, do exactly that. What Jean legitimately changes is playback state, the play queue, and `/api/clientconfig/{id}`. Note that playing a track has downstream effects on the user's data — it scrobbles, increments play counts, and on some setups rewrites the file's mtime.

## Showing playlists

**Show playlists under their real names. Never relabel or reinterpret them.** The `#Jean…` namespace is the one exception, and not an exception to the reason: those are Jean's own, created by it or handed to it by name. **Never infer a role from a name the user chose** — `Default Playlist` is a volatile scratch buffer on one install and someone's primary working playlist on the next.

Use **`isCurrent`** to mark the playlist the player is playing from. It is maintained by the player and means the same thing on every install.

### Playlist kinds — real, but undetectable

| Kind | Editable? | Stable? |
|---|---|---|
| Regular playlist | yes | yes — only the user changes it |
| Smart / autoplaylist | accepts edits and does nothing | no — the library drives it |
| `Default Playlist` | yes | **no** — foobar's own UI clobbers it |

**The API cannot express it.** `PlaylistInfo` has exactly six fields and `GET /playlists/{id}` returns the same six. **There is no autoplaylist flag. Do not go looking for one again.** Every detection route is worse than not detecting: probing with a mutation is destructive, `itemCount` drift cannot separate a smart playlist from `Default Playlist` churn, and name heuristics only catch foobar's `#Quicksearch` prefix.

So handle the split by design:

- **Volatility mostly does not matter.** Only the library gets the expensive indexed treatment; every other playlist is small enough to read on demand.
- **Editability is graceful failure.** `permissions.changePlaylists` can already deny an edit, so that path must exist anyway. Attempt, catch, explain, then record the refusal so the affordance disappears for that playlist.
- **Hierarchy belongs to the user.** Pinning, grouping and ordering playlists in Jean's sidebar is tier three of the source-of-truth ladder, and legitimate precisely because foobar exposes no such concept.

## Search results are a view until you play them

Searching is a client-side filter over the in-memory index: **no request, no playlist created, nothing written to the player.** Do not render it as a playlist in the sidebar — that invites the expectation that it persists.

**Playing is the exception, and it has to be.** beefweb plays from playlists and knows nothing else, so playing a result in place leaves the player carrying on from *there*: the next track is the library's next track, and with shuffle on a random one out of everything. So the results materialise into a real playlist at the moment someone asks to hear them, and playback happens inside it. Every playback order then means what it says.

- **One playlist, reused, not one per search.** `#Jean [query]` — the title carries the query so the thing is self-describing wherever it surfaces, including foobar's own sidebar. Reusing it avoids id churn and means never deleting something currently playing.
- **Resolved by stored id, falling back to the title**, the same ladder the library playlist climbs.
- **Hidden from Jean, visible in foobar.** There is no hidden-playlist concept and beefweb cannot fake one, so it is filtered out of the sidebar, the palette, the library and the routing fallback — the last because playing a set makes it the *current* playlist, and landing there on next open would show those results stripped of the search that made them. **Reordering still has to count the hidden row**: the player orders the real list, so a drop position among visible rows is translated through whichever playlist occupies it.
- **Lazy.** Nothing is written while typing or refining, and a second play of the same set reuses what is there.
- **The playlist is how a search survives a reload and reaches another device.** The query is in the title and every client can see the player's playlists, so reading it costs nothing and does not touch the library. Jean needs no state of its own for this.
- **Saving results renames the scratch rather than copying it.** When the scratch already holds exactly these results it *is* what is being saved, so it is renamed and stops being Jean's — nothing is copied, no near-duplicate is left beside the original, and playback carries straight on through the rename. **The stored id MUST be re-checked against the title afterwards and the pin cleared**: the id now points at the *user's* playlist, and resolving the scratch by it would hand their playlist to the next search, which empties what it finds before refilling it. Two guards for one mistake, because the cost is their data. Falls back to create-and-copy when the scratch holds something else.
- **Dismissing the search deletes it, unless the player is on it.** Deleting the playing playlist does not end playback at the end of the track — the player falls back to another playlist and carries on, which is the wandering this arrangement exists to stop. **The check is the active item's `playlistId`, not `isCurrent`**, which stays pointing at the last playlist played from long after playback stopped and would keep the scratch alive forever.
- **`permissions.changePlaylists: false` means no scratch playlist**, so results fall back to playing in place and the Shuffle button goes.

Materialising is cheap even at library size: 500 indices copy in 17 ms, 5,000 in 33 ms, 20,000 in 166 ms. Emptying a playing playlist leaves the track playing but detached (`activeItem.index` goes to -1), which is harmless only because a play always follows immediately.

## Still open

- **No folder tree.** `#/all` browses the library as one flat list; `/library/items/by-path` is documented in `API.md` for when that changes.
- **Reconciling a stale `itemCount` is partly built.** `usePlaylists` and `useLibraryInfo` refetch on window focus. The live `playlistItems` tripwire is not wired; arithmetic that cannot survive being wrong re-reads the count itself.
