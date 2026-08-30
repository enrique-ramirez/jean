# beefweb-ui

A replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin,
driving foobar2000 on the Windows box at `home.local`.

Currently: the playback section only — play/pause, elapsed time, track and artist.

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

## Deploying to the Windows box

Needs SSH key auth, which **is not set up yet** — `ssh you@home.local` currently
fails with `Permission denied (publickey,password,keyboard-interactive)`. When
adding a key, note that Windows OpenSSH reads
`C:\ProgramData\ssh\administrators_authorized_keys` for accounts in the
Administrators group, *not* `~/.ssh/authorized_keys`. This catches everyone.

Then:

```sh
export BEEFWEB_SSH=you@home.local
export BEEFWEB_WEB_DIR='C:/Users/you/AppData/Roaming/foobar2000-v2/beefweb/ui'
pnpm deploy
```

And tell beefweb to serve it, in
`%APPDATA%\foobar2000-v2\beefweb\config.json`:

```json
{
  "urlMappings": {
    "/muse": "ui"
  }
}
```

Relative paths resolve against the beefweb profile directory, so `"ui"` is the
folder above. The custom UI then lives at `http://home.local:8880/muse` while the
stock one stays at `/` — nothing to uninstall, and an instant fallback if something
breaks.

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
projects forward from that anchor. `<Elapsed>` runs the animation frame loop and is
deliberately a leaf — that state must never be lifted, or it will one day repaint a
30,000-row virtualised track list sixty times a second.

## API notes worth remembering

- `GET /api/player` **ignores** `trcolumns` and returns an empty `columns` array.
  Use `GET /api/query?player=true&trcolumns=…` for a one-shot snapshot.
- Columns are foobar2000 title-formatting expressions evaluated by the player, so
  `%codec%`, `%bitrate%`, `%rating%` and single-argument functions like
  `$upper(...)` all work. Adding a field is a one-line change to `TRACK_COLUMNS`.
  Multi-argument functions do **not** — the list is split on commas before the
  expressions are evaluated, so `$if(a,b,c)` becomes three columns.
- beefweb serves gzip, and the static server has **no SPA fallback** —
  `/playlists/p2` is a 404. Use hash routing when a router is added.

See [API.md](./API.md) for the full API surface, measured response shapes, and what
is and isn't reachable (short version: there is no library API — only playlists and
the filesystem).

## Stack

React 19 · Vite 8 · TanStack Query 5 · TanStack Hotkeys · pnpm. No test setup yet.
