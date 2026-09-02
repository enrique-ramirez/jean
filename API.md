# The beefweb API

Notes on the HTTP API this UI talks to, written against the live instance
(foobar2000 2.25.3, beefweb plugin 0.10) on `home.local`. Everything marked
*measured* was verified against that box rather than taken from documentation.

## Reaching it

| | |
|---|---|
| Base URL | `http://home.local:8880` (`10.100.100.20`) |
| API prefix | `/api` |
| Auth | none — `authRequired` is off |
| From this project | `/api/...`, proxied by Vite in dev (see README) |

`allowRemote` must be on for anything other than localhost to connect; it is.

**CORS is off by default.** No `Access-Control-Allow-Origin` comes back, so a page
served from another origin cannot call the API directly. Two ways round it: a
same-origin dev proxy (what this project does), or adding the header on the player
side via `responseHeaders` in `config.json`.

Responses are gzipped when asked for — *measured*: a 30,441-item playlist is 2.39 MB
raw, 462 KB over the wire, in ~205 ms.

## Two ways to read state

### One-shot: `GET /api/query`

The composite read. Ask for any combination in one request:

```
GET /api/query?player=true&playlists=true&playQueue=true&outputs=true
              &trcolumns=…      # columns for the active track
              &qcolumns=…       # columns for play queue items
              &plcolumns=…      # columns for playlist items
              &playlistItems=true&plref=p2&plrange=0:100
```

> **Gotcha (*measured*):** `GET /api/player` accepts `trcolumns` but ignores it and
> returns `"columns": []`. Use `/api/query?player=true&trcolumns=…` for a snapshot
> with metadata.

### Streaming: `GET /api/query/updates`

Same parameters, delivered as Server-Sent Events. Each message is a full `data:`
payload of whatever you subscribed to.

**It is change-driven, not a ticker.** *Measured*: one message in eight seconds
during uninterrupted playback. Messages arrive on track change, play/pause, volume,
playlist switch — not on a timer, and `position` alone does not trigger one.

Consequences: a progress display has to interpolate locally from the last message
(see `src/domain/player/position.ts`), and a long silence is normal, not a stall.

**`playlists` fires when the *set* of playlists changes -- not when their contents
do.** *Measured* against the live player, subscribing to `player=true&playlists=true`
and mutating in turn, with four-second waits:

| what happened | what arrived |
|---|---|
| playlist added | `playlists` |
| playlist renamed | `playlists` |
| playlist deleted | `playlists` |
| 5 items copied in | **`player` only** |
| 2 items removed | **`player` only** |

So `itemCount` in `PlaylistInfo` is stale from the first write onwards, and nothing
will correct it. Anything that depends on it -- how many rows to remove, whether a
cached view still matches, a sidebar count -- has to re-read it rather than trust
what arrived on the stream. Trusting it once emptied 99 rows out of a 113-row
playlist, left 14 behind, appended the new contents after them, and played whatever
had drifted into the row that was clicked.

**A one-item `playlistItems` window is a cheap tripwire.** Subscribing with
`playlistItems=true&plref=…&plrange=0:1` pushes on *any* item change in that
playlist, including appends past the end of the window, because `totalCount` is part
of the diff. *Measured*: ~939-994 bytes per change, most of it the `player` object
that was coming anyway, and nothing at all across six idle seconds. `plref` is
singular, so it watches one playlist -- changing it means reconnecting.

Detection is therefore nearly free. Reacting is not: items have no id, so any change
invalidates every index being held, and for the library that means re-reading a
megabyte. Treat a push as a signal to reconcile, not as a reason to refetch.

## Shapes

### `player`

```jsonc
{
  "activeItem": {
    "columns": ["Everything Everything", "Duet"],  // your requested columns, in order
    "duration": 225.61,          // seconds, float
    "index": 73,                 // index within the playlist, -1 when stopped
    "playlistId": "p2",
    "playlistIndex": 1,
    "position": 7.37             // seconds at the moment this message was produced
  },
  "info": { "name": "foobar2000", "version": "2.25.3", "pluginVersion": "0.10" },
  "options": [                   // toggleable player options, settable via POST /player
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

Note volume is **decibels**, not a percentage — `-100..0`. A linear slider over that
range will feel wrong; map it.

### `playlists`

```jsonc
{ "playlists": [
  { "id": "p1", "index": 0, "isCurrent": false, "itemCount": 30441,
    "title": "Default Playlist", "totalTime": 0.0 }
]}
```

IDs are `p1`, `p2`, … and are stable while the player runs. They are **not
contiguous** — creating one playlist produced `p7` where `p6` was free. `totalTime`
reads 0.0 here; don't rely on it.

**These six fields are the whole schema** — confirmed against both the live API and
`docs/player-api.yml`. There is **no flag distinguishing an autoplaylist from an
ordinary one**, and `GET /playlists/{id}` returns the same six.

**Autoplaylists do not reject edits — they accept them and do nothing.** *Measured*
against foobar2000 2.25.3 / beefweb 0.11: `POST /playlists/p2/p7/items/copy` into an
autoplaylist answered **`204 No Content`** and left `itemCount` at 30,441, while the
same request into an ordinary playlist answered 204 and moved the count from 4 to 5.
An earlier note here said they "reject
edits", which is what makes this worth stating twice: the status code is identical
in both directions, so **there is no error to catch and no flag to read** — the only
way to know a copy landed is to read `itemCount` back and check it moved by exactly
the number sent. `useAddTracks` does, and everything that writes into a playlist a
user picked has to.

### `playlistItems`

`GET /api/playlists/{playlistId}/items/{range}?columns=…` where range is
`offset:count`.

```jsonc
{ "playlistItems": {
  "offset": 0,
  "totalCount": 375,
  "items": [ { "columns": ["5 Seconds of Summer", "Amnesia", "3:57"] } ]
}}
```

Items carry **no id** — only their position. Index is the identity, which means any
mutation invalidates indices you were holding.

### Others

- `GET /api/playqueue?columns=…` → `{ "playQueue": [ { playlistId, playlistIndex,
  itemIndex, columns } ] }`. See the play queue section below — the parameter is
  `columns` here, and `qcolumns` only on `/api/query`.
- `GET /api/outputs` → active output plus available types/devices, each with an opaque
  `id`. *Measured*: `supportsMultipleOutputTypes: false` on foobar2000.
- `GET /api/browser/roots` → `{ "pathSeparator": "\\", "roots": [ { "path": "F:\\Musica", … } ] }`
- `GET /api/browser/entries?path=…` → `{ "entries": [ { "name", "path", "size", "timestamp", "type": "D"|"F" } ] }`
- `GET /api/artwork/current` and `/api/artwork/{playlistId}/{index}` → image bytes
  (*measured*: `image/jpeg`, 46 KB), or 404 when there is none.
- `GET|POST /api/clientconfig/{id}` → arbitrary JSON blob storage, server-side. Useful
  for making this UI's own settings follow the user between devices instead of living
  in `localStorage`.

## The play queue

*Measured* against foobar2000 2.25.3 with beefweb `0.11~git.dc0fdfc`. This is the
one part of the player a client can describe **exactly**, because the queue is
finite, ordered and exhaustive — the player takes all of it, in order, before it
goes back to the playlist.

**The parameter is named `columns` on `/api/playqueue` and `qcolumns` on
`/api/query`.** Sending `qcolumns` to the former is not an error: it answers 200
with `"columns": []` on every entry, exactly as `GET /api/player` does with
`trcolumns`. Two endpoints, two spellings, both silent about the wrong one.

**The update stream pushes it, and pushes it alone.** Subscribing with
`playQueue=true&qcolumns=…` delivers `data: {"playQueue":[…]}` on every queue
change with **no `player` object riding along** — unlike `playlists`, which only
fires when the *set* of playlists changes, this carries the whole queue every
time and is complete. Nothing at all arrives while the queue is untouched.

**An entry is `(playlistId, playlistIndex, itemIndex, columns)` and holds a track
handle, not a position.** Removing a playlist row *above* a queued one renumbers
the `itemIndex` that comes back — queue entries at 3 and 4 reported 2 and 3 after
row 0 was removed, same titles. So the queue survives edits to the playlist under
it, and a client does not have to reconcile anything.

**Removing the queued track itself leaves the entry behind, reporting
`itemIndex: -1`.** Its `columns` are *not* empty — they hold whatever is in the
freed slot, and one probe came back titled `NEIN`. **Test `itemIndex < 0`; never
infer an orphan from its columns.**

**A queued track leaves the queue the moment it starts.** So the queue is only
ever what is still to come, and what is playing is never in it. It also outranks
playback order: with three tracks queued, `POST /player/next` played the head of
the queue rather than the next row, twice running.

| Operation | Endpoint | Body | Notes |
|---|---|---|---|
| Read | `GET /playqueue` | — | `columns`, not `qcolumns` |
| Add | `POST /playqueue/add` | `{ plref, itemIndex }` | one item per request |
| Remove | `POST /playqueue/remove` | `{ queueIndex }` **or** `{ plref, itemIndex }` | |
| Clear | `POST /playqueue/clear` | — | |

- **`queueIndex` on *add* is accepted and silently ignored on foobar2000.**
  *Measured*: `{ plref, itemIndex: 5, queueIndex: 0 }` answered **204** and
  appended to the end anyway. It is not a 400, so **there is nothing to
  feature-detect it with** — a client cannot discover that its insert did not
  happen. There is therefore no insert-at-position and no cheap "play next": both
  are a remove-and-re-append of the queue's tail.
- **`queueIndex` on *remove* does work**, and is exact — removing index 1 of three
  took that entry and left the others. This is not in the `queueIndex is
  DeaDBeeF-only` caveat, which applies to `add`.
- **No bulk form on either.** `{ plref, items: [1,2,3] }` on add is
  `400 parameter is required: itemIndex`; `{ items: [0,1] }` on remove is
  `400 either queueIndex or plref plus itemIndex parameters are required`.
- **Duplicates are allowed** — the same `(plref, itemIndex)` queued twice gives two
  entries.
- **Cost**: ~34 ms per call over the LAN, sequential. 20 adds took 681 ms, 20
  removes 618 ms. Order is preserved when they are issued one after another.

> ### Deleting a playlist the queue points into crashes the player
>
> **This is the most expensive thing in this document.** *Measured*, and it took
> foobar2000 down for good until it was restarted by hand:
>
> ```
> Access violation, operation: read, address: 0000000000000000h
> Call path: app_mainloop=>main_thread_callback::callback_run
> Crash location:  Module: foo_beefweb   Offset: 16B7Dh
> ```
>
> The sequence was: queue two items out of a playlist, remove one of the queued
> *tracks* from that playlist (leaving the `itemIndex: -1` orphan described
> above), then `POST /playlists/remove/{id}`. The player restarted itself and hung
> before beefweb loaded — nothing listening on 8880, no main window, 0.03 s of CPU
> over five minutes.
>
> Whether a *plain* queued entry is enough, or whether the orphan is required, has
> **not** been narrowed — doing so means crashing the player again. Treat both as
> fatal.
>
> **So: clear a playlist's queue entries before deleting it, and abandon the
> delete if they will not clear.** `dequeuePlaylist` in
> `src/domain/player/queue.ts` does this, and it sits in `usePlaylistActions`
> rather than in the sidebar so that no future caller can forget. Emptying a
> playlist with `/clear` is not implicated and is what Jean's holding playlist uses.

## Columns and title formatting

`columns` / `trcolumns` / `qcolumns` / `plcolumns` take **foobar2000 title-formatting
expressions**, evaluated by the player. Results come back as a positional array in the
order requested. This is the richest part of the API — the player computes, so you are
not limited to fields beefweb knows about.

*Measured* on this box:

| Expression | Result |
|---|---|
| `%artist%` / `%title%` / `%album%` | as expected |
| `%album artist%` | `The Chemical Brothers` |
| `%bitrate%` / `%samplerate%` / `%channels%` | `320` / `44100` / `stereo` |
| `%filesize_natural%` | `13.6 MB` |
| `%directoryname%` | `(2015) Born in the Echoes` |
| `%path%` | `F:\Musica\#\1975, The\…\10. Robbers.mp3` |
| `%rating%` | `5` |
| `%play_count%`, `%replaygain_track_gain%` | `?` — no component supplies them here |
| `%lastfm_play_count%` | `70` — from `foo_enhanced_playcount`. `0`, not `?`, when unplayed |
| `%lastfm_last_played%` / `%lastfm_first_played%` | `2025-12-16 14:21:38`, or `N/A` when never played |
| `$meta(rating)` | `5` — a file tag, unlike the last.fm fields |
| `$meta(unsynced lyrics)` | LRC-timestamped lyrics. **Tag name has a space** |
| `%last_modified%` | `2025-10-07 10:54:28` — see the warning below |
| `$upper(%artist%)` | `THE CHEMICAL BROTHERS` |
| `$abbr(%album%)` | `BitE` |
| `%album artist% - %title%` | concatenation works |

An unresolved field returns `?`, not an error. A field that resolves but is empty
returns `''`, `0` or `N/A`. **That difference is a usable capability probe**: `?`
everywhere means the component is absent, so a feature can be hidden rather than
shown broken.

> **Corrupt fields (*measured*):** `%date%` and `%added%` return mangled constants
> (`\ufffdte`, `\ufffdded`) rather than `?` or a value. Use `%year%` instead. There is
> no working "date added" field.

> **`%last_modified%` is not a date-added field (*measured*).** Playback can rewrite
> tags, which bumps the file's mtime — the mtime moves ~55 s before the scrobble
> lands, and 21% of played tracks have an mtime within ten minutes of their last
> play. It is `max(added, last played or retagged)`, and it is wrong precisely at the
> recent end where a "recently added" view would look.

> **Lyrics need no component.** `$meta(unsynced lyrics)` — with a space — returns
> LRC-timestamped lyrics from an ordinary tag, on 24% of tracks in this library.
> `%lyrics%` returns `?` and `$meta(unsyncedlyrics)` finds nothing. `foo_openlyrics`
> is what *writes* that tag; reading it requires nothing.

> **Hard limitation (*measured*):** the column list is split on commas **before** the
> expressions are evaluated, so **any title-format function taking more than one
> argument is unusable** — `$if(%album artist%,yes,no)` arrives as three separate
> columns. Quoting does not help; foobar's `''` escaping happens too late. Repeating
> the parameter (`&trcolumns=a&trcolumns=b`) does not work either — only the first is
> honoured.
>
> So: single fields, concatenation, and single-argument functions only. Anything
> conditional has to be computed client-side from the raw fields.
>
> **Single-argument functions do nest, though (*measured*):**
> `$len($meta(unsynced lyrics))` works. The limitation is on *arguments*, not on
> composition — useful for asking about a large field without downloading it.

## Every endpoint

38 in total, from `docs/player-api.yml`.

**Player** — `GET|POST /player` · `POST /player/play` · `/player/play/{playlistId}/{index}` ·
`/player/play/random` · `/player/next` · `/player/previous` · `/player/stop` ·
`/player/pause` · `/player/pause/toggle` · `/player/play-pause` · `/player/volume/up` ·
`/player/volume/down`

`next` and `previous` accept a `by` expression, so "next album" is possible.

**Playlists** — `GET|POST /playlists` · `/playlists/add` · `/playlists/remove/{id}` ·
`/playlists/move/{id}/{index}` · `GET|POST /playlists/{id}` ·
`GET /playlists/{id}/items/{range}` · `/playlists/{id}/clear` · `/playlists/{id}/items/add` ·
`/playlists/{id}/items/remove` · `/playlists/{id}/items/copy` ·
`/playlists/{src}/{dst}/items/copy` · `/playlists/{id}/items/move` ·
`/playlists/{src}/{dst}/items/move` · `/playlists/{id}/items/sort`

**Play queue** — `GET /playqueue` · `/playqueue/add` · `/playqueue/remove` · `/playqueue/clear`

**Outputs** — `GET /outputs` · `POST /outputs/active`

**Query** — `GET /query` · `GET /query/updates`

**Browser** — `GET /browser/roots` · `GET /browser/entries`

**Artwork** — `GET /artwork/current` · `GET /artwork/{playlistId}/{index}`

**Client config** — `GET|POST /clientconfig/{id}` · `POST /clientconfig/remove/{id}`

## Changing things

Request bodies, from `docs/player-api.yml` and verified against the live player.

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

Notes that cost time to rediscover:

- **`/playqueue/add` takes one item per request.** Queueing forty tracks is forty
  POSTs. `queueIndex` is accepted and **silently ignored** on foobar2000 rather than
  refused, so there is no insert-at-position and no way to detect that there is not.
  For "shuffle this playlist", set `playbackOrder` instead — one request, no queue
  involved. The whole measured surface is under *The play queue* above.
- **There is no bulk form, and asking for one is an error, not a no-op.** *Measured*:
  `{ plref, items: [1,2,3] }` and `{ plref, itemIndex: [1,2] }` both return **400**. That
  rules the play queue out as a way to express "play this set of tracks" — a playlist is
  the only mechanism the API has for it.
- **Playback order applies to the active playlist, and playing a track sets it.**
  *Measured*: `POST /player/play/p5/3` made `p5` current, and `Shuffle (tracks)` then drew
  3 → 953 → 540 → 218, never leaving `p5`. So confining playback to a set of tracks means
  getting those tracks into a playlist; there is no selection concept to shuffle within.
- **Emptying or deleting the playing playlist does not stop playback.** *Measured*: with
  either, the current track keeps playing but is orphaned — `activeItem.playlistId` goes
  to `""` and `index` to `-1`. Emptying is harmless if a play follows immediately.
  Deleting is not: when the track ends the player falls back to another playlist and
  carries on, so "delete it and playback will stop at the end" is false.
- **Renaming a playlist while it is playing is seamless.** *Measured*: same track, same
  position, uninterrupted — 1.8s → 2.5s → 5.0s across the rename. Useful, because it turns
  "save these results as a playlist" into a rename rather than a copy.
- **`items/copy` is fast enough to build playlists on demand.** *Measured*: 500 indices in
  17 ms, 5,000 in 33 ms, 20,000 in 166 ms. Emptying and refilling a playlist round-trips
  in ~47 ms.
- **There is no way to reach another component.** *Measured*: `/api/commands`,
  `/api/command`, `/api/mainmenu`, `/api/contextmenu`, `/api/plugins`, `/api/components`
  all 404. `foo_quicksearch` builds a real playlist you can read like any other, but
  nothing triggers it from here.
- **`playbackMode` on `POST /player` is deprecated.** Use the `options` array.
- **Sorting is whole-playlist and destructive.** There is no sort-a-selection, and no
  view-level sort — the player owns playback order, so a client-side sort would
  desync from what plays next.
- **`items/sort` takes a title-format expression**, so it inherits the comma
  limitation. Concatenation works: `%album artist%%album%%tracknumber%`.
- **`/playlists/move/{id}/{index}` takes a negative index to mean "last"**, so appending
  needs no count. Verified against `player-api.yml` and the live player.
- **Rename is `POST /playlists/{id}`, not a `rename` route.** `UpdatePlaylistRequest` has
  exactly one field, `title`, and it is nullable — so the same endpoint is the whole of
  "change something about the playlist itself".
- **There is no tag-writing endpoint.** All 27 POST routes are playback, playlists,
  queue, outputs and clientconfig. Ratings and lyrics can be *read* through title
  formatting but cannot be written back through beefweb at all.

## The library: what is and isn't reachable

> **The development player runs a pre-release beefweb with a real library API.**
> `0.11~git.dc0fdfc` -- CI's merge of
> [PR #382](https://github.com/hyperblast/beefweb/pull/382) into master, installed
> from the GitHub Actions artifact. The section below describes **released 0.10**,
> which is what DeaDBeeF and every un-upgraded install still get, and is therefore
> the fallback rather than the target. The new surface is documented under
> "The media library API" further down.

**Correct — there is no library API.** No `/library`, no `/search`, nothing that
touches foobar2000's Media Library index. beefweb sees *playlists* and *the
filesystem*, and that is the whole surface. Four ways to work around it:

1. **An autoplaylist as a library mirror. This is the answer.** An autoplaylist is a
   live Media Library query; create one with the query `ALL` and it holds every track
   in the library, updates itself as the library changes, and appears in
   `/api/playlists` like any other playlist. It needs no components, and it turns
   "there is no library API" into "there is one, you switch it on once". Autoplaylists
   cannot be *created* remotely, so this is a one-time setup step at the player.

   > **Do not use `Default Playlist` for this (*measured*).** It is foobar's scratch
   > buffer: selecting an album in the library view replaces its entire contents. It
   > went from 30,441 items to 12 within an hour of ordinary use. It looks like a
   > library mirror and is not one.

   Loading a 30,441-track playlist whole costs ~0.85 MB gzipped (6.4 MB raw), ~430 ms
   to fetch and ~40 ms to parse with 10 columns, after which client-side filtering
   across artist/album/title is an array operation.

2. **The filesystem browser.** `/browser/entries` walks `F:\Musica` (*measured*: it
   returns real directories). This is the disk, not the tagged library — you get paths
   and no metadata until items are in a playlist. Good for an "add folder" flow, bad
   as a browse model.

3. **Playlists created inside foobar.** Autoplaylists and Quicksearch results appear
   in `/api/playlists` like any other playlist — `p3` here is
   `#Quicksearch [notorious ]`. They can be *read* remotely but not *created*
   remotely, so this only helps for queries set up in advance at the PC.

4. **Add by path.** `/playlists/{id}/items/add` takes file or directory paths, so you
   can build playlists programmatically from anything on disk without the library.

## The media library API

**foobar2000 only, and only on beefweb 0.11+.** Unreleased at the time of writing --
see the note under "The library" above. On DeaDBeeF every endpoint here is **501**;
on a released 0.10 they are **404**. Treat both the same way: no library API, fall
back to the autoplaylist.

### `GET /library/info`

```jsonc
{ "library": { "supported": true, "enabled": true, "itemCount": 30441 } }
```

*Measured* against a 30,441-track library: agrees with the `ALL` autoplaylist to the
track. `enabled: false` means foobar2000 has no Media Library configured — a
different problem from "this player has no library API", and one the user fixes in
foobar's own preferences rather than in Jean.

### `GET /library/items`

`columns` is **required**. `range` is a **query parameter** in `offset:count`
form, not a path segment (all items if omitted). Optional besides, `query` (the
*player's* query syntax), `sort` (a title-format expression, defaults to file path),
`desc`.

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

**Paths are relative to the media library folders**, not absolute, and keep their
folder structure. **A track is `(path, subsong)`** — subsong is non-zero for cue
sheets and disc images, so it is not decoration.

> **Items are not naturally ordered.** The spec says they are produced by applying
> search criteria, so paging without an explicit `sort` may not be stable across
> requests.
>
> Jean passes **`sort=%path%`** rather than relying on the default, which is the same
> order -- *measured*, `sort=%path%` and no sort return byte-identical lists over
> 30,441 tracks. It is stated so that the expression a filled playlist is sorted by is
> demonstrably the same one the rows on screen are in. Change one and you change the
> other; see `LIBRARY_SORT` in `src/shared/api/beefweb.ts`.

> **There is no caching (stated in the PR), and it is measurable.** Every call
> enumerates the library and computes a relative path per item. *Measured* at 30,441
> tracks: **104 ms fixed per call plus 26 µs per item**, and the work is serialised
> on the player, so concurrent requests do not overlap. One request for everything
> beats sixteen chunks by 1.8 s. See CLAUDE.md, "The library API", for the table and
> what to do about it.

### `GET /library/items/by-path`

One level of the tree: folders first, each with a recursive `itemCount`, then tracks
with the requested columns.

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

Folder nodes carry `itemCount` and no columns; track nodes carry `subsong` and
`columns` and no `itemCount`.

> **Library paths are `/`-separated regardless of platform**, and relative to the
> media library folders. *Measured* on Windows, where `pathSeparator` from
> `/browser/roots` is `\\`: a track under `F:\Musica` comes back as
> `B/Babasónicos/(2001) Jessico/01. Los Calientes.mp3`. Do not build these with
> `pathSeparator`.
>
> The PR description mentions a `pathSeparator` field on this response. **It is not
> there** — *measured*, the keys are `items`, `offset`, `path`, `totalCount`, plus
> `parentPath` below the top level.
>
> **The player and the library disagree about what a path is**, which matters the
> moment you try to match them. `activeItem`'s `%path%` is absolute and
> platform-separated (`F:\Musica\K\Korn\…`); a library item's is relative and
> forward-slashed (`K/Korn/…`). Nothing tells a client where the library folders are,
> so the two are matched by **suffix** after normalising separators — a relative path
> is unique within the library, so it cannot collide. `pathMatchesLibraryPath()` in
> `shared/api/beefweb.ts`.

*Measured*: 27 folders at the top level of a 30,441-track library. **Ordering is a
byte-wise case-sensitive compare**, so `Zappa` sorts before `abba` — re-sort
client-side if it is shown.

### `GET /artwork/library?path=&subsong=`

Artwork without a playlist, which is the constraint it removes: everywhere else
artwork is addressed by *playlist index*. A folder prefers its own image file
(`folder`/`cover`/`front`/`album`/`artwork`) and falls back to the first track's.

> **Folder artwork probes the filesystem on the player's work queue**, and the PR
> notes a folder-thumbnail grid multiplies it. Do not build an album grid on it.

### `POST /playlists/{playlistId}/items/add-from-library`

`{ items: [{path, subsong}] | query, index, replace, play }`. Requires
`changePlaylists`. Omitting both `items` and `query` adds the entire library.

This is the one that matters most: **`replace: true, play: true` is a whole scratch
playlist rebuild in one request** — no rename, no remove-by-range, no copy, no
separate play, and so no client-side count arithmetic to get wrong.

> **The order of `items` is ignored, and the order you get back is not the order this
> endpoint pages in.** A set arrives in the **media library's browse order** — album
> artist, then album, then track — while `GET /library/items` pages by **file path**.
> *Measured* on a 30,441-track library: of 100 tracks sent in path order, 10 landed
> somewhere else; of 1,000, 426 did; of 8,000, 3,945 did; over the whole library,
> 15,539 did.
>
> **Open, and it contradicts the paragraph above.** *Measured* 2026-09-01 against
> foobar2000 2.25.3 / beefweb 0.11, `items` matched nothing: `{items: [{path, subsong}]}`
> answered 204 and added **zero** tracks to a fresh ordinary playlist, for paths taken
> straight from `GET /library/items?columns=%path%` — with `subsong` omitted, with
> `replace: true`, with a `file://` scheme and with forward slashes, all the same. The
> body *is* parsed rather than ignored: an unrecognised key (`{paths: […]}`) fell through
> to "neither items nor query" and added the whole 30,441-track library, and
> `{query: "…"}` added 54. `POST /playlists/{id}/items/add` with the same plain path
> worked. So this is specific to matching `items` against the media library, and it
> disagrees with the ordering measurements above, which could only have been taken with
> `items` working. Do not treat either as settled until one is re-measured — and note
> that shelf playback, library→playlist adds and queueing a library row all go through
> this endpoint.
>
> An earlier note here said the set came back in "the library's own order" and drew the
> conclusion that sorting refs ascending was enough. That was measured on four
> well-separated tracks, where the two orders happen to agree — as they do for most
> small sets, which is why this survived. It is not enough.
>
> **The order cannot be predicted or read back cheaply.** No `sort` expression
> reproduces it: `%album artist%` matches 9 positions out of 30,441, and the path
> default matches 14,902. Learning it once by reading the filled playlist costs 3.2 MB
> and 680 ms at 30k (~21 MB at 200k), with nothing to invalidate it against — the
> player publishes no library-change event, and `library` is not even a valid
> `/api/query` key.
>
> **So overwrite it instead of predicting it**: fill, then `POST items/sort` with the
> same expression the library was read with. *Measured* — every position correct at
> 100, 1,000, 4,000 and all 30,441 tracks, for ~340 ms of server-side work and no
> client state. See CLAUDE.md, "Filling a playlist from the library".

> **A request body over 1 MiB is refused by hanging up.** *Measured*: 1,018,757 bytes
> accepted, 1,049,652 bytes closed the connection mid-upload — which reaches the client
> as a network error, not a status code. Naming all 30,441 tracks is a 2.9 MB body, so
> "play everything" never reached the player at all.
>
> Chunk well under it, because the cost is per *item* anyway: the player resolves each
> path against the library at ~1.2 ms a track — 8,000 items took 10.2 s — so there is
> nothing to win by going wide. Better still, **omit `items` and `query` entirely to
> mean the whole library**: one request, no body, **299 ms** for all 30,441.

> **Do not mix the two filters.** `query` is the player's query syntax; Jean's search
> is `fold()`-based accent-insensitive token matching. They do not return the same
> set, so filtering client-side and then adding server-side by `query` adds tracks
> that are not the ones on screen. Address adds by explicit `items`.

### What it does not give you

- **No playback without a playlist.** There is no "play this library item"; you add
  to a playlist with `play: true`. The scratch playlist stays.
- **No library change events.** There is no `library` key for `/api/query`, so
  library changes cannot be observed. Detecting drift means polling `itemCount` from
  `/library/info` — three fields, cheap.
- **No autoplaylist creation.** Still impossible remotely.

## Two that catch people out

- **`GET /api/player` ignores `trcolumns`** and returns an empty `columns` array. Use
  `GET /api/query?player=true&trcolumns=...` for a one-shot snapshot.
- **The static server has no SPA fallback.** `/playlists/p2` is a 404, which is why
  Jean routes on the hash.

## Reaching other foobar2000 components

beefweb does not proxy other components, and there is no "run this command" endpoint.
There are three real routes, in descending order of how well they work.

**1. Title formatting — the genuine escape hatch.** Any component that publishes
fields or functions to the title-formatting engine becomes readable through
`columns`. Install a playback-statistics component and `%play_count%` /
`%last_played%` start returning values instead of `?`. This covers a large share of
what people actually want from other plugins, and needs no beefweb support at all.
Subject to the comma limitation above.

**2. Sort by expression.** `POST /playlists/{id}/items/sort` takes a title-format
expression (plus random and descending flags). Combined with copy-between-playlists,
this is enough to generate derived playlists server-side — "everything rated 5,
sorted by album" — without pulling data down first.

**3. The command line, over SSH.** foobar2000's executable takes
`/command:"<main menu command>"`, `/playlist_command:` and `/playing_command:`; the
`foo_runcmd` component adds a `/runcmd=` family. Since there is SSH to the box, this
reaches anything on foobar's menus that the API cannot. Untested here — noted as an
option, not a recommendation, and it sidesteps the API entirely.

**Out of reach:** creating autoplaylists, driving the Converter or Masstagger,
searching the media library, and reading component UI state. If a real library API
ever becomes necessary, the alternatives are other network-facing components
(`foo_upnp` exposes the media library over UPnP with browse and search) or a custom
component — both larger projects than they sound.

## The beefweb repository

`https://github.com/hyperblast/beefweb`

| Path | What's in it |
|---|---|
| `docs/player-api.yml` | **The OpenAPI spec — the authority.** Request bodies, parameters, response schemas |
| `docs/advanced-config.md` | `config.json` options: `webRoot`, `urlMappings`, `responseHeaders`, auth. **Read the tag matching your plugin version, not `master`** — `altWebRoot` and relative `urlMappings` paths are documented on `master` but absent from the v0.10 release, and a relative path there silently 404s |
| `js/api_tests/` | Integration tests. The fastest way to find the exact body shape for a mutation |
| `js/client/` | Official JS client, `beefweb-client`. **Not published to npm** (`private: true`, 404 on the registry) — read it, don't depend on it |
| `js/webui/` | Source of the stock UI we are replacing. Useful for seeing how it handles playlist paging |
| `cpp/` | The plugin itself, if a question needs settling at the source |

Render the spec locally rather than reading raw YAML:

```sh
npx @redocly/cli preview-docs \
  https://raw.githubusercontent.com/hyperblast/beefweb/master/docs/player-api.yml
```
