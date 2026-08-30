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
(see `src/player/position.js`), and a long silence is normal, not a stall.

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
ordinary one**, and `GET /playlists/{id}` returns the same six. Smart playlists are
therefore undetectable: they reject edits, but the only way to find out is to try.

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

- `GET /api/playqueue?qcolumns=…` → `{ "playQueue": [] }`
- `GET /api/outputs` → active output plus available types/devices, each with an opaque
  `id`. *Measured*: `supportsMultipleOutputTypes: false` on foobar2000.
- `GET /api/browser/roots` → `{ "pathSeparator": "\\", "roots": [ { "path": "F:\\Musica", … } ] }`
- `GET /api/browser/entries?path=…` → `{ "entries": [ { "name", "path", "size", "timestamp", "type": "D"|"F" } ] }`
- `GET /api/artwork/current` and `/api/artwork/{playlistId}/{index}` → image bytes
  (*measured*: `image/jpeg`, 46 KB), or 404 when there is none.
- `GET|POST /api/clientconfig/{id}` → arbitrary JSON blob storage, server-side. Useful
  for making this UI's own settings follow the user between devices instead of living
  in `localStorage`.

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
| Add files or folders | `POST /playlists/{id}/items/add` | `{ items: [paths], index, replace, play, async }` |
| Queue an item | `POST /playqueue/add` | `{ plref, itemIndex }` |

Notes that cost time to rediscover:

- **`/playqueue/add` takes one item per request.** Queueing forty tracks is forty
  POSTs. `queueIndex` exists but is DeaDBeeF-only. For "shuffle this playlist", set
  `playbackOrder` instead — one request, no queue involved.
- **`playbackMode` on `POST /player` is deprecated.** Use the `options` array.
- **Sorting is whole-playlist and destructive.** There is no sort-a-selection, and no
  view-level sort — the player owns playback order, so a client-side sort would
  desync from what plays next.
- **`items/sort` takes a title-format expression**, so it inherits the comma
  limitation. Concatenation works: `%album artist%%album%%tracknumber%`.
- **There is no tag-writing endpoint.** All 27 POST routes are playback, playlists,
  queue, outputs and clientconfig. Ratings and lyrics can be *read* through title
  formatting but cannot be written back through beefweb at all.

## The library: what is and isn't reachable

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
| `docs/advanced-config.md` | `config.json` options: `webRoot`, `altWebRoot`, `urlMappings`, `responseHeaders`, auth |
| `js/api_tests/` | Integration tests. The fastest way to find the exact body shape for a mutation |
| `js/client/` | Official JS client, `beefweb-client`. **Not published to npm** (`private: true`, 404 on the registry) — read it, don't depend on it |
| `js/webui/` | Source of the stock UI we are replacing. Useful for seeing how it handles playlist paging |
| `cpp/` | The plugin itself, if a question needs settling at the source |

Render the spec locally rather than reading raw YAML:

```sh
npx @redocly/cli preview-docs \
  https://raw.githubusercontent.com/hyperblast/beefweb/master/docs/player-api.yml
```
