# API reference

Two HTTP APIs sit under Jean. **beefweb** does playback, playlists and the queue, and answers artwork for a row that is in a playlist. **`foo_jean`** listens on a port of its own and answers everything else: the library and its covers, writing tags, creating autoplaylists, and streaming the player's output.

Verified against foobar2000 with the beefweb plugin. Where behaviour differs by plugin version it says so: **0.10** is the current release, **0.11** adds the media library API. DeaDBeeF differences are called out per endpoint.

---

# beefweb

## Reaching it

| | |
|---|---|
| Base URL | `http://<player-host>:8880` |
| API prefix | `/api` |
| Auth | HTTP Basic, when `authRequired` is on. Off by default |
| From Jean | root-relative `/api/…`, proxied by Vite in development |
| Remote access | `allowRemote` must be on for anything but localhost |
| CORS | **off by default.** No `Access-Control-Allow-Origin` comes back, so a page on another origin cannot call the API. Jean is served same-origin or through the dev proxy |
| Compression | gzip when the client asks for it |
| SPA fallback | none. `/playlists/p2` is a 404, which is why Jean routes on the hash |

## Reading state

### `GET /api/query`

One composite read. Any combination in one request.

| Parameter | Effect |
|---|---|
| `player=true` | player state, including `activeItem` |
| `playlists=true` | the playlist list |
| `playQueue=true` | the whole play queue |
| `outputs=true` | active output, types and devices |
| `playlistItems=true` | items, with `plref` and `plrange` |
| `trcolumns=` | columns for the active track |
| `qcolumns=` | columns for play queue items |
| `plcolumns=` | columns for playlist items |
| `plref=` | which playlist `playlistItems` reads. Singular |
| `plrange=` | `offset:count` |

### `GET /api/query/updates`

The same parameters as Server-Sent Events. Each message is a full `data:` payload of whatever was subscribed to.

**It is change-driven, not a ticker.** Messages arrive on track change, play/pause, volume and playlist switch, never on a timer, and `position` alone never triggers one. A long silence during uninterrupted playback is normal, so a progress display must interpolate locally (`src/domain/player/position.ts`) and a gap is not a stall.

**`playlists` fires when the *set* of playlists changes, never when their contents do.**

| What happened | What arrived |
|---|---|
| playlist added, renamed or deleted | `playlists` |
| items copied in | **`player` only** |
| items removed | **`player` only** |

> **`itemCount` in `PlaylistInfo` is stale from the first write onwards and nothing corrects it.** Anything that does arithmetic with it, whether that is how many rows to remove, whether a cached view still matches, or a sidebar count, MUST re-read it. Trusting it removes the wrong rows and plays whatever drifted into the row that was clicked.

**A one-item `playlistItems` window is a cheap tripwire.** Subscribing with `playlistItems=true&plref=…&plrange=0:1` pushes on *any* item change in that playlist, including appends past the window, since `totalCount` is part of the diff. `plref` is singular, so watching a different playlist means reconnecting. Items have no id and any change invalidates every index held, so treat a push as a signal to reconcile rather than a reason to refetch.

## Endpoints

`docs/player-api.yml` in the beefweb repository is the authority on the route list, the bodies and the schemas.

### Player

| Route | Body | Notes |
|---|---|---|
| `GET /player` | — | **ignores `trcolumns`** and answers `"columns": []`. Use `/query?player=true&trcolumns=…` |
| `POST /player` | `{ position }` / `{ relativePosition }` | seek, in seconds |
| `POST /player` | `{ volume }` / `{ relativeVolume }` / `{ isMuted }` | volume is **decibels**; read `volume.min`/`max` |
| `POST /player` | `{ options: [{ id, value }] }` | the supported way to set playback order |
| `POST /player` | `{ playbackMode }` | deprecated, and the only form DeaDBeeF accepts |
| `POST /player/play` · `/play/{playlistId}/{index}` · `/play/random` | — | |
| `POST /player/next` · `/previous` | `{ by }` optional | `by` takes an expression, so "next album" is possible |
| `POST /player/stop` · `/pause` · `/pause/toggle` · `/play-pause` | — | |
| `POST /player/volume/up` · `/down` | — | one player-defined step |

### Playlists

| Route | Body | Notes |
|---|---|---|
| `GET /playlists` | — | six fields per playlist, and no more |
| `POST /playlists/add?title=` | — | title is a query parameter |
| `POST /playlists/{id}` | `{ title }` | this is rename; there is no `rename` route |
| `POST /playlists/remove/{id}` | — | **see the crash warning below** |
| `POST /playlists/move/{id}/{index}` | — | a **negative index means last**, so appending needs no count |
| `GET /playlists/{id}/items/{offset}:{count}?columns=` | — | |
| `POST /playlists/{id}/clear` | — | |
| `POST /playlists/{id}/items/add` | `{ items: [paths], index, replace, play, async }` | file or directory paths on the player's disk |
| `POST /playlists/{id}/items/remove` | `{ items: [indices] }` | |
| `POST /playlists/{id}/items/move` | `{ items, targetIndex }` | reorder within one playlist |
| `POST /playlists/{src}/{dst}/items/copy` · `move` | `{ items, targetIndex }` | |
| `POST /playlists/{id}/items/sort` | `{ by, desc, random }` | `by` is a title-format expression, so it inherits the comma limitation. Whole-playlist and destructive |

### Play queue

| Route | Body | Notes |
|---|---|---|
| `GET /playqueue?columns=` | — | the parameter is **`columns`** here and **`qcolumns`** only on `/query` |
| `POST /playqueue/add` | `{ plref, itemIndex }` | one item per request |
| `POST /playqueue/remove` | `{ queueIndex }` or `{ plref, itemIndex }` | |
| `POST /playqueue/clear` | — | |

### The rest

| Route | Answers |
|---|---|
| `GET /outputs` · `POST /outputs/active` | active output plus available types and devices, each with an opaque `id`. `supportsMultipleOutputTypes: false` on foobar2000 |
| `GET /browser/roots` | `{ pathSeparator, roots: [{ path, … }] }`. `\` on Windows, `/` elsewhere |
| `GET /browser/entries?path=` | `{ entries: [{ name, path, size, timestamp, type: "D"\|"F" }] }` |
| `GET /artwork/current` · `/artwork/{playlistId}/{index}` | image bytes, or 404 when there is none |
| `GET\|POST /clientconfig/{id}` · `POST /clientconfig/remove/{id}` | arbitrary server-side JSON blob storage |

## Shapes

### `player`

```jsonc
{
  "activeItem": {
    "columns": ["Artist", "Title"],  // the requested columns, positionally
    "duration": 225.61,              // seconds, float
    "index": 73,                     // index within the playlist, -1 when stopped
    "playlistId": "p2",
    "playlistIndex": 1,
    "position": 7.37                 // seconds, at the moment this message was produced
  },
  "info": { "name": "foobar2000", "title": "foobar2000", "version": "…", "pluginVersion": "0.10" },
  "options": [
    { "id": "playbackOrder", "name": "Playback order", "type": "enum", "value": 4, "enumNames": ["…"] },
    { "id": "stopAfterCurrentTrack", "type": "bool", "value": false }
  ],
  "permissions": { "changePlaylists": true, "changeOutput": true, "changeClientConfig": true },
  "playbackMode": 4,
  "playbackModes": ["Default", "Repeat (playlist)", "Repeat (track)", "Random",
                    "Shuffle (tracks)", "Shuffle (albums)", "Shuffle (folders)"],
  "playbackState": "playing",        // "playing" | "paused" | "stopped"
  "volume": { "type": "db", "min": -100.0, "max": 0.0, "value": -4.0, "isMuted": false }
}
```

- **`info.name` is what distinguishes foobar2000 from DeaDBeeF** and is the field to branch on. `info.title` is a display name.
- **Volume is decibels, not a percentage,** and `volume.type` says so. The range is the player's, `-100..0` on foobar2000 and `-50..0` on DeaDBeeF, so read `min` and `max`. A linear slider over that range feels wrong; map it.
- **Nothing may address a playback mode by index.** The two `playbackModes` lists differ in wording *and* order between the players.

### `playlists`

```jsonc
{ "playlists": [
  { "id": "p1", "index": 0, "isCurrent": false, "itemCount": 30441,
    "title": "Default Playlist", "totalTime": 0.0 }
]}
```

- Ids are `p1`, `p2`, … stable while the player runs, **not contiguous** and **not in index order**.
- `totalTime` reads `0.0`. Do not rely on it.
- **These six fields are the whole schema.** `GET /playlists/{id}` returns the same six. **There is no flag distinguishing an autoplaylist from an ordinary playlist.** `foo_jean`'s `GET /playlists` is the only way to ask.

> **Autoplaylists do not reject edits. They accept them and do nothing.** A copy into an autoplaylist answers **204** and leaves `itemCount` unmoved, exactly as a successful copy into an ordinary playlist answers 204. There is no error to catch: the only way to know a copy landed is to re-read `itemCount` and check it moved by the number sent.

### `playlistItems`

```jsonc
{ "playlistItems": {
  "offset": 0,
  "totalCount": 375,
  "items": [ { "columns": ["Artist", "Title", "3:57"] } ]
}}
```

Items carry **no id**, only their position. Index is identity, so any mutation invalidates every index being held.

### `playQueue`

```jsonc
{ "playQueue": [ { "playlistId": "p2", "playlistIndex": 1, "itemIndex": 73, "columns": ["…"] } ] }
```

The queue is finite, ordered and exhaustive: the player takes all of it, in order, before returning to the playlist. It also outranks playback order: with tracks queued, `POST /player/next` plays the head of the queue.

- **An entry holds a track handle, not a position.** Removing a playlist row *above* a queued one renumbers the `itemIndex` that comes back, so the queue survives edits underneath it and a client reconciles nothing.
- **A queued track leaves the queue the moment it starts**, so the queue is only ever what is still to come.
- **The update stream carries the whole queue on every change**, with no `player` object riding along.

> **Removing the queued track itself leaves the entry behind reporting `itemIndex: -1`, and its `columns` are garbage rather than empty.** They hold whatever is in the freed slot. **Test `itemIndex < 0`; never infer an orphan from its columns.**

### `clientconfig`

Arbitrary JSON blob storage, keyed by id.

- **`GET` answers `200` with a body of `null` for an id nobody has written**, not a 404.
- Ids are lowercase alphanumeric plus `_`. `foo-jean` is a **400**.
- **Nothing on this route is authenticated and `changeClientConfig` defaults to on.** Anyone who can reach beefweb can read or overwrite any id. Never store a credential here.

### Artwork

Addressed by **playlist index**, so these answer for the playing surfaces and for a playlist Jean is showing, and for nothing else. A library row's cover comes from the component instead.

> **Every response carries a short `max-age` with `must-revalidate`**, from one filter that does not tell a sleeve from a status poll, so a browser refetches a cover it drew a moment ago. beefweb answers a conditional request correctly, so the header is the whole of the problem and it is the player's to change.

## Columns and title formatting

`columns` / `trcolumns` / `qcolumns` / `plcolumns` take **foobar2000 title-formatting expressions**, evaluated by the player and returned as a positional array in the order requested. This is the richest part of the API: the player computes, so the reachable surface is far wider than beefweb's own schema.

> **The column list is split on commas *before* the expressions are evaluated, so any title-format function taking more than one argument is unusable.** `$if(%album artist%,yes,no)` arrives as three separate columns. Quoting does not help, because foobar's `''` escaping happens too late. Repeating the parameter (`&trcolumns=a&trcolumns=b`) honours only the first.
>
> Single fields, concatenation and single-argument functions only. Anything conditional is computed client-side.
>
> **Single-argument functions do nest**: `$len($meta(unsynced lyrics))` works. The limit is on *arguments*, not composition, which is useful for asking about a large field without downloading it.

> **Answers come back positionally, so the expression list and the name-to-index map must come off one declaration.** `fieldTable()` in `src/shared/api/fieldTable.ts` derives both. Written out separately, the day somebody inserts an expression in the middle is the day a row reports its genre as its artist.

### Capability detection

**A field that does not exist answers `?`. A field that exists but is empty answers `''`, `0` or `N/A`.** That difference is the whole of the capability probe: ask for a column set against sample tracks on connect, and enable whatever resolves.

- **`$meta(x)` cannot be feature-detected.** It answers `''` for a field that does not exist, where `%x%` answers `?`. Probe with `%x%`.
- **DeaDBeeF has no such sentinel.** There an unknown field answers `''`, exactly as an empty one does, so **every optional field reads as supported** and its column arrives empty rather than staying hidden. Detection is the thing that cannot work there, and it errs on the side of showing too much.
- **Sparse fields defeat sampling.** A field only some tracks carry can be missed entirely by a fixed sample. Detect per track where a field is sparse, as the Details panel does.
- **Which fields resolve is a fact about the install, not about a set of rows.** A playlist of untagged rips answers `?` for `%year%` while the library resolves it, so sample the library and let every view read that one answer. `src/domain/track/fieldAvailability.ts`.

### Expressions Jean uses

| Expression | Supplied by | Notes |
|---|---|---|
| `%artist%` `%title%` `%album%` `%album artist%` | core | |
| `%tracknumber%` `%discnumber%` `%totaltracks%` `%totaldiscs%` | core | |
| `%year%` | core | clean and integer-shaped. Sort and group by this |
| `%date%` | tags | an ordinary messy user tag, **not a date-added field**: year-only, full ISO and untidy values all appear. Parse leniently |
| `%genre%` `%publisher%` `%composer%` | tags | |
| `%length_seconds%` `%codec%` `%codec_profile%` `%bitrate%` `%samplerate%` `%channels%` | core | |
| `%filesize_natural%` `%filename_ext%` `%path%` `%subsong%` | core | `%path%` is absolute and platform-separated |
| `%rating%` | core, from the file tag | |
| `%replaygain_track_gain%` `%replaygain_album_gain%` `%bpm%` | tags | |
| `%lastfm_play_count%` `%lastfm_last_played%` `%lastfm_first_played%` | `foo_enhanced_playcount` | counts scrobbles across every device. `0` and `N/A` when unplayed, not `?` |
| `%play_count%` `%last_played%` `%first_played%` | `foo_playcount` | counts plays on this machine. A different number from the last.fm pair, so preferring one is a choice |
| `$meta(unsynced lyrics)` | tags | **the tag name has a space.** `%lyrics%` answers `?` and `$meta(unsyncedlyrics)` finds nothing |

Which of these resolve varies by install, by component and by how the library was tagged. Detect; never assume.

> **There is no play history, only a last play.** A play count is a lifetime total and a last-played is the most recent play and nothing else, so a track played today and again weeks ago reports only today. Any per-day or per-week chart built on it undercounts every older bucket and slopes upward whatever the listening did. A window can honestly report how many *distinct tracks* were touched since a date, and must say so in those words.

> **There is no working date-added field at any price.** `%added%` does not resolve. `%last_modified%` is not a substitute: playback can rewrite tags, which bumps the file's mtime, so it is `max(added, last played or retagged)`, wrong precisely at the recent end, where a "recently added" view would look.

> **Lyrics need no component.** `$meta(unsynced lyrics)` returns whatever is in the tag, which is LRC-timestamped only some of the time and is plain text more often than not. Real content includes several timestamps on one line, credit lines, and tags holding nothing but a URL. The field is large enough that it is fetched per track and **MUST never go in `trcolumns` on the update stream**, which re-evaluates its columns on every push. `foo_openlyrics` is what *writes* the tag.

## Traps that cost time

> ### Deleting a playlist the play queue points into crashes foobar2000
>
> An access violation inside `foo_beefweb`, taking the player down until it is restarted by hand. Whether a plain queued entry is enough or the `itemIndex: -1` orphan is required is not narrowed, and narrowing it means crashing the player again. **Treat both as fatal.**
>
> **Clear a playlist's queue entries before deleting it, and abandon the delete if they will not clear.** `dequeuePlaylist` in `src/domain/player/queue.ts` does this, from `usePlaylistActions`, so no caller can forget. Emptying a playlist with `/clear` is not implicated.

- **`queueIndex` on `/playqueue/add` is accepted and silently ignored.** `{ plref, itemIndex, queueIndex: 0 }` answers **204** and appends anyway. It is not a 400, so **there is nothing to feature-detect it with**. There is no insert-at-position and no cheap "play next"; both are a remove-and-re-append of the queue's tail. `queueIndex` on *remove* does work, and is exact.
- **Neither queue route has a bulk form.** `{ plref, items: [1,2,3] }` on add is `400 parameter is required: itemIndex`; `{ items: [0,1] }` on remove is `400 either queueIndex or plref plus itemIndex parameters are required`. That rules the queue out as a way to express "play this set of tracks": a playlist is the only mechanism the API has for it. Duplicates are allowed.
- **Sending the wrong column parameter is not an error.** `/api/playqueue` with `qcolumns`, or `/api/player` with `trcolumns`, answers 200 with `"columns": []` on every entry, which reaches a UI as blank rows rather than as a failure.
- **Playback order applies to the active playlist, and playing a track sets it.** `POST /player/play/p5/3` makes `p5` current, and shuffle then draws only from `p5`. Confining playback to a set of tracks means getting those tracks into a playlist; there is no selection concept to shuffle within.
- **Emptying or deleting the playing playlist does not stop playback.** The current track keeps playing but is orphaned: `activeItem.playlistId` goes to `""` and `index` to `-1`. Emptying is harmless if a play follows immediately. Deleting is not: at the end of the track the player falls back to another playlist and carries on.
- **A manual skip pushes an empty `activeItem` before it pushes the next track**, and goes on reporting `playbackState: "playing"` across the gap. Every field is cleared at once, so a client that draws each field as it arrives shows no cover, no title and `0:00` for the width of the gap. Three things make it a trap: it is **only manual skips**, so the flash looks intermittent; it is **not the stopped item**, which reports `duration` and `position` as `-1`; and **emptiness has to be read off `columns`, not off `index`**, since the orphan above is a lasting `index: -1` behind a track that is still audible. `holdThroughGap` in `src/domain/player/usePlayer.ts` holds the last item, with its `syncedAt`, until the next real one lands.
- **Renaming a playlist while it is playing is seamless**: same track, same position, uninterrupted. That turns "save these results as a playlist" into a rename rather than a copy.
- **`playbackOrder` is a foobar2000 option and DeaDBeeF has none.** DeaDBeeF splits the order into `shuffle` and `repeat` and answers `400 invalid option id`, accepting only the deprecated top-level `playbackMode`, which beefweb translates back into its own pair. The deprecated form is the fallback rather than a mistake.
- **There is no tag-writing endpoint.** Every POST route is playback, playlists, queue, outputs or clientconfig. Ratings and lyrics can be *read* through title formatting and cannot be written back through beefweb at all.
- **There is no way to reach another component.** `/api/commands`, `/api/command`, `/api/mainmenu`, `/api/contextmenu`, `/api/plugins` and `/api/components` all 404.

## The library on beefweb 0.10

**There is no library API.** No `/library`, no `/search`, nothing touching foobar2000's Media Library index. beefweb sees *playlists* and *the filesystem*, and that is the whole surface. Two ways round it:

1. **An autoplaylist as a library mirror.** An autoplaylist is a live Media Library query; created with the query `ALL` it holds every track, updates itself, and appears in `/api/playlists` like any other playlist. It needs no components. Autoplaylists cannot be created through beefweb, so this is a setup step at the player, or a call to `foo_jean`.

   > **Do not use `Default Playlist` for this.** It is foobar's scratch buffer: selecting an album in the library view replaces its entire contents.

2. **The filesystem browser.** `/browser/entries` walks the disk, and `/playlists/{id}/items/add` takes file or directory paths. That is not the tagged library: paths and no metadata until items are in a playlist. Good for an "add folder" flow, bad as a browse model.

## The media library API

**foobar2000 only, and only on beefweb 0.11+.** On DeaDBeeF every endpoint here is **501**; on 0.10 they are **404**. **Jean does not read the library through any of it.** `foo_jean` answers the library, and these routes are only what a fill, a queue or a tag write acts *through* once a row has been chosen.

### `GET /library/info`

```jsonc
{ "library": { "supported": true, "enabled": true, "itemCount": 30441 } }
```

The only one of these that answers without the API, which is how a client discovers it has none.

**`enabled: false` means foobar2000 has no Media Library configured**, a different problem from "this player has no library API", fixed in foobar's own preferences rather than in a client. The two MUST NOT collapse into one state.

**There is no library change event.** `/api/query` has no `library` key, so library changes cannot be observed. Detecting drift means re-reading `itemCount`.

### `GET /library/items`

| Parameter | |
|---|---|
| `columns` | **required** |
| `range` | a **query parameter** in `offset:count` form, not a path segment. All items if omitted |
| `query` | the *player's* own query syntax |
| `sort` | a title-format expression, defaulting to file path |
| `desc` | |

```jsonc
{ "libraryItems": {
  "offset": 0, "totalCount": 30441,
  "items": [ { "path": "Artist/(2012) Album/01. Track.mp3", "subsong": 0, "columns": ["Artist", "Track"] } ]
}}
```

- **A track is `(path, subsong)`.** Subsong is non-zero for cue sheets and disc images, so it is not decoration.
- **Items are not naturally ordered.** The spec says they are produced by applying search criteria, so paging without an explicit `sort` may not be stable across requests. Pass `sort=%path%`. `LIBRARY_SORT` in `src/shared/api/beefweb.ts` is that constant, and it is the same expression a filled playlist is sorted by.
- **There is no caching on the player side.** Every call enumerates the library and computes a relative path per item, serialised on beefweb's single work queue, so concurrent requests do not overlap and chunking a whole-library read costs more than asking for it in one request.

### `GET /library/items/by-path`

One level of the tree: folders first, each with a recursive `itemCount`, then tracks with the requested columns.

```jsonc
{ "libraryNodes": {
  "offset": 0, "totalCount": 27, "path": "#/Artist", "parentPath": "#",
  "items": [ { "type": "D", "name": "A", "path": "A", "itemCount": 2147 },
             { "type": "F", "name": "01. Track.mp3", "path": "Artist/(2012) Album/01. Track.mp3",
               "subsong": 0, "columns": ["Track"] } ]
}}
```

Folder nodes carry `itemCount` and no columns; track nodes carry `subsong` and `columns` and no `itemCount`. `parentPath` is absent at the top level. **There is no `pathSeparator` field here.**

**Ordering is a byte-wise case-sensitive compare**, so `Zappa` sorts before `abba`. Re-sort client-side.

> **This is the only way to reach one track by the path a client already holds.** `/library/items` pages an enumeration ordered by absolute `%path%`, while `foo_jean`'s ordinals are library-relative path order, and on a library with more than one root those two orders disagree. An ordinal is therefore not an offset into `/library/items`, and a folder is what both sides can name.

### Paths

> **Library paths are `/`-separated on every platform** and relative to the media library folders, even on Windows where `pathSeparator` from `/browser/roots` is `\`. Do not build them with `pathSeparator`.
>
> **The player and the library disagree about what a path is.** `activeItem`'s `%path%` is absolute and platform-separated; a library item's is relative and forward-slashed. Nothing tells a client where the library folders are, so the two are matched **by suffix** after normalising separators. A relative path is unique within the library, so it cannot collide. `libraryPathMatcher()` in `src/shared/api/beefweb.ts`.

### `GET /artwork/library?path=&subsong=`

Artwork without a playlist, which is the constraint it removes. A folder prefers its own image file (`folder`, `cover`, `front`, `album`, `artwork`) and falls back to the first track's.

**Folder artwork probes the filesystem on the player's single work queue**, and a folder-thumbnail grid multiplies that. Requests are the budget here, not bytes: beefweb answers on one queue and closes the connection per response, so a screen full of covers is a screen full of connections however small each one is.

### `POST /playlists/{playlistId}/items/add-from-library`

`{ items: [{ path, subsong }] | query, index, replace, play }`. Requires `changePlaylists`.

**`replace: true, play: true` is a whole scratch-playlist rebuild in one request**: no rename, no remove-by-range, no copy, no separate play, and so no client-side count arithmetic to get wrong.

> **A request body over 1 MiB is refused by hanging up**, not answered with a status. It reaches the client as a network error rather than a status code. Naming every track in a large library exceeds it, so "play everything" never reaches the player at all.
>
> **Omit both `items` and `query` to mean the whole library.** One request, no body, and it sidesteps the limit entirely.

> **The order of `items` is ignored.** A set arrives in the **media library's browse order**, meaning album artist, then album, then track, while `GET /library/items` pages by **file path**. The order cannot be predicted: no `sort` expression reproduces it, and learning it by reading the filled playlist back has nothing to invalidate against, since the player publishes no library-change event.
>
> **So overwrite it instead of predicting it**: fill, then `POST items/sort` with the same expression the library was read with.

> **Matching `items` against the media library is unreliable and unresolved.** `{ items: [{ path, subsong }] }` has been observed to answer 204 and add **zero** tracks, for paths taken straight from `GET /library/items?columns=%path%`: with `subsong` omitted, with `replace: true`, with a `file://` scheme and with forward slashes alike. The body *is* parsed: an unrecognised key falls through to "neither items nor query" and adds the whole library, and `{ query: … }` works. `POST /playlists/{id}/items/add` with the same plain path also works. **Re-measure before relying on `items`.**

> **Do not mix the two filters.** `query` is the player's own syntax; a client-side search is not. They do not return the same set, so filtering client-side and then adding server-side by `query` adds tracks that are not the ones on screen.

### What it does not give you

- **No playback without a playlist.** There is no "play this library item"; you add to a playlist with `play: true`.
- **No library change events.**
- **No autoplaylist creation.** That needs `foo_jean`.

## Reaching other foobar2000 components

beefweb does not proxy other components and has no "run this command" endpoint. Three real routes, in descending order of how well they work:

1. **Title formatting, the genuine escape hatch.** Any component publishing fields or functions to the title-formatting engine becomes readable through `columns`. Install a playback-statistics component and its fields start returning values instead of `?`. Subject to the comma limitation above.
2. **Sort by expression.** `items/sort` plus copy-between-playlists generates derived playlists server-side without pulling data down first.
3. **The command line, on the player's own machine.** foobar2000's executable takes `/command:"<main menu command>"`, `/playlist_command:` and `/playing_command:`; `foo_runcmd` adds a `/runcmd=` family. Untested here.

**Out of reach:** driving the Converter or Masstagger, searching the media library on 0.10, and reading component UI state.

## The beefweb repository

`https://github.com/hyperblast/beefweb`

| Path | What is in it |
|---|---|
| `docs/player-api.yml` | **The OpenAPI spec, the authority.** Request bodies, parameters, response schemas |
| `docs/advanced-config.md` | `config.json` options: `webRoot`, `urlMappings`, `responseHeaders`, auth. **Read the tag matching the plugin version, not `master`.** `altWebRoot` and relative `urlMappings` paths are on `master` and absent from 0.10, where a relative path silently 404s |
| `js/api_tests/` | Integration tests. The quickest way to find the exact body shape for a mutation |
| `js/client/` | Official JS client. **Not published to npm** (`private: true`). Read it, do not depend on it |
| `js/webui/` | Source of the stock UI |
| `cpp/` | The plugin itself |

```sh
npx @redocly/cli preview-docs \
  https://raw.githubusercontent.com/hyperblast/beefweb/master/docs/player-api.yml
```

---

# `foo_jean`

A foobar2000 component listening on a port of its own, typically 8881. Its source is `plugins/fb2k/`. The media library, tag writing and listening all arrive through it, and Jean reaches none of the three without it.

| | |
|---|---|
| Base URL | `http://<player-host>:8881`, the **same host as beefweb**, a different port |
| Auth | `Authorization: Bearer <token>` on everything but `GET /status` and `POST /pair` |
| `apiVersion` | `1`. A client MUST refuse a number it does not understand |
| CORS | genuinely cross-origin, so every authenticated call is preflighted |
| Owner's config | `<profile>/foo_jean/config.json` holds `port`, the bind address, `allowedFields`, `maxAutoPlaylists`, `maxConcurrentStreams`, `streamingEnabled`, `muteWhileStreaming` and `allowedOrigins`. Jean never edits it and there is no route to it |

## Discovery, and why its answer cannot be trusted

The component writes `<profile>/beefweb/clientconfig/foo_jean.json` on every start, which beefweb serves at `GET /api/clientconfig/foo_jean`, same origin as Jean, so discovery is one request folded into connect, with no CORS and no port scanning.

```jsonc
{ "name": "foo_jean", "version": "0.3.0", "apiVersion": 1,
  "port": 8881, "authRequired": true, "listening": true }
```

| Field | |
|---|---|
| `port` | where the component *says* it is listening. Verify before trusting |
| `listening` | false when the component loaded and could not bind. **Not the same as an absent record** |
| `error` | present only when `listening` is false. Safe to show a person |
| `portInUse` | present only when `listening` is false, and separated out since it has a specific remedy: change `port` in the component's `config.json` |

**A `null` body is the not-installed signal**, and is the common case. beefweb answers 200 with `null` for an id nobody has written.

> **The record is writable by anyone who can reach beefweb, so it is a hint and never a credential target.** `POST /api/clientconfig/{id}` is a documented beefweb route, `changeClientConfig` defaults to on, and beefweb ships with no authentication. A forged record can name any port, and the forgery lasts until the component next starts. A client that believed it would POST the user's bearer token to an attacker's listener.
>
> **The order is the security model:**
>
> 1. Read the record. `null` → not installed, done.
> 2. `GET http://<same-host>:<port>/api/status`, **unauthenticated on purpose**, and require `name` of `foo_jean` and an `apiVersion` this build understands.
> 3. Only then attach `Authorization: Bearer <token>` to anything.
>
> Step 2 is cheap and is not optional. `discoverFooJean()` in `src/shared/api/fooJean.ts` is the one implementation.

### The states discovery resolves to

| Kind | Means |
|---|---|
| `absent` | no record, or beefweb hiccupped. The common case |
| `not-listening` | installed, could not bind. Carries `error` and `portInUse` |
| `unreachable` | advertised and did not answer. Transient; retried with backoff |
| `impostor` | something answered on that port and it is not `foo_jean`. **This is what a forged record looks like from here, and a client must say it did not send the token** |
| `unsupported` | `foo_jean` answering an `apiVersion` this build does not know |
| `no-token` | healthy, not yet paired |
| `unauthorized` | the token was refused |
| `ready` | paired, with capabilities in hand |

The component is installed and working in five of them, and none of them is silence. `src/features/settings/TagWriting.tsx` holds one message and one remedy per state.

## Endpoints

| Route | Auth | |
|---|---|---|
| `GET /api/status` | none | identify the component. Reports nothing a port scan would not |
| `POST /api/pair` | none | read the token, during a window opened at the player |
| `GET /api/capabilities` | bearer | the write allowlist and the streaming and autoplaylist limits |
| `POST /api/tags` | bearer | write metadata to one track |
| `GET /api/library` | bearer | both generations, the track count and the column set that is built |
| `GET /api/library/export` | bearer | the whole library, as one binary snapshot |
| `GET /api/library/changes` | bearer | a per-column patch since a revision |
| `POST /api/library/refresh` | bearer | force a rebuild, rate limited |
| `GET /api/artwork?track=` | bearer | one front cover, by library-relative path |
| `GET /api/playlists` | bearer | which playlists are autoplaylists, and which this component created |
| `POST /api/autoplaylists` | bearer | create one |
| `POST /api/autoplaylists/preview` | bearer | try a query without creating anything |
| `POST /api/autoplaylists/{id}` | bearer | repoint an existing one |
| `DELETE /api/autoplaylists/{id}` | bearer | delete one it created |
| `POST /api/stream/ticket` | bearer | a short-lived credential for one stream connection |
| `GET /api/stream` | **ticket** | the audio |
| `GET /api/stream/timeline` | bearer | what is audible, in the stream's own clock |
| `GET /api/stream/listeners` | bearer | who is listening |
| `POST /api/stream/leave` | bearer | this device stopped on purpose |
| `DELETE /api/stream/hold` | bearer | ask for the player to be audible alongside the listeners |

### `GET /api/status`

```jsonc
{ "name": "foo_jean", "version": "0.3.0", "apiVersion": 1, "authRequired": true }
```

Needs no credential, and that is the point: it tells "`foo_jean` is here" from "something else is listening" before a token is spent. The field allowlist is deliberately **not** in it.

### `POST /api/pair`

`{ name? }` → `{ token, apiVersion }`. Three bounds, none optional:

- **Single grant.** The first success closes the window, which the owner opens at the player for 120 seconds. Pairing a second device takes a second press.
- **Private source addresses only**: RFC1918, loopback, link-local and their IPv6 equivalents. A forwarded port or a tunnel cannot be paired through. The address is checked *before* the window is consulted, so a caller from outside learns nothing about whether a window is open and cannot spend a grant.
- **`Content-Type: application/json` is required.** A simple POST needs no CORS preflight, so without this a page on any origin could fire one blind and spend the grant. Requiring JSON forces every cross-origin caller to be preflighted.

| Status | Meaning |
|---|---|
| `403` + "local network" in the message | source address is not private |
| `403` otherwise | no window is open; a button for the owner to press |
| `429` | busy |
| `404` / `415` | not this API |

**Pairing is a write, so it obeys the discovery order.** `discovery.origin` is non-null exactly when the probe succeeded, which makes it the proof a port is safe to post to, so the Pair button renders on `origin` rather than on the state kind, and an unreachable or impostor port never gets one.

### `GET /api/capabilities`

```jsonc
{ "apiVersion": 1, "allowedFields": ["rating"], "canWrite": true,
  "maxAutoPlaylists": 8, "canCreateAutoPlaylists": true, "canReadLibrary": true,
  "canStream": true, "streamFormats": ["opus", "aac"], "canMuteWhileStreaming": true }
```

- `allowedFields` is the **write allowlist**, a blast-radius bound the *player owner* sets. A client renders controls for the fields named here and nothing else, rather than carrying its own copy of the list. **A client's own switches narrow and never widen**: Settings lists exactly the permitted fields and turns them off, never on.
- `canWrite`, `canCreateAutoPlaylists` and `canStream` are exactly `allowedFields.length > 0`, `maxAutoPlaylists > 0` and `streamFormats.length > 0`. Conveniences, not second sources of truth.
- `streamFormats` is best-first. `opus` is Ogg Opus; `aac` is AAC-LC in ADTS, for older Safari. The list varies by install: one whose Windows has no AAC encoder reports `opus` alone. **`?format=` outside this list is a 400.**
- `canMuteWhileStreaming` is `muteWhileStreaming` in the owner's config. There is no route that changes it.
- `canReadLibrary` says whether the routes under `/api/library` are there at all. False on a component that loaded without the feature and on any version predating it, and every one of them then answers `503`.

### `POST /api/tags`

`{ path, subsong?, fields: { name: value } }` → `{ written: true, path, subsong, fields }`.

The player performs the write through `metadb_io_v2`, so foobar2000's own database is current when this returns and a client re-reading through beefweb sees the new value.

- **`path` is exactly beefweb's `%path%`**: a plain absolute local path. No URL scheme, not even `file://`, no UNC share, no `..`, no relative path.
- **Omit `subsong` for an ordinary file**; a missing value reads as 0.
- **Only the named fields are touched.** An empty string *removes* a field rather than setting it to empty, which is how a rating is cleared rather than set to `"0"`.
- **One track per request.** Writes are not batched.
- Two names differing only in case are refused rather than guessed at: foobar2000 tag names are case-insensitive, and that is two instructions for one tag.

| Status | Meaning | Decided |
|---|---|---|
| `400` | malformed request, missing or unacceptable path, no fields | before the player is involved |
| `403` | field not on the allowlist. Carries `field` | before the player is involved |
| `404` | foobar2000 does not know that track, which is neither in the Media Library nor in an open playlist. **The SDK will build a handle for any path at all, so a well-formed path says nothing about the player knowing it** | |
| `504` | the player did not answer in time. **The write may still land, so a client must not roll back** | |
| `503` | tag writing is not available | |

### The library, as one snapshot

`GET /api/library/export?columns=…` answers the whole library in one binary body, dictionary-encoded per column. `shared/api/jlib.ts` decodes it and `shared/api/fooJeanLibrary.ts` is the loop that asks for it. `contract/openapi.yaml` is the format itself, under *The media library*; what matters on this side:

- **The client declares the columns, and the export request is the declaration.** Jean sends `TRACK_EXPRESSIONS`, one `columns` parameter per expression, never comma-separated: a title-formatting expression may contain a comma.
- **A `202` means no snapshot of that set exists and one is being built.** Poll `GET /api/library` until `ready` is true and its `columns` have the same members, in any order, then ask again. The first export after the component starts, and the first after the set changes, is the slow one.
- **A `429` is the rebuild rate limiter**, shared with `POST /api/library/refresh`. It carries `Retry-After` in seconds.
- **`?`, `''` and `N/A` arrive exactly as the player produced them.** Nothing in the component parses, normalises or types a value, which is what keeps Jean's capability detection working. **Never coerce one to `null`**: `Number(null)` is `0` and every field would then read as available.
- **The header answers capability detection exactly.** Every column carries `distinct`, `hasUnresolved` and `allUnresolved`, so a field that resolves on one track in ten thousand is detected rather than missed by a sample. Detection is still a guess a Settings switch overrules.
- **Ordinals are refs.** Row order is library-relative path order, ties broken by subsong, so a ref keeps meaning what it means everywhere else in Jean. An ordinal means nothing across a `structure` change.
- **The spine is `directory`, `filename` and `subsong`**, always built and never named in `columns`. `directory` keeps its trailing slash, so `directory + filename` is the whole relative path. The library root never appears.
- **Every offset in the blob is a multiple of four**, which is what lets a client take `new Uint32Array(buffer, at, count)` over the bytes where they lie. A typed array over an unaligned byte offset throws.
- **Every integer in the blob is little-endian.** So is every platform a browser runs on, so a typed array taken directly over the bytes needs no byte-swap.
- **gzip is transparent here.** The component compresses when the request offers it, and a browser both offers and decodes without being asked, so nothing in Jean sees the coding. The `ETag` names it, and the two codings are two representations that never share a validator, so a conditional request has to go back with the same `Accept-Encoding` it was made with.

**`ETag` and `Retry-After` are readable cross-origin because the component names them in `Access-Control-Expose-Headers`.** A browser exposes only a short safelist to script otherwise, so a header not named there reads as `null` rather than as an error: a conditional request would quietly refetch, and the documented `429` backoff would quietly fall through to its default.

### Keeping that snapshot current

`GET /api/library` carries both generations and is small, so it is what says whether there is anything to do at all.

- **A different `structure` means every ordinal Jean holds is meaningless.** Tracks were added or removed. Export again.
- **A higher `revision` at the same `structure` is a delta.** `GET /api/library/changes?since=` answers the same binary format carrying only the columns that moved and, within each, only the rows that moved.
- **`409` and `410` are ordinary rather than errors.** The first says ordinals shifted under the request, the second that `since` fell out of the retained window. Both mean the same thing: export again, and say nothing to the user.
- **A dictionary only ever gains entries within a `structure` generation.** A delta restates none of it: `dict.base` is how much the client already holds, `dict.ends.count` is `distinct - base`, and every id below `base` still means what it meant. A rebuild is what compacts a value that fell out of use.
- **A delta's `ids` are parallel to its `ordinals`, not to the rows.** `ordinals.width` comes from the track count and `ids.width` from the dictionary size, so they are routinely different widths and both MUST be read rather than assumed.
- **The spine effectively never moves**, because a path changing is a removal and an addition and that moves `structure`.
- **A poll that finds nothing is a `304` with no body**, which is what makes re-checking cheap enough to ride a track change instead of a timer.

### Covers

`GET /api/artwork?track=` takes the snapshot's `directory` and `filename` for a row, concatenated and percent-encoded. There is no ordinal here: an ordinal means nothing across a `structure` change, so a URL built from one would change every time a track was added anywhere. The address is matched against the snapshot and joined to nothing, so an address the snapshot does not carry is a `404` and never another record's sleeve.

- **Point every row of a record at one URL.** An HTTP cache is keyed by the URL, so a record addressed row by row is one request per row however identical the bytes. The route takes a track rather than an album because the player resolves art per track, from the file's own tags or from an image beside it, and which of the two it is varies inside one library.
- **`Cache-Control: no-cache, must-revalidate` against a strong `ETag`** folded from the picture itself. Nothing foobar2000 offers names the file a cover came from until that cover has been loaded, so the validator moves when and only when the sleeve does, including a `folder.jpg` replaced in place, which the player announces to nobody. The cost is that a `304` loads the picture too and saves the transfer rather than the work.

> **A browser does keep it, and revalidates.** RFC 9111 withholds storage of a response to a request carrying `Authorization` unless it also says `public`, `must-revalidate` or `s-maxage`, and that restriction binds a shared cache rather than a private one. Chrome, Chromium, Firefox and WebKit were each measured storing the response and sending `If-None-Match` back, in one page, across a browser restart, and cross-origin through the preflight, with and without `must-revalidate`. So a repeat view of a cover costs a conditional request and no transfer.

### Autoplaylists

`POST /api/autoplaylists` takes `{ title, key?, query, sort?, forceSort? }` and hands the playlist to foobar2000's own autoplaylist client, so the core keeps it filled and keeps it after the component is uninstalled.

- **`query` is foobar2000's own syntax, passed through untouched.** The component never composes or interprets it, so **quoting is the client's responsibility**. A value pasted in unquoted can produce a valid query that is not the intended one, and no validation can catch that.
- **`key` is opaque**: stored, handed back, compared for equality, never interpreted. It is how a client recognises its own playlists rather than encoding a convention in a title the user can edit. It MUST be unique; a duplicate is a **409**, so the same create request is safe to send twice.
- **An autoplaylist filters the Media Library and nothing else.** On an install with none configured every autoplaylist is empty and nothing in the player says why. Read `libraryEnabled` from the preview first.
- **Existing playlists are never converted.** The core replaces the contents of a playlist when it takes one over, so there is no route for it.
- `POST /api/autoplaylists/{id}` **replaces** the specification: `query`, `sort`, `key` and `forceSort` end up exactly as sent, so send the whole record. `title` is the exception: omit it to leave the name alone rather than undoing a rename made at the player. `id` is foobar2000's playlist GUID, not beefweb's id.
- Only playlists this component created can be updated or deleted. Anything else is a **403**, including an autoplaylist made in foobar2000 itself.
- Playlist writes are rate limited: a burst of thirty, refilling at one a second, shared across create, update and delete. Reading and previewing are not limited. **429** carries `Retry-After` in seconds.

> **`POST /api/autoplaylists/preview` answers 200 with `valid: false` for a query that does not parse, never a 400.** This is the route called while somebody is typing, so an unreadable query is data rather than an error. Creating with the same query *is* a 400. **Debounce it.** It runs on foobar2000's main thread, so one request per keystroke is one main-thread callback per keystroke.

### `GET /api/playlists`

Not a playlist listing. One annotation per playlist, in playlist order, carrying only what beefweb cannot answer:

```jsonc
{ "playlists": [ {
  "id": "45837d74-…",        // foobar2000's playlist GUID: stable across renames, never reused
  "beefwebId": "p7",         // the join key
  "index": 0,
  "title": "…",              // for checking a join, not for display
  "isAutoPlaylist": true,
  "managed": { "key": "folder:genre:Rock", "query": "…", "sort": "…", "forceSort": false }
} ] }
```

- **`managed` is null for every playlist this component did not create**, including autoplaylists made in the player. That is how a client tells a folder it manages from an autoplaylist that was already there.
- **Ask beefweb first.** beefweb assigns its playlist ids lazily, so a playlist just created here reports `beefwebId: null` until beefweb next rebuilds its map, and requesting beefweb's playlists is what makes it do so. Fall back to `index` for the join.
- **`managed.query` goes stale silently** if the query is edited in foobar2000's own dialog. The SDK offers no way to read an autoplaylist's current query back.

### Streaming

A single unbounded chunked response carrying the player's own output, post-DSP and post-ReplayGain. **No length, no `Range`, no seeking**, because seeking means asking foobar2000 to seek, which moves every listener at once.

**`POST /api/stream/ticket`** takes `{ deviceId?, name? }` and returns `{ ticket, expiresIn }`.

> **The ticket travels in the query string and the bearer token never does.** An `<audio>` element sends no headers, so `GET /stream?ticket=…&format=…` is a capability URL bounded by a short lifetime. It grants nothing but the audio already playing. Clients MUST NOT store, log, or otherwise place a ticket where a bearer token would not go.

- **A ticket is not single-use.** Safari probes a source with `Range: bytes=0-1` before fetching it for real, so one playback start is two requests. `maxConcurrentStreams` is what bounds concurrency.
- **Request a fresh ticket when reconnecting**, and call this immediately before opening the stream rather than at page load.
- The ticket is also where a device says who it is, the only part of opening a stream a client controls. A request with no body is an anonymous listener rather than a refusal.
- `deviceId` is untrusted: it labels a row in somebody else's picker and nothing branches on it. Generate it at random, keep it, and never derive it from anything about the person.

**A client MUST reconnect rather than treat the end of the response as a stop.** A dropped connection is ordinary on a wireless network and an `<audio>` element does not retry by itself. The response also ends when the listener falls too far behind to be sent contiguous audio.

**`GET /api/stream/timeline`** → `{ streamTime, marks: [{ at, path, subsong, position }] }`.

The player's reported position is not what a listener is hearing, because the stream runs behind it, so a progress bar driven from beefweb runs ahead of the audio. `streamTime` counts seconds of audio encoded since the component started; `marks[].at` is in that same clock, and a mark is written when a track starts *or* when somebody seeks within one.

```js
// once, when the element starts playing
const connectedAt = performance.now()
const { streamTime } = await (await fetch(`${origin}/api/stream/timeline`, auth)).json()
const anchor = streamTime - (performance.now() - connectedAt) / 1000

// any time after
const audible = anchor + player.currentTime
const mark = marks.findLast((m) => m.at <= audible)
const position = mark ? mark.position + (audible - mark.at) : null
```

**Re-anchor after every reconnect**, since `currentTime` restarts. Browsers differ over whether `currentTime` starts at zero or at the stream's own granule position; deriving `anchor` this way works either way.

`marks[].path` is a plain absolute local path, the same form beefweb reports for `%path%` and the same form `POST /api/tags` accepts, so the three join on equality. It is **not** the form the player stores: on a portable install foobar2000's canonical path is `file-relative://…`, and this route resolves it.

**`GET /api/stream/listeners`** → `{ devices: [{ deviceId, name, format, connections, listeningFor }], connections, maxConnections, playerMuted }`.

- **Count devices, never connections, anywhere a person is told how many people are listening.** One device is routinely two connections, or three across a reconnect. `connections` is what `maxConnections` bounds.
- `name` is null when the device did not name itself, so a client can tell that from a name it chose. An anonymous connection is its own device: merging them would report two strangers as one person.
- **`playerMuted` says a listener is what silenced the player, as opposed to a mute made by hand.** foobar2000 has no mute flag, since mute is the volume at its floor, so a client reading beefweb sees a fader at the bottom either way, and this is what says which sentence to put beside it.
- **This is a roster and not a set of targets.** Audio cannot be sent to a device that is not already asking for it: starting playback in a browser needs a gesture on that browser, so there is nothing here to press.

**`DELETE /api/stream/hold`** asks for the player to be audible alongside the listeners. There is no route that *takes* the hold. The component decides when they should be one, and decides again the moment everybody stops listening, so a reconnect does not undo the choice and the next session does not inherit it. Idempotent, and it says nothing about whether there was a hold to release.

**`POST /api/stream/leave`** `{ deviceId }` says a device stopped on purpose. A closed socket does not say why it closed, and a handoff back to the player and a wireless dropout look identical from here while wanting opposite answers. Best effort and never required: a crash, a closed tab and a failed request all end the same way after the linger. It can only ever end its own device's linger.

## Error shapes

Every failing response carries at least `{ error }`. Refusals decided before the player is involved add `detail`, and a field-level refusal adds `field`. Error text never names anything on the player's disk: `detail` describes the request the client sent, so it is safe to show a person.

| Family | Statuses |
|---|---|
| Tag writes | `400` malformed / missing path / unacceptable path / no fields · `403` field not allowed · `404` unknown track · `500` write failed · `504` player too slow · `503` unavailable |
| Playlists | `400` refusal · `403` not ours · `404` no such playlist · `409` duplicate key or at the cap · `429` rate limited · `500` player refused · `504` player too slow · `503` unavailable |
| Streaming | `401` no or expired ticket · `503` busy **or** not supported, and the `error` string is all that separates them, and a client should present the first as retryable |
