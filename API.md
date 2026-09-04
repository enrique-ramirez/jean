# The beefweb API

Reference for the HTTP API Jean talks to, verified against foobar2000 2.25.3 with the beefweb plugin. Where behaviour differs by plugin version it says so: **0.10** is the current release, **0.11** adds the media library API.

## Reaching it

| | |
|---|---|
| Base URL | `http://<player-host>:8880` |
| API prefix | `/api` |
| Auth | Basic, when `authRequired` is on. Off by default |
| From Jean | `/api/...`, root-relative, proxied by Vite in development |

`allowRemote` must be on for anything but localhost to connect.

**CORS is off by default.** No `Access-Control-Allow-Origin` comes back, so a page on another origin cannot call the API directly. Two ways round it: a same-origin dev proxy (what Jean does), or `responseHeaders` in the player's `config.json`.

Responses are gzipped when asked for: a 30,441-item playlist is 2.39 MB raw, 462 KB over the wire, in ~205 ms.

## Two ways to read state

### One-shot: `GET /api/query`

The composite read. Any combination in one request:

```
GET /api/query?player=true&playlists=true&playQueue=true&outputs=true
              &trcolumns=…      # columns for the active track
              &qcolumns=…       # columns for play queue items
              &plcolumns=…      # columns for playlist items
              &playlistItems=true&plref=p2&plrange=0:100
```

### Streaming: `GET /api/query/updates`

The same parameters, delivered as Server-Sent Events. Each message is a full `data:` payload of whatever you subscribed to.

**It is change-driven, not a ticker.** Messages arrive on track change, play/pause, volume and playlist switch — not on a timer, and `position` alone never triggers one. One message in eight seconds during uninterrupted playback is normal. So a progress display must interpolate locally (`src/domain/player/position.ts`), and a long silence is not a stall.

**`playlists` fires when the *set* of playlists changes, never when their contents do:**

| what happened | what arrived |
|---|---|
| playlist added, renamed or deleted | `playlists` |
| items copied in | **`player` only** |
| items removed | **`player` only** |

So `itemCount` in `PlaylistInfo` is stale from the first write onwards and nothing corrects it. Anything depending on it — how many rows to remove, whether a cached view still matches, a sidebar count — MUST re-read it. Trusting it emptied 99 rows out of a 113-row playlist, left 14 behind, appended after them, and played whatever had drifted into the row that was clicked.

**A one-item `playlistItems` window is a cheap tripwire.** Subscribing with `playlistItems=true&plref=…&plrange=0:1` pushes on *any* item change in that playlist, including appends past the window, because `totalCount` is part of the diff. ~939–994 bytes per change, nothing at all while idle. `plref` is singular, so it watches one playlist and changing it means reconnecting. Detection is nearly free; reacting is not, since items have no id and any change invalidates every index held. Treat a push as a signal to reconcile, not a reason to refetch.

## Shapes

### `player`

```jsonc
{
  "activeItem": {
    "columns": ["Everything Everything", "Duet"],  // requested columns, in order
    "duration": 225.61,          // seconds, float
    "index": 73,                 // index within the playlist, -1 when stopped
    "playlistId": "p2",
    "playlistIndex": 1,
    "position": 7.37             // seconds, at the moment this message was produced
  },
  "info": { "name": "foobar2000", "version": "2.25.3", "pluginVersion": "0.10" },
  "options": [                   // toggleable, settable via POST /player
    { "id": "playbackOrder", "type": "enum", "value": 4, "enumNames": [...] },
    { "id": "stopAfterCurrentTrack", "type": "bool", "value": false }
  ],
  "permissions": { "changePlaylists": true, "changeOutput": true, "changeClientConfig": true },
  "playbackMode": 4,
  "playbackModes": ["Default", "Repeat (playlist)", "Repeat (track)", "Random",
                    "Shuffle (tracks)", "Shuffle (albums)", "Shuffle (folders)"],
  "playbackState": "playing",    // "playing" | "paused" | "stopped"
  "volume": { "type": "db", "min": -100.0, "max": 0.0, "value": -4.0, "isMuted": false }
}
```

Volume is **decibels**, not a percentage, and `volume.type` says so — another player may report a linear range. A linear slider over `-100..0` feels wrong; map it.

The captured player also sends `info.title` and `options[].name`, which the summaries above omit.

### `playlists`

```jsonc
{ "playlists": [
  { "id": "p1", "index": 0, "isCurrent": false, "itemCount": 30441,
    "title": "Default Playlist", "totalTime": 0.0 }
]}
```

IDs are `p1`, `p2`, … and are stable while the player runs. They are **not contiguous** — creating one playlist produced `p7` where `p6` was free — and not in index order. `totalTime` reads `0.0`; do not rely on it.

**These six fields are the whole schema**, confirmed against both the live API and `docs/player-api.yml`. `GET /playlists/{id}` returns the same six. **There is no flag distinguishing an autoplaylist from an ordinary one.**

**Autoplaylists do not reject edits — they accept them and do nothing.** `POST /playlists/{src}/{dst}/items/copy` into an autoplaylist answers **204** and leaves `itemCount` unmoved, while the same request into an ordinary playlist answers 204 and moves the count. The status is identical either way, so there is no error to catch: the only way to know a copy landed is to read `itemCount` back and check it moved by exactly the number sent.

### `playlistItems`

`GET /api/playlists/{playlistId}/items/{range}?columns=…`, where range is `offset:count`.

```jsonc
{ "playlistItems": {
  "offset": 0,
  "totalCount": 375,
  "items": [ { "columns": ["5 Seconds of Summer", "Amnesia", "3:57"] } ]
}}
```

Items carry **no id** — only their position. Index is identity, so any mutation invalidates indices being held.

### Others

- `GET /api/playqueue?columns=…` → `{ "playQueue": [ { playlistId, playlistIndex, itemIndex, columns } ] }`. The parameter is `columns` here and `qcolumns` only on `/api/query`.
- `GET /api/outputs` → active output plus available types and devices, each with an opaque `id`. `supportsMultipleOutputTypes: false` on foobar2000.
- `GET /api/browser/roots` → `{ "pathSeparator": "\\", "roots": [ { "path": "C:\\Music", … } ] }`
- `GET /api/browser/entries?path=…` → `{ "entries": [ { "name", "path", "size", "timestamp", "type": "D"|"F" } ] }`
- `GET /api/artwork/current` and `/api/artwork/{playlistId}/{index}` → image bytes (`image/jpeg`, ~46 KB), or 404 when there is none.
- `GET|POST /api/clientconfig/{id}` → arbitrary server-side JSON blob storage. **`GET` answers `200` with a body of `null` for an id nobody has written**, not a 404. Ids are lowercase alphanumeric plus underscore; `foo-jean` is rejected with a 400. Nothing on this route is authenticated and `changeClientConfig` defaults to on.

## The play queue

The queue is finite, ordered and exhaustive: the player takes all of it, in order, before returning to the playlist. That is what makes it the one part of the player a client can describe exactly.

**The parameter is `columns` on `/api/playqueue` and `qcolumns` on `/api/query`.** Sending the wrong one is not an error — it answers 200 with `"columns": []` on every entry, which reaches a UI as blank rows rather than as a failure. `GET /api/player` does the same with `trcolumns`.

**The update stream pushes the queue, and pushes it alone.** Subscribing with `playQueue=true&qcolumns=…` delivers `data: {"playQueue":[…]}` on every queue change with no `player` object riding along, and carries the whole queue every time. Nothing arrives while the queue is untouched.

**An entry holds a track handle, not a position.** Removing a playlist row *above* a queued one renumbers the `itemIndex` that comes back, so the queue survives edits to the playlist under it and a client reconciles nothing.

**Removing the queued track itself leaves the entry behind, reporting `itemIndex: -1`.** Its `columns` are *not* empty — they hold whatever is in the freed slot; one probe came back titled `NEIN`. **Test `itemIndex < 0`; never infer an orphan from its columns.**

**A queued track leaves the queue the moment it starts**, so the queue is only ever what is still to come and what is playing is never in it. It also outranks playback order: with tracks queued, `POST /player/next` plays the head of the queue rather than the next row.

| Operation | Endpoint | Body | Notes |
|---|---|---|---|
| Read | `GET /playqueue` | — | `columns`, not `qcolumns` |
| Add | `POST /playqueue/add` | `{ plref, itemIndex }` | one item per request |
| Remove | `POST /playqueue/remove` | `{ queueIndex }` **or** `{ plref, itemIndex }` | |
| Clear | `POST /playqueue/clear` | — | |

- **`queueIndex` on *add* is accepted and silently ignored on foobar2000.** `{ plref, itemIndex: 5, queueIndex: 0 }` answers **204** and appends anyway. It is not a 400, so **there is nothing to feature-detect it with**. There is no insert-at-position and no cheap "play next": both are a remove-and-re-append of the queue's tail.
- **`queueIndex` on *remove* does work**, and is exact.
- **No bulk form on either.** `{ plref, items: [1,2,3] }` on add is `400 parameter is required: itemIndex`; `{ items: [0,1] }` on remove is `400 either queueIndex or plref plus itemIndex parameters are required`. That rules the queue out as a way to express "play this set of tracks" — a playlist is the only mechanism the API has for it.
- **Duplicates are allowed.** The same `(plref, itemIndex)` queued twice gives two entries.
- **Cost**: ~34 ms per call over a LAN, sequential. 20 adds took 681 ms, 20 removes 618 ms. Order is preserved when issued one after another.

> ### Deleting a playlist the queue points into crashes the player
>
> This is the most expensive thing in this document. It takes foobar2000 down until it is restarted by hand:
>
> ```
> Access violation, operation: read, address: 0000000000000000h
> Call path: app_mainloop=>main_thread_callback::callback_run
> Crash location:  Module: foo_beefweb   Offset: 16B7Dh
> ```
>
> The sequence: queue two items out of a playlist, remove one of the queued *tracks* from that playlist (leaving the `itemIndex: -1` orphan), then `POST /playlists/remove/{id}`. The player restarted itself and hung before beefweb loaded.
>
> Whether a *plain* queued entry is enough, or whether the orphan is required, is not narrowed — narrowing it means crashing the player again. **Treat both as fatal.**
>
> **So: clear a playlist's queue entries before deleting it, and abandon the delete if they will not clear.** `dequeuePlaylist` in `src/domain/player/queue.ts` does this, from `usePlaylistActions` so no caller can forget. Emptying a playlist with `/clear` is not implicated.

## Columns and title formatting

`columns` / `trcolumns` / `qcolumns` / `plcolumns` take **foobar2000 title-formatting expressions**, evaluated by the player and returned as a positional array in the order requested. This is the richest part of the API: the player computes, so the reachable surface is far wider than beefweb's own schema.

| Expression | Result |
|---|---|
| `%artist%` / `%title%` / `%album%` / `%album artist%` | as expected |
| `%bitrate%` / `%samplerate%` / `%channels%` | `320` / `44100` / `stereo` |
| `%filesize_natural%` | `13.6 MB` |
| `%directoryname%` | `(2015) Born in the Echoes` |
| `%path%` | absolute and platform-separated |
| `%rating%` | `5` |
| `%lastfm_play_count%` | from `foo_enhanced_playcount`. `0`, not `?`, when unplayed |
| `%lastfm_last_played%` / `%lastfm_first_played%` | `2025-12-16 14:21:38`, or `N/A` when never played |
| `$meta(rating)` | a file tag, unlike the last.fm fields |
| `$meta(unsynced lyrics)` | LRC-timestamped lyrics. **Tag name has a space** |
| `$upper(%artist%)`, `$abbr(%album%)`, `%album artist% - %title%` | functions and concatenation work |

**An unresolved field returns `?`, not an error. A field that resolves but is empty returns `''`, `0` or `N/A`.** That difference is the capability probe the whole feature detection rests on. **`$meta(x)` cannot be feature-detected**: it answers `''` for a field that does not exist where `%x%` answers `?`.

Coverage on one real 30,441-track install, as an indication of what varies rather than a rule — detect, never assume:

- Resolve everywhere: `%samplerate%`, `%channels%`, `%genre%`, `%year%`, `%album artist%`, `%publisher%`, `%length_seconds%`, `%codec%`, `%bitrate%`, `%lastfm_play_count%`.
- Resolve on a minority: `%date%` 99.7%, `%totaldiscs%` 90.4%, `%codec_profile%` 82.6%, `%composer%` 25.0%, `%replaygain_track_gain%` 4.1%, `%bpm%` 0.9%.
- Never resolve: `%added%`, `%play_count%`, `%last_played%`, `%totaltracks%`, `%bitspersample%`, `%popm%`, `%rating wmp%`, `%isrc%`, `%barcode%`, `%catalognumber%`, `%label%`, `%media%`, `%mood%`, `%style%`, `%key%`, `%language%`, the MusicBrainz ids.
- **Sparse fields defeat sampling.** Ratings answered on 500 of 30,441 tracks, so a 200-row capability sample misses them entirely about one library in twenty-five. Where a field is this sparse, detect per track or not at all.

Traps in this area, each of which has cost time:

> **The column list is split on commas *before* the expressions are evaluated**, so **any title-format function taking more than one argument is unusable** — `$if(%album artist%,yes,no)` arrives as three separate columns. Quoting does not help; foobar's `''` escaping happens too late. Repeating the parameter (`&trcolumns=a&trcolumns=b`) honours only the first.
>
> So: single fields, concatenation, and single-argument functions only. Anything conditional is computed client-side.
>
> **Single-argument functions do nest**: `$len($meta(unsynced lyrics))` works. The limitation is on *arguments*, not composition — useful for asking about a large field without downloading it.

> **`%date%` is an ordinary messy user tag, not a date-added field.** Over 30,441 tracks it resolved on 30,347: 26,891 year-only (`2010`), 3,022 full ISO dates (`1992-10-13`), 434 untidy (`1997, 1997-02-10`, `2011-00`, `2010-09-28T07:00:00Z`). Sort and group by `%year%`, which is clean and integer-shaped; parse `%date%` leniently, only where a real release date is worth having.

> **`%last_modified%` is not a date-added field.** Playback can rewrite tags, which bumps the file's mtime: the mtime moves ~55 s before the scrobble lands, and 21% of played tracks have an mtime within ten minutes of their last play. It is `max(added, last played or retagged)`, wrong precisely at the recent end where a "recently added" view would look. There is no working date-added field at any price.

> **There is no play *history*, only a last play.** `%lastfm_play_count%` is a lifetime total and `%lastfm_last_played%` is the most recent play and nothing else, so a track played today and again three weeks ago reports only today. Any per-day or per-week chart built on it undercounts every older bucket and slopes upward whatever the listening did; any "vs. last month" delta compares a full window against a decayed one. A window can honestly report how many *distinct tracks* were touched since a date, and must say so in those words.

> **Lyrics need no component.** `$meta(unsynced lyrics)` — with a space — returns LRC-timestamped lyrics from an ordinary tag. `%lyrics%` returns `?` and `$meta(unsyncedlyrics)` finds nothing. `foo_openlyrics` is what *writes* it.
>
> Over 30,441 tracks, 7,705 (25.3%) carry the tag, and of a random 150 of those, 51 (34%) hold LRC timestamps — so followable lyrics are ~8.6% of a library and the tag is plain text more often than not. Median ~1 KB, longest 8.5 KB, which is why it is fetched per track and MUST never go in `trcolumns` on the update stream. Real content includes several timestamps on one line (`[00:18.50][01:02.10]…`), NetEase credit lines (`[00:00.00]作词 : …`), and tags holding nothing but a URL.

## Every endpoint

38 in total, from `docs/player-api.yml`.

**Player** — `GET|POST /player` · `POST /player/play` · `/player/play/{playlistId}/{index}` · `/player/play/random` · `/player/next` · `/player/previous` · `/player/stop` · `/player/pause` · `/player/pause/toggle` · `/player/play-pause` · `/player/volume/up` · `/player/volume/down`. `next` and `previous` accept a `by` expression, so "next album" is possible.

**Playlists** — `GET|POST /playlists` · `/playlists/add` · `/playlists/remove/{id}` · `/playlists/move/{id}/{index}` · `GET|POST /playlists/{id}` · `GET /playlists/{id}/items/{range}` · `/playlists/{id}/clear` · `/playlists/{id}/items/add` · `/playlists/{id}/items/remove` · `/playlists/{id}/items/copy` · `/playlists/{src}/{dst}/items/copy` · `/playlists/{id}/items/move` · `/playlists/{src}/{dst}/items/move` · `/playlists/{id}/items/sort`

**Play queue** — `GET /playqueue` · `/playqueue/add` · `/playqueue/remove` · `/playqueue/clear`

**Outputs** — `GET /outputs` · `POST /outputs/active`

**Query** — `GET /query` · `GET /query/updates`

**Browser** — `GET /browser/roots` · `GET /browser/entries`

**Artwork** — `GET /artwork/current` · `GET /artwork/{playlistId}/{index}`

**Client config** — `GET|POST /clientconfig/{id}` · `POST /clientconfig/remove/{id}`

## Changing things

| Operation | Endpoint | Body |
|---|---|---|
| Seek | `POST /player` | `{ position }` or `{ relativePosition }` (seconds) |
| Volume / mute | `POST /player` | `{ volume }`, `{ relativeVolume }`, `{ isMuted }` |
| Playback order | `POST /player` | `{ options: [{ id: 'playbackOrder', value }] }` |
| Remove items | `POST /playlists/{id}/items/remove` | `{ items: [indices] }` |
| Copy / move items | `POST /playlists/{src}/{dst}/items/copy` \| `move` | `{ items: [indices], targetIndex }` |
| Reorder within a playlist | `POST /playlists/{id}/items/move` | `{ items: [indices], targetIndex }` |
| Sort a playlist | `POST /playlists/{id}/items/sort` | `{ by: "expression", desc, random }` |
| Rename a playlist | `POST /playlists/{id}` | `{ title }` |
| Reorder a playlist | `POST /playlists/move/{id}/{index}` | none — both in the path |
| Delete a playlist | `POST /playlists/remove/{id}` | none |
| Add files or folders | `POST /playlists/{id}/items/add` | `{ items: [paths], index, replace, play, async }` |
| Queue an item | `POST /playqueue/add` | `{ plref, itemIndex }` |

Facts that cost time to rediscover:

- **Playback order applies to the active playlist, and playing a track sets it.** `POST /player/play/p5/3` makes `p5` current, and `Shuffle (tracks)` then draws only from `p5`. So confining playback to a set of tracks means getting those tracks into a playlist; there is no selection concept to shuffle within.
- **Emptying or deleting the playing playlist does not stop playback.** The current track keeps playing but is orphaned — `activeItem.playlistId` goes to `""` and `index` to `-1`. Emptying is harmless if a play follows immediately. Deleting is not: at the end of the track the player falls back to another playlist and carries on.
- **A skip pushes an empty `activeItem` before it pushes the next track**, and goes on reporting `playbackState: "playing"` across the gap. Every field is cleared at once — `{"columns":[],"duration":0.0,"index":-1,"playlistId":"","playlistIndex":-1,"position":0.0}` — so a client that draws each field as it arrives shows no cover, no title, `0:00`, and no playing-from context, all for the width of the gap. Measured at **90 ms and 240 ms** over two skips on a wired LAN against 2.25.3, and visibly longer over Wi-Fi.

  Three things make it a trap. It is **only manual skips**: a track ending on its own hands over in a single push with nothing in between, which is why the flash looks intermittent. It is **not the stopped item** — that one reports `duration` and `position` as `-1`, so the two are distinguishable, and `playbackState` separates them outright. And **emptiness has to be read off `columns`, not off `index`**, because the orphan above is a lasting `index: -1` behind a track that is still audible and still has fields worth drawing. `holdThroughGap` in `src/domain/player/usePlayer.ts` holds the last item, with its `syncedAt`, until the next real one lands.
- **Renaming a playlist while it is playing is seamless** — same track, same position, uninterrupted. That turns "save these results as a playlist" into a rename rather than a copy.
- **`items/copy` is fast enough to build playlists on demand**: 500 indices in 17 ms, 5,000 in 33 ms, 20,000 in 166 ms. Emptying and refilling round-trips in ~47 ms.
- **`items/sort` takes a title-format expression**, so it inherits the comma limitation. Concatenation works: `%album artist%%album%%tracknumber%`. Sorting is whole-playlist and destructive; there is no sort-a-selection and no view-level sort.
- **`/playlists/move/{id}/{index}` takes a negative index to mean "last"**, so appending needs no count.
- **Rename is `POST /playlists/{id}`, not a `rename` route.** `UpdatePlaylistRequest` has exactly one field, `title`, and it is nullable.
- **`playbackMode` on `POST /player` is deprecated.** Use the `options` array.
- **There is no tag-writing endpoint.** All 27 POST routes are playback, playlists, queue, outputs and clientconfig. Ratings and lyrics can be *read* through title formatting and cannot be written back through beefweb at all.
- **There is no way to reach another component.** `/api/commands`, `/api/command`, `/api/mainmenu`, `/api/contextmenu`, `/api/plugins`, `/api/components` all 404.
- **The static server has no SPA fallback.** `/playlists/p2` is a 404, which is why Jean routes on the hash.

## The library on beefweb 0.10

**There is no library API.** No `/library`, no `/search`, nothing touching foobar2000's Media Library index. beefweb sees *playlists* and *the filesystem*, and that is the whole surface. Four ways around it:

1. **An autoplaylist as a library mirror — the answer.** An autoplaylist is a live Media Library query; created with the query `ALL` it holds every track, updates itself, and appears in `/api/playlists` like any other playlist. It needs no components. Autoplaylists cannot be *created* remotely, so this is a one-time setup step at the player.

   Loading a 30,441-track playlist whole costs ~0.85 MB gzipped (6.4 MB raw), ~430 ms to fetch and ~40 ms to parse at 10 columns, after which client-side filtering is an array operation.

   > **Do not use `Default Playlist` for this.** It is foobar's scratch buffer: selecting an album in the library view replaces its entire contents, and it went from 30,441 items to 12 within an hour of ordinary use.

2. **The filesystem browser.** `/browser/entries` walks the disk. That is not the tagged library — you get paths and no metadata until items are in a playlist. Good for an "add folder" flow, bad as a browse model.
3. **Playlists created inside foobar.** Autoplaylists and `#Quicksearch […]` results appear in `/api/playlists` like any other. Readable remotely, not creatable remotely.
4. **Add by path.** `/playlists/{id}/items/add` takes file or directory paths, so playlists can be built from anything on disk without the library.

## The media library API

**foobar2000 only, and only on beefweb 0.11+.** On DeaDBeeF every endpoint here is **501**; on 0.10 they are **404**. Treat both the same way: no library API, fall back to the autoplaylist.

### `GET /library/info`

```jsonc
{ "library": { "supported": true, "enabled": true, "itemCount": 30441 } }
```

~8 ms, and the only one of these that answers without the API. `itemCount` agrees with the `ALL` autoplaylist to the track. **`enabled: false` means foobar2000 has no Media Library configured** — a different problem from "this player has no library API", fixed in foobar's own preferences rather than in a client. The two MUST NOT collapse into one state.

### `GET /library/items`

`columns` is **required**. `range` is a **query parameter** in `offset:count` form, not a path segment; all items if omitted. Optional besides: `query` (the *player's* query syntax), `sort` (a title-format expression, defaulting to file path), `desc`.

```jsonc
{ "libraryItems": {
  "offset": 0,
  "totalCount": 30441,
  "items": [ {
    "path": "#/2 Mello/(2012) Chrono Jigga/01. Intro.mp3",
    "subsong": 0,
    "columns": ["2 Mello", "Intro"]
  } ]
}}
```

**Paths are relative to the media library folders**, not absolute, and keep their folder structure. **A track is `(path, subsong)`** — subsong is non-zero for cue sheets and disc images, so it is not decoration.

**Items are not naturally ordered.** The spec says they are produced by applying search criteria, so paging without an explicit `sort` may not be stable across requests. Pass `sort=%path%` — it returns byte-identical lists to no sort over 30,441 tracks, and stating it makes the expression a filled playlist is sorted by demonstrably the same one the rows are in. See `LIBRARY_SORT` in `src/shared/api/beefweb.ts`.

**There is no caching, and it is measurable.** Every call enumerates the library and computes a relative path per item: **104 ms fixed per call plus 26 µs per item** at 30,441 tracks, serialised on the player so concurrent requests do not overlap. One request for everything beats sixteen chunks by 1.8 s.

### `GET /library/items/by-path`

One level of the tree: folders first, each with a recursive `itemCount`, then tracks with the requested columns.

```jsonc
{ "libraryNodes": {
  "offset": 0, "totalCount": 27,
  "path": "#/2 Mello", "parentPath": "#",   // parentPath absent at the top level
  "items": [ { "type": "D", "name": "A", "path": "A", "itemCount": 2147 },
             { "type": "F", "name": "01. Intro.mp3",
               "path": "#/2 Mello/(2012) Chrono Jigga/01. Intro.mp3",
               "subsong": 0, "columns": ["Intro"] } ]
}}
```

Folder nodes carry `itemCount` and no columns; track nodes carry `subsong` and `columns` and no `itemCount`. Keys are `items`, `offset`, `path`, `totalCount`, plus `parentPath` below the top level — **there is no `pathSeparator` field**, whatever the PR description says.

**Library paths are `/`-separated regardless of platform**, and relative to the media library folders, even on Windows where `pathSeparator` from `/browser/roots` is `\`. Do not build them with `pathSeparator`.

**The player and the library disagree about what a path is.** `activeItem`'s `%path%` is absolute and platform-separated (`C:\Music\Artist\Album\01 Track.mp3`); a library item's is relative and forward-slashed (`Artist/Album/01 Track.mp3`). Nothing tells a client where the library folders are, so the two are matched by **suffix** after normalising separators — a relative path is unique within the library, so it cannot collide. `libraryPathMatcher()` in `src/shared/api/beefweb.ts`.

**Ordering is a byte-wise case-sensitive compare**, so `Zappa` sorts before `abba`. Re-sort client-side. Cost is 32–175 ms per level; 27 folders at the top level of a 30,441-track library.

### `GET /artwork/library?path=&subsong=`

Artwork without a playlist, which is the constraint it removes: everywhere else artwork is addressed by *playlist index*. A folder prefers its own image file (`folder`/`cover`/`front`/`album`/`artwork`) and falls back to the first track's.

**Folder artwork probes the filesystem on the player's work queue**, and a folder-thumbnail grid multiplies it. Do not build an album grid on it.

### `POST /playlists/{playlistId}/items/add-from-library`

`{ items: [{path, subsong}] | query, index, replace, play }`. Requires `changePlaylists`. Omitting both `items` and `query` adds the entire library.

**`replace: true, play: true` is a whole scratch-playlist rebuild in one request** — no rename, no remove-by-range, no copy, no separate play, and so no client-side count arithmetic to get wrong.

> **A request body over 1 MiB is refused by hanging up**, not answered with a status. 1,018,757 bytes accepted; 1,049,652 bytes closed the connection mid-upload, which reaches the client as a network error. Naming all 30,441 tracks is a 2.9 MB body, so "play everything" never reaches the player at all.
>
> Chunk well under it, because the cost is per *item* anyway — the player resolves each path against the library at ~1.2 ms, so 8,000 items take 10.2 s and going wide buys nothing. Better still, **omit `items` and `query` entirely to mean the whole library**: one request, no body, **299 ms** for all 30,441.

> **The order of `items` is ignored.** A set arrives in the **media library's browse order** — album artist, then album, then track — while `GET /library/items` pages by **file path**. Of 100 tracks sent in path order 10 landed elsewhere; of 1,000, 426; of 8,000, 3,945; over the whole library, 15,539.
>
> The order cannot be predicted: no `sort` expression reproduces it (`%album artist%` matches 9 positions out of 30,441, the path default 14,902). Learning it by reading the filled playlist back costs 3.2 MB and 680 ms at 30k (~21 MB at 200k), with nothing to invalidate it against, since the player publishes no library-change event.
>
> **So overwrite it instead of predicting it**: fill, then `POST items/sort` with the same expression the library was read with. Every position correct at 100, 1,000, 4,000 and all 30,441 tracks, for ~340 ms of server-side work and no client state.

> **Matching `items` against the media library is unreliable and unresolved.** `{items: [{path, subsong}]}` has been observed to answer 204 and add **zero** tracks to a fresh playlist, for paths taken straight from `GET /library/items?columns=%path%` — with `subsong` omitted, with `replace: true`, with a `file://` scheme and with forward slashes alike. The body *is* parsed: an unrecognised key falls through to "neither items nor query" and adds the whole library, and `{query: "…"}` works. `POST /playlists/{id}/items/add` with the same plain path also works. Shelf playback, library→playlist adds and queueing a library row all go through this endpoint, so **re-measure before relying on `items`.**

> **Do not mix the two filters.** `query` is the player's own syntax; a client-side search is not. They do not return the same set, so filtering client-side and then adding server-side by `query` adds tracks that are not the ones on screen. Address adds by explicit `items`.

### What it does not give you

- **No playback without a playlist.** There is no "play this library item"; you add to a playlist with `play: true`.
- **No library change events.** There is no `library` key for `/api/query`, so library changes cannot be observed. Detecting drift means polling `itemCount` from `/library/info` — three fields, cheap.
- **No autoplaylist creation.** Still impossible remotely.

## Reaching other foobar2000 components

beefweb does not proxy other components and has no "run this command" endpoint. Three real routes, in descending order of how well they work:

1. **Title formatting — the genuine escape hatch.** Any component publishing fields or functions to the title-formatting engine becomes readable through `columns`. Install a playback-statistics component and `%play_count%` / `%last_played%` start returning values instead of `?`. Subject to the comma limitation above.
2. **Sort by expression.** `POST /playlists/{id}/items/sort` plus copy-between-playlists is enough to generate derived playlists server-side without pulling data down first.
3. **The command line, on the player's own machine.** foobar2000's executable takes `/command:"<main menu command>"`, `/playlist_command:` and `/playing_command:`; `foo_runcmd` adds a `/runcmd=` family. This reaches anything on foobar's menus that the API cannot, and sidesteps the API entirely. Untested here.

**Out of reach:** creating autoplaylists, driving the Converter or Masstagger, searching the media library on 0.10, and reading component UI state.

## The beefweb repository

`https://github.com/hyperblast/beefweb`

| Path | What's in it |
|---|---|
| `docs/player-api.yml` | **The OpenAPI spec — the authority.** Request bodies, parameters, response schemas |
| `docs/advanced-config.md` | `config.json` options: `webRoot`, `urlMappings`, `responseHeaders`, auth. **Read the tag matching your plugin version, not `master`** — `altWebRoot` and relative `urlMappings` paths are on `master` and absent from 0.10, where a relative path silently 404s |
| `js/api_tests/` | Integration tests. The fastest way to find the exact body shape for a mutation |
| `js/client/` | Official JS client. **Not published to npm** (`private: true`) — read it, do not depend on it |
| `js/webui/` | Source of the stock UI. Useful for how it handles playlist paging |
| `cpp/` | The plugin itself |

Render the spec rather than reading raw YAML:

```sh
npx @redocly/cli preview-docs \
  https://raw.githubusercontent.com/hyperblast/beefweb/master/docs/player-api.yml
```
