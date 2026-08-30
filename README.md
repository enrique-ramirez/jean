# jean

A replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin,
controlling foobar2000 — and, best-effort, DeaDBeeF — from any browser on your
network.

Named for how it feels to use, not for anything it does. Rhymes with *pan*, not
with *bean* — the "ea" is the A in apple.

**Where it is:** the playlist view works. Compact and album layouts over a virtualised
list that stays smooth at 30,000 tracks, find-within-playlist that jumps rather than
filters, toggleable columns, full keyboard navigation, light and dark themes, and a
transport with a seekable progress bar. If your player reports play counts, tracks are
shaded by how often you have played them and faded by how long it has been.

**Not built yet:** the home screen, library-wide search, and playlist editing.

## Development

**You do not deploy to Windows to develop.** The UI is a static SPA that talks to
beefweb over HTTP; it does not need to be served *by* beefweb to work. Vite runs on
the Mac and proxies `/api` to the real player, so the app is same-origin, there is no
CORS to configure, and nothing changes on the Windows side.

```sh
pnpm install
pnpm dev            # http://localhost:5173
```

That is the whole loop: edit a file, HMR updates the browser, and it is controlling
the actual foobar2000 instance with real playlists and real playback the entire time.

Point it somewhere else when needed:

```sh
BEEFWEB_URL=http://10.100.100.20:8880 pnpm dev
```

The dev server also binds on the LAN (`host: true`), so a phone can load
`http://Enriques-MacBook-Pro-2.local:5173` and hit the same proxy — real-device
testing without a build either.

Deploying is therefore only for making it permanent, or for using the UI when the
Mac is off.

## Pointing Jean at your library

beefweb has no library API — it can see **playlists and the filesystem, and nothing else**.
foobar2000's Media Library is invisible to it. So Jean needs a playlist that mirrors your
library, and the right kind is an **autoplaylist**: a live Media Library query that stays in
sync on its own.

In foobar2000: **Library → Search**, enter `ALL` as the query, and create an autoplaylist
from the result. Name it whatever you like — Jean will ask you to pick it on first run.

That playlist then contains every track in your Media Library, updates itself when you add
or remove music, and costs nothing to keep around.

> **Do not point Jean at `Default Playlist`.** It is foobar's scratch buffer — clicking an
> album in the library view replaces its entire contents. It can look like a library one
> minute and hold twelve tracks the next. Jean never reads or writes it.

If you would rather not create an autoplaylist, Jean can build a playlist from your music
folders instead. That mirrors what is on disk rather than what is in your library, and needs
a manual refresh when you add music.

## Deploying to the player

Jean is a static build. Copy it somewhere beefweb can serve and add a URL mapping — no
CORS setup, nothing to uninstall, and the stock UI stays where it is as a fallback.

```sh
export BEEFWEB_SSH=user@player-host
export BEEFWEB_WEB_DIR='/path/to/beefweb/ui'   # inside the beefweb profile directory
pnpm deploy
```

Then in the beefweb profile's `config.json` (create it if absent):

```json
{
  "urlMappings": {
    "/jean": "ui"
  }
}
```

Relative paths resolve against the beefweb profile directory, so `"ui"` is the folder you
deployed to. Jean then lives at `http://player-host:8880/jean` while the stock UI stays at
`/`.

**Finding the profile directory** is the fiddly part, and where most of the confusion
happens:

- **Standard Windows install** — `%APPDATA%\foobar2000-v2\beefweb\`
- **Portable install** — next to the executable instead, e.g. `<install dir>\profile\beefweb\`.
  If foobar lives on an external drive, so does its profile. `%APPDATA%` will be empty and
  a deploy there fails silently: the files copy fine and beefweb keeps serving the stock UI.
- **DeaDBeeF** — under `~/.config/deadbeef/beefweb/`

When deploying over SSH to Windows, note that OpenSSH reads
`C:\ProgramData\ssh\administrators_authorized_keys` for accounts in the Administrators
group and ignores `~/.ssh/authorized_keys` entirely. That file must also grant access to
only Administrators and SYSTEM, or sshd refuses it without logging why.

`base: './'` in the Vite config is what makes that work: assets are referenced
relatively, so the same build runs under any mount prefix.

## How the data flows

beefweb pushes player state over SSE, and pushes **only when something changes** —
roughly once per track, not once per second. Measured: one message in eight seconds
during steady playback.

- `usePlayerStream()` runs one `EventSource` at the app root and writes each message
  into the TanStack Query cache under `['player']`.
- Components read that with an ordinary `useQuery`. The `queryFn` only covers first
  paint and reconnect; the stream owns the key from then on.
- `usePlayPause()` is a `useMutation` with an optimistic flip, so the button responds
  immediately and the stream confirms a moment later.

Because position only arrives on change events, the progress bar **interpolates**:
every snapshot is stamped with `performance.now()` on arrival, and `positionAt()`
projects forward from that anchor. `<SeekBar>` runs the animation frame loop and is
deliberately a leaf — that state must never be lifted, or it would repaint a
30,000-row virtualised track list sixty times a second.

Playlist contents are a separate path. They arrive in **chunks of 2,000**, rendered as
they land, so the list is usable long before the tail arrives — the first chunk of a
30,000-track playlist shows up in well under a tenth of the total time. Rows are kept
as the raw positional arrays beefweb returns rather than being turned into objects,
and play-count "heat" is precomputed into typed arrays alongside them.

## API notes worth remembering

- `GET /api/player` **ignores** `trcolumns` and returns an empty `columns` array.
  Use `GET /api/query?player=true&trcolumns=…` for a one-shot snapshot.
- Columns are foobar2000 title-formatting expressions evaluated by the player, so
  `%codec%`, `%bitrate%`, `%rating%` and single-argument functions like
  `$upper(...)` all work. Adding a field is one line — `TRACK_COLUMNS` in
  `src/api/beefweb.js` for the playing track, `src/playlist/fields.js` for the list.
  Multi-argument functions do **not** work — the list is split on commas before the
  expressions are evaluated, so `$if(a,b,c)` becomes three columns. Single-argument
  functions *do* nest, though: `$len($meta(unsynced lyrics))` is fine.
- beefweb serves gzip, and the static server has **no SPA fallback** —
  `/playlists/p2` would be a 404, which is why Jean routes on the hash.
- There is **no tag-writing endpoint**. Ratings and lyrics can be read but not
  written back.

See [API.md](./API.md) for the full API surface, measured response shapes, and what
is and isn't reachable (short version: there is no library API — only playlists and
the filesystem).

## Components

Jean needs **one** component. Everything else is detected at runtime and simply stays hidden
if it is not there — a bare beefweb install still gets a complete app.

| | Component | What it gives you |
|---|---|---|
| **Required** | [`foo_beefweb`](https://github.com/hyperblast/beefweb) | Everything core: playback, playlists, play queue, outputs, artwork, filesystem browsing, search |
| **Optional** | `foo_enhanced_playcount` *or* `foo_playcount` | Play counts and first/last played, which drive the Most Played, Recently Played and "haven't heard since" shelves |
| **Optional** | any component publishing title-formatting fields | Auto-detected. Jean probes the fields it knows about and enables whatever resolves |

**Some features need no component at all**, because they read tags your files already carry:

- **Lyrics**, from the `UNSYNCED LYRICS` tag — including LRC-timestamped lyrics that scroll
  in time with playback. [`foo_openlyrics`](https://github.com/jacquesh/foo_openlyrics) is a
  good way to *populate* that tag, but Jean does not require it and never reads it directly.
- Ratings, ReplayGain, composer, publisher, ISRC, and all standard metadata.

Jean works with **foobar2000** and, on a best-effort basis, **DeaDBeeF** — beefweb supports
both, and feature detection covers most of the difference.

## Keyboard

Everything is reachable from the keyboard on desktop, and `?` lists the lot — that
overlay is generated from the same table that registers the bindings, so it cannot go
stale. The short version:

| | |
|---|---|
| `Space` | Play / pause |
| `←` `→` | Seek ∓5 seconds |
| `⌘←` `⌘→` | Previous / next track |
| `=` `-` | Volume up / down |
| `m` | Mute |
| `↑` `↓` · `j` `k` | Move through the list |
| `Enter` | Play the selected track |
| `/` | Find within the playlist |
| `⌘K` | Go to playlist |
| `n` | Jump to what is playing |
| `v` | Switch compact / album layout |
| `t` | Switch light / dark |
| `⌘B` | Show / hide the sidebar |

## Stack

React 19 · Vite 8 · TanStack Query 5 · TanStack Virtual · TanStack Hotkeys ·
lucide-react · CSS Modules · pnpm. No test setup yet.

Styling is CSS Modules per component, with the palette in `src/styles/tokens.css` as
custom properties — re-theming Jean means editing about thirty values there, with no
build step required to know what they do.
