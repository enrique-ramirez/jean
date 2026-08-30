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

IDs are `p1`, `p2`, … and are stable while the player runs. `totalTime` reads 0.0
here; don't rely on it.

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
| `%play_count%`, `%last_played%`, `%replaygain_track_gain%` | `?` — no component supplies them here |
| `$upper(%artist%)` | `THE CHEMICAL BROTHERS` |
| `$abbr(%album%)` | `BitE` |
| `%album artist% - %title%` | concatenation works |

An unresolved field returns `?`, not an error.

> **Hard limitation (*measured*):** the column list is split on commas **before** the
> expressions are evaluated, so **any title-format function taking more than one
> argument is unusable** — `$if(%album artist%,yes,no)` arrives as three separate
> columns. Quoting does not help; foobar's `''` escaping happens too late. Repeating
> the parameter (`&trcolumns=a&trcolumns=b`) does not work either — only the first is
> honoured.
>
> So: single fields, concatenation, and single-argument functions only. Anything
> conditional has to be computed client-side from the raw fields.

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

## The library: what is and isn't reachable

**Correct — there is no library API.** No `/library`, no `/search`, nothing that
touches foobar2000's Media Library index. beefweb sees *playlists* and *the
filesystem*, and that is the whole surface. Four ways to work around it:

1. **An "everything" playlist as a library mirror.** `Default Playlist` already holds
   30,441 tracks. Loading it whole costs 462 KB / ~205 ms, after which client-side
   filtering across artist/album/title is an array operation. In practice this is the
   best answer and the one this UI should take.

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
