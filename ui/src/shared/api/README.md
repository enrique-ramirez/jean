# API reference

Two HTTP APIs sit under Jean. **beefweb** does playlists and the queue, takes the playback commands, and answers artwork for a row that is in a playlist. **`foo_jean`** listens on a port of its own and answers the player's own state as well as everything else: the library and its covers, writing tags, creating autoplaylists, and streaming the player's output.

Verified against foobar2000 with the beefweb plugin. Where behaviour differs by plugin version it says so: **0.10** is the current release, **0.11** adds the media library API.

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
| `playlists=true` | the playlist list |
| `playQueue=true` | the whole play queue |
| `outputs=true` | active output, types and devices |
| `playlistItems=true` | items, with `plref` and `plrange` |
| `trcolumns=` | columns for the active track. Needs `player=true` alongside it, and nothing else here reads what `player=true` returns on its own |
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
| `POST /player` | `{ position }` / `{ relativePosition }` | seek, in seconds |
| `POST /player` | `{ volume }` / `{ relativeVolume }` / `{ isMuted }` | volume is **decibels**; read `volumeMin`/`volumeMax` off `foo_jean`'s `GET /api/capabilities` |
| `POST /player` | `{ options: [{ id, value }] }` | the supported way to set playback order |
| `POST /player` | `{ playbackMode }` | deprecated ordinal write |
| `POST /player/play` · `/play/{playlistId}/{index}` · `/play/random` | — | |
| `POST /player/next` · `/previous` | `{ by }` optional | `by` takes an expression, so "next album" is possible |
| `POST /player/stop` · `/pause` · `/pause/toggle` · `/play-pause` | — | |
| `POST /player/volume/up` · `/down` | — | one player-defined step |

> **Nothing may address a playback mode by index.** The ordinal in `{ playbackMode }`, and in `options`' `playbackOrder` value, means whatever this install's enum says it means: order and wording both vary. `foo_jean` maps it to its own names instead, `contract/openapi.yaml`'s `PlaybackMode`.

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

**Jean does not call any route on this page.** The queue is `foo_jean`'s own, *What Jean does about the queue* below; what follows is a fact about beefweb, real for any client that has no other queue to reach for.

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

Addressed by **playlist index**, so this answers for a playlist Jean is showing and for nothing else: nothing in `ui/src` builds this address any more. The cover wheel's neighbouring slots and a queued playlist row draw `foo_jean`'s `GET /artwork?track=<libraryPath>` instead, addressed by the row's own library path, and draw nothing where a row has none. The status bar and the now-playing screen's centre cover read `foo_jean`'s `GET /artwork/playing`, and the media session draws no cover at all: the OS issues that request itself, cannot carry a bearer token, and the route answers `401`. See *What Jean does about artwork* below.

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
- **A request body over 1 MiB is refused by hanging up, not answered with a status.** It reaches the client as a network error rather than a status code.
- **Sending the wrong column parameter is not an error.** `/api/playqueue` with `qcolumns`, or `/api/player` with `trcolumns`, answers 200 with `"columns": []` on every entry, which reaches a UI as blank rows rather than as a failure.
- **Playback order applies to the active playlist, and playing a track sets it.** `POST /player/play/p5/3` makes `p5` current, and shuffle then draws only from `p5`. Confining playback to a set of tracks means getting those tracks into a playlist; there is no selection concept to shuffle within.
- **Emptying or deleting the playing playlist does not stop playback.** The current track keeps playing but is orphaned: `activeItem.playlistId` goes to `""` and `index` to `-1`. Emptying is harmless if a play follows immediately. Deleting is not: at the end of the track the player falls back to another playlist and carries on.
- **A manual skip pushes an empty `activeItem` before it pushes the next track**, and goes on reporting `playbackState: "playing"` across the gap. Every field is cleared at once, so a client that draws each field as it arrives shows no cover, no title and `0:00` for the width of the gap. Three things make it a trap: it is **only manual skips**, so the flash looks intermittent; it is **not the stopped item**, which reports `duration` and `position` as `-1`; and **emptiness has to be read off `columns`, not off `index`**, since the orphan above is a lasting `index: -1` behind a track that is still audible.
- **Renaming a playlist while it is playing is seamless**: same track, same position, uninterrupted. That turns "save these results as a playlist" into a rename rather than a copy.
- **There is no tag-writing endpoint.** Every POST route is playback, playlists, queue, outputs or clientconfig. Ratings and lyrics can be *read* through title formatting and cannot be written back through beefweb at all.
- **There is no way to reach another component.** `/api/commands`, `/api/command`, `/api/mainmenu`, `/api/contextmenu`, `/api/plugins` and `/api/components` all 404.

## The library on beefweb 0.10

**There is no library API.** No `/library`, no `/search`, nothing touching foobar2000's Media Library index. beefweb sees *playlists* and *the filesystem*, and that is the whole surface. Two ways round it:

1. **An autoplaylist as a library mirror.** An autoplaylist is a live Media Library query; created with the query `ALL` it holds every track, updates itself, and appears in `/api/playlists` like any other playlist. It needs no components. Autoplaylists cannot be created through beefweb, so this is a setup step at the player, or a call to `foo_jean`.

   > **Do not use `Default Playlist` for this.** It is foobar's scratch buffer: selecting an album in the library view replaces its entire contents.

2. **The filesystem browser.** `/browser/entries` walks the disk, and `/playlists/{id}/items/add` takes file or directory paths. That is not the tagged library: paths and no metadata until items are in a playlist. Good for an "add folder" flow, bad as a browse model.

## The media library API

**foobar2000 only, and only on beefweb 0.11+.** On 0.10 every endpoint here is **404**. **`foo_jean` answers the library**, and these routes are what a fill, a queue or a tag write acts *through* once a row has been chosen. One read is the exception: `fetchLibraryNodes` asks `by-path` for a track's own folder to resolve that one track's columns, because nothing else here addresses a single track.

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
- **Items are not naturally ordered.** The spec says they are produced by applying search criteria, so paging without an explicit `sort` may not be stable across requests. Pass `sort=%path%`.
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

> **Omit both `items` and `query` to mean the whole library.**

> **The order of `items` is ignored.** A set arrives in the **media library's browse order**, meaning album artist, then album, then track, while `GET /library/items` pages by **file path**. The order cannot be predicted: no `sort` expression reproduces it.

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

**`contract/openapi.yaml` is that component's contract, and it is the reference for every route below the discovery record.** Jean's types are generated from it, its descriptions carry the reasoning a client needs, and nothing restated here could do anything but drift from it. `plugins/fb2k/ARCHITECTURE.md` is the design behind it. What follows is only the part that is Jean's.

| | |
|---|---|
| Base URL | `http://<player-host>:8881`, the **same host as beefweb**, a different port |
| CORS | genuinely cross-origin, so every authenticated call is preflighted |
| Owner's config | `<profile>/foo_jean/config.json`, which Jean never edits and has no route to. `plugins/fb2k/README.md` has the keys |

## Discovery, and why its answer cannot be trusted

This is the one part of the component's surface the spec does not describe, because beefweb serves it. The component writes `<profile>/beefweb/clientconfig/foo_jean.json` on every start, which beefweb answers at `GET /api/clientconfig/foo_jean`, same origin as Jean, so discovery is one request folded into connect, with no CORS and no port scanning.

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

> **The record is writable by anyone who can reach beefweb, so it is a hint and never a credential target.** A forged record can name any port, and a client that believed it would POST the user's bearer token to an attacker's listener. **The order in which a token may be attached is the security model**, and `ui/ARCHITECTURE.md` holds it; `discoverFooJean()` in `fooJean.ts` is the one implementation, and the states it resolves to are the union declared beside it.

## What Jean does about state

`GET /api/state` is the one route `domain/player/playerPoll.ts` asks, on a one-second interval with `If-None-Match`. Its two sections ride together: `library` carries the two generations covered next, in *What Jean does about the library*, and `player` carries what the player is doing right now. `contract/openapi.yaml`'s `State`, `Library` and `PlayerState` schemas are the reference; this is only the part that catches an unwary client.

- **`player.position` is a mark, not a moving number.** It carries `seconds`, the position at the moment the component last looked, and `ageSeconds`, how long ago that was. A client adds the two to place the mark and then keeps counting on its own while `player.playback` is `playing`, exactly as it already does with beefweb's `activeItem.position`.
- **`player` carries no `info` block.** The player's name and version do not change while it runs, so the poll does not repeat them; they come off a startup read of `GET /api/capabilities` instead, alongside the volume range (`volumeMin`, `volumeMax`, `volumeUnit`), the permissions (`canWritePlaylists`, `canChangeOutput`) and the list of playback modes this install can be put into.
- **`player.playbackMode` crosses the wire as Jean's own name**, one of `inOrder`, `repeatAll`, `repeatOne`, `random`, `shuffleTracks`, `shuffleAlbums` or `shuffleFolders`, mapped from whatever the player calls its own orders. `null` means the player is in an order this component has no name for, never a wrong one.

## What Jean does about the library

`GET /api/library/export?columns=…` answers the whole library in one binary body. `jlib.ts` decodes it and `fooJeanLibrary.ts` is the loop that asks for it. `contract/openapi.yaml`, *The media library*, is the format, the two generations and every status. Three things on this side:

- **Jean sends `TRACK_EXPRESSIONS`, one `columns` parameter per expression, never comma-separated**: a title-formatting expression may contain a comma.
- **`?`, `''` and `N/A` arrive exactly as the player produced them.** Nothing in the component parses, normalises or types a value, which is what keeps Jean's capability detection working. **Never coerce one to `null`**: `Number(null)` is `0` and every field would then read as available.
- **The header answers capability detection exactly**, so a field that resolves on one track in ten thousand is detected rather than missed by a sample. Detection is still a guess a Settings switch overrules.
- **A `{structure, revision}` pair compares for equality only, never for order.** `revision` counts within one `structure`, and `structure` itself resets when the component starts fresh, so a pair read after a restart can be lower than one already held without being older. `playlistStore.ts`'s `recheckMissed` holds the pair a poll answered while an entry was busy and, once idle, checks it against the one the entry landed on rather than trusting which sorts higher. A mismatch is worth a fresh, untagged `GET /api/state`: the route is `ETag`ged, so once the player settles every later poll answers `304`, and a generation seen mid-export would otherwise never surface again.

## What Jean does about the queue

`GET /api/queue` answers every entry in the player's own order plus the revision they were read at. `domain/player/queue.ts`'s `recheckQueue` only asks for it when `GET /api/state`'s `queueRevision` has moved from the one already cached, off the same one-second poll that already carries player state, so a client watching the queue costs nothing beyond the poll it already runs.

Queueing, moving, removing and clearing each send exactly one request: `POST /queue`, `POST /queue/move`, `DELETE /queue/{index}` and `DELETE /queue`. Every one is optimistic against the cached read and reconciled by the next poll rather than trusted outright; a write against a queue that has since moved answers `409`, and Jean takes no local guess at the true order in that case; the next poll's `recheckQueue` holds it. **The revision advances by exactly one per accepted mutation**, so a caller chaining several writes against one cached read can predict the next revision without a re-read between them; `dequeuePlaylist` in `domain/player/queue.ts` is built on that.

**A write that comes back failed rather than stale answers nothing about the player's own queue.** The response can go missing after the write already landed, LAN link or not, so a client cannot read a refusal as proof the queue is still where it was. `useQueue.ts`'s `settle` only rolls an optimistic patch back while the cache still holds the revision it was taken against; once that has moved, a poll has already caught up and rolling back would undo it.

**A queued entry plays whether or not it still carries a `location`.** `location` is `null` both for a library track queued by handle and for a playlist row whose position the player has lost, and measured against a real player both reach the head and play, `title`, `artist` and `duration` intact. Unlike beefweb's own queue, there is no garbage-column row to warn a person about.

## What Jean does about the stream

The component's clock, not beefweb's, is what a listener hears; the spec carries the arithmetic that turns one into the other, and `src/domain/player/CLAUDE.md` is what Jean builds on it.

> **The ticket travels in the query string and the bearer token never does.** An `<audio>` element sends no headers, so `GET /stream?ticket=…&format=…` is a capability URL bounded by a short lifetime. It grants nothing but the audio already playing. Clients MUST NOT store, log, or otherwise place a ticket where a bearer token would not go.

- `deviceId` is untrusted: it labels a row in somebody else's picker and nothing branches on it. Generate it at random, keep it, and never derive it from anything about the person.

## What Jean does about artwork

`libraryArtworkUrl()` and `playingArtworkUrl()` in `fooJean.ts` build the two client-side URLs; `GET /artwork` and `GET /artwork/playing` in the contract are the routes, and the contract's *Artwork* section is the reference for what each one answers. The status bar and the now-playing screen's centre cover read the playing route. The cover wheel's neighbouring slots and a queued playlist row read `libraryArtworkUrl()` too, by the row's own library path: nothing in `ui/src` builds beefweb's playlist-indexed address any more. The media session asks for neither: the OS fetches whatever address it is given itself and cannot carry a bearer token, so handing it either route would only earn a `401`.
