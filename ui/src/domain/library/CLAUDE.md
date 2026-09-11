# The library

Where "the library" comes from, what plays a set of tracks, and why search results are a view until you play them.

## Browsing and playing are separate

**The scratch playlist holds the last set you chose to play, not the thing you are looking at**, so you can start a shelf and wander elsewhere without touching it. The affordances that account for that, a temporary sidebar row named after the set and a "playing from" line in the status bar, both read the scratch playlist's own title, so they cannot disagree and neither needs state of Jean's own.

**The accent on a sidebar icon means "this is playing" and nothing else.** Never tint it by selection.

**Never mark a row as playing from `isScratchPlaylist && isCurrent`.** `isCurrent` outlives playback and never asks what the scratch is holding. A user's own playlist is the exception and keeps `isCurrent`, which is maintained by the player and means the same thing on every install.

## Two sources, one seam

`domain/track/librarySource.ts` is the seam and the only place that knows which source is in play. **If something outside that file has to ask which source it is, the seam is in the wrong place.**

**A ref is an integer.** The playlist source's is a playlist index; the library source's is a position in its own paths table. That is what keeps the seam from leaking: selection, the search index and the whole virtualised list stay integer-keyed, and only the things that *act* on a row resolve the ref through the source. `Refs` is a typed array or a number array, so reaching for a playlist id to do anything but identify a playlist is a type error.

### Where the library comes from

`foo_jean` answers the whole library, and there is no second way to get it. **No playlist stands in for the library and none ever will.** A playlist's rows come from the playlist and a library view's from the library, never the other way about: Jean shows a playlist under its real name and reads it as one, and it cannot tell that somebody built one to mirror their collection.

- **Never read or write `Default Playlist`.** It is foobar's scratch buffer, and selecting an album in the library view replaces its entire contents.
- **Anything titled `#Jean…` is Jean's, so it is not furniture.** It is filtered out of the sidebar, the command palette and the routing fallback. `domain/track/jeanPlaylists.ts` owns that namespace.

The all-music view is a *view over the library array*, projected through the source seam like a shelf or a set of results. It never pretends to be a playlist.

Shapes and costs for every route are in [../../shared/api/README.md](../../shared/api/README.md).

### Rules that are not obvious

- **`Array.from(refs, …)`, never `refs.map(…)`.** Refs arrive as a typed array from the search index, and mapping a typed array returns a typed array: objects coerce to `NaN` and the request body serialises as an object rather than a list.
- **Search filters client-side, always.** The player's `query` syntax does not agree with `fold()`-based token matching, so filtering client-side and adding server-side by `query` adds tracks that are not the ones on screen. Address adds by explicit path and subsong.
- **Row order is the snapshot's own, and it is library-relative path order**, ties broken by subsong and then by the player's canonical path so that the order is total and does not shuffle between rebuilds. A ref is an ordinal in it, and `positionOf` bisects on a set of refs ascending. A tag sort would be exact-string lexicographic, which splits an album whose artist is spelled two ways: the drift `sameTagValue()` exists to absorb but cannot fix once the order is wrong. A badly-foldered library gets more, smaller album groups; that is a degradation, not a requirement.
- **`%path%` and `%subsong%` are in the update stream's `TRACK_COLUMNS` for identity, not display**: one string per player update, not per row. The player reports an **absolute** path and the library a **relative, forward-slashed** one, and Jean is never told where the library folders are, so they are matched by suffix.

### Filling a playlist from the library

Playing a set means writing it to the scratch playlist and playing a position in it, and both halves have a trap.

- **Sort the playlist once it is filled, because the fill order is the player's rather than Jean's.** A set comes back in the player's own browse order while the view is in library-relative path order, so every position computed from a row addresses a different track. That browse order is not predictable, and reading the filled playlist back is a whole-library read with **no library-change event** to invalidate it against. So overwrite it: one sort into the order the snapshot is already in, and no client state.
- **Adding to a user's playlist does not sort.** That playlist is theirs and its order is theirs. Undo is unaffected either way: it removes the range that was appended, not particular rows.

## Playing a view, and marking it

Filling the scratch, deciding whether the scratch currently *is* a given set, and reading the player's index straight off it are three questions with one answer, and they are **keyed on the same triple**. A view wiring them up itself can pass three different answers to one question and mark the wrong row, so the triple is bound once in `useViewPlayback` and views take that. Playing a set you are not *showing* is the exception and reaches for the fill directly.

## Never mutate playlists as a side effect

**Browsing and playing MUST never create, clear, reorder or overwrite a user's playlist.**

- **Play a track** in place. Nothing is written.
- **Play a *set***: a playlist is the only mechanism the API has. The play queue takes one item per request with no bulk form, and the player has no other way to say "these tracks, in this order".
- **Never sort a playlist to browse.** It mutates. It is for building derived playlists on explicit request only.

This is about side effects, not capability. **Explicit user intent is different**: asked to add an album, reorder a playlist or delete tracks, do exactly that. What Jean legitimately changes is playback state, the play queue, and `/api/clientconfig/{id}`. Note that even playing a track has downstream effects on the user's data. It scrobbles, increments play counts, and on some setups rewrites the file's mtime.

## Showing playlists

**Show playlists under their real names. Never relabel or reinterpret them.** The `#Jean…` namespace is the one exception, and those are Jean's own. **Never infer a role from a name the user chose.** `Default Playlist` is a volatile scratch buffer on one install and someone's primary working playlist on the next.

### Playlist kinds: real, but undetectable

A regular playlist is editable and only the user changes it. A smart playlist or autoplaylist accepts edits and does nothing with them, and the library drives its contents. `Default Playlist` is editable and foobar's own UI clobbers it.

**The API cannot express any of that. There is no autoplaylist flag. Do not go looking for one again.** Every detection route is worse than not detecting: probing with a mutation is destructive, `itemCount` drift cannot separate a smart playlist from `Default Playlist` churn, and name heuristics only catch foobar's own `#Quicksearch` prefix. `foo_jean` is the only thing that can answer it, and Jean uses that answer only to *remove* affordances, so on an unpaired device every playlist looks exactly as it did before.

So handle the split by design:

- **Volatility mostly does not matter.** Only the library gets the expensive indexed treatment; every other playlist is small enough to read on demand.
- **Editability is graceful failure.** `permissions.changePlaylists` can already deny an edit, so that path must exist anyway. Attempt, catch, explain, then record the refusal so the affordance disappears for that playlist.
- **Hierarchy belongs to the user.** Pinning, grouping and ordering playlists in Jean's sidebar is the third tier of the source-of-truth ladder, and legitimate precisely because foobar exposes no such concept.

## Search results are a view until you play them

Searching is a client-side filter over the in-memory index: **no request, no playlist created, nothing written to the player.** Do not render it as a playlist in the sidebar, because that invites the expectation that it persists.

**Playing is the exception, and it has to be.** beefweb plays from playlists and knows nothing else, so playing a result in place leaves the player carrying on from *there*: the next track is the library's next track, and with shuffle on a random one out of everything. So the results materialise into a real playlist at the moment someone asks to hear them, and playback happens inside it.

- **One playlist, reused, not one per search.** Its title carries the kind and the label of whatever it holds, so the thing is self-describing wherever it surfaces, including foobar's own sidebar. Reusing it avoids id churn and means never deleting something currently playing.
- **Resolved by a stored id that is *checked against the title before it is trusted*, falling back to the first playlist whose title fits.** A bare id is not enough: the playlist behind it may have been renamed, adopted or deleted at the player, and refilling somebody's playlist because Jean still had its id is the mistake that costs their data. This is not the same ladder the library playlist climbs, which is a name match and has no pin at all.
- **Hidden from Jean, visible in foobar.** There is no hidden-playlist concept and beefweb cannot fake one, so it is filtered out of the sidebar, the palette, the library and the routing fallback, the last because playing a set makes it the *current* playlist, and landing there on next open would show those results stripped of the search that made them. **Reordering still has to count the hidden row**: the player orders the real list, so a drop position among visible rows has to be translated through whichever playlist occupies it.
- **Lazy.** Nothing is written while typing or refining, and a second play of the same set reuses what is there.
- **The playlist is how a search survives a reload and reaches another device.** The query is in the title and every client can see the player's playlists, so reading it costs nothing and does not touch the library.
- **Saving results renames the scratch rather than copying it.** When the scratch already holds exactly these results it *is* what is being saved, so nothing is copied, no near-duplicate is left beside the original, and playback carries straight on through the rename. **The stored pin MUST be cleared afterwards**: the id now points at the *user's* playlist, and resolving the scratch by it would hand their playlist to the next search, which empties what it finds before refilling it.
- **Dismissing the search deletes it, unless the player is on it.** Deleting the playing playlist does not end playback at the end of the track. The player falls back to another playlist and carries on, which is the wandering this arrangement exists to stop. **The check is the active item's `playlistId`, not `isCurrent`**, which stays pointing at the last playlist played from long after playback stopped and would keep the scratch alive forever.
- **No `changePlaylists` means no scratch playlist**, and a library row then has nowhere to be played from at all. A playlist route is unaffected: its rows are already in a playlist.

Emptying a playing playlist leaves the track playing but detached, which is harmless only because a play always follows immediately.

## Genres

**A genre view is a filter over rows Jean already holds**: no request, no playlist, nothing the player knows about. Matching is **whole and through `tagKey`**, exactly the way the counts are computed, so a figure and the view it opens are always the same set. **An empty key returns nothing rather than everything**, since an empty tag matches every untagged row, which on an install with no genre tags is the whole library. The route carries a tag somebody typed, so it is percent-encoded and decoded inside a `try`, since a hand-edited hash with a stray `%` throws.

**Jean composes exactly one player query, in `genreQuery.ts`.** `foo_jean` passes queries through untouched and says so, because the player owns that language, so **quoting is Jean's responsibility**, and a tag pasted in unquoted can produce a query that parses and means something else. The component's preview route is the only check.
