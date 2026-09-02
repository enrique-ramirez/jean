# Contributing

Everything a person needs to work on Jean. If you only want to *use* it, the
[README](./README.md) is the whole story.

Three other documents, and they do not overlap:

- **[API.md](./API.md)** — what beefweb and foobar2000 actually do, measured. Response
  shapes, what returns `?`, what hangs up, what the endpoints cost.
- **[CLAUDE.md](./CLAUDE.md)** — why Jean is built the way it is. Design decisions and
  the reasoning behind them, for coding agents and for anyone who wants the argument
  rather than the rule. It carries what holds everywhere; anything specific to one
  part of the app is in a `CLAUDE.md` next to that part (`src/domain/track/`,
  `src/shared/ui/`, and so on).
- **[test/README.md](./test/README.md)** — the suite, the fake player, and why there
  are no unit tests.

## Development

**You do not deploy to Windows to develop.** The UI is a static SPA that talks to
beefweb over HTTP; it does not need to be served *by* beefweb to work. Vite runs on
the Mac and proxies `/api` to the real player, so the app is same-origin, there is no
CORS to configure, and nothing changes on the Windows side.

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm typecheck      # tsc across app, fake player and specs
pnpm lint           # biome check
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

### `foo_jean` is the one thing the proxy does not cover

Every other request Jean makes is a root-relative `/api` path, which the dev proxy
forwards to the player. The optional tag-writing component is not: it listens on a
port of its own, so its address is a *host* and a port rather than a path, and on the
dev server that host is your machine rather than the player's. `vite.config.ts` takes
it from `BEEFWEB_URL` and injects it as `__PLAYER_HOST__`, so there is nothing extra
to configure here — but the request is then genuinely cross-origin in a way it never
is in a build, and the component has to be told to accept it.

*Measured*: it answers `200` to `Origin: http://localhost:5173` and sends **no**
`Access-Control-Allow-Origin` header at all, so the browser discards a perfectly good
response and Jean reports the component as unreachable. Left to defaults it only
reflects an origin whose host matches the host it was addressed to, which is exactly
the production case and deliberately not this one.

So add the dev server to `<profile>/foo_jean/config.json` and restart foobar2000:

```jsonc
"allowedOrigins": ["http://localhost:5173"]
```

Add the LAN name too if you test on a phone against the dev server. None of this
applies to a build, where beefweb serves Jean from the player and the hosts match.

### The development player runs a pre-release beefweb

`0.11~git.dc0fdfc` — CI's merge of
[PR #382](https://github.com/hyperblast/beefweb/pull/382), which adds the media
library API, into master. Taken from the GitHub Actions artifact for that run rather
than built locally; the foobar2000 component is an MSVC target and cannot be built
from macOS.

Jean is developed against it as though it had shipped, **and still has to work
without it** — released beefweb is 0.10, DeaDBeeF will never have it, and both are
covered by the same `supported` / `enabled` / 404 detection. See `CLAUDE.md`, "The
library API".

To install it on a portable foobar2000: close the player, replace
`profile\user-components-x64\foo_beefweb\` with the contents of the
`.fb2k-component` (it is a zip — `x64/foo_beefweb.dll` plus `beefweb.root/`), and
restart. Back up that folder and `profile\beefweb\` first; the latter holds
beefweb's `config.json` and Jean's own `clientconfig`, which is where server-side
settings live.

## Where things live

```
src/
  shared/     knows nothing about Jean. api/ (beefweb client + wire types), ui/,
              lib/, hooks/, keyboard/, styles/
  domain/     what Jean is about, as data and behaviour with no route of its own
    track/    rows, refs, the source seam, the virtualised list machinery
    library/  the library as one array, its search, and what plays a set
    player/   player state, position interpolation, the volume curve
  features/   one folder per thing a user can do: home, search, library, playlist,
              now-playing
  app/        the shell: App, Sidebar, CommandPalette, theme, hash routing
```

**Imports run one way: `app -> features -> domain -> shared`.** Biome enforces it, so
a violation is an error at `pnpm lint` rather than something a reviewer has to catch.
Within `domain` the slices form a DAG (`library -> track -> player`); sideways is
allowed there, a cycle is not.

Anything outside its own folder is imported through the `@/` alias
(`@/domain/track/fields`). Same-folder imports stay relative.

## Conventions

**Comments explain why, not what.** No JSDoc. If a line needs a comment to say what it
does, rename something instead. What earns a comment is a trap or a decision that looks
wrong until you know the reason -- and it belongs at the line it protects, in a sentence
or two. Anything longer is a CLAUDE.md entry, and measurements belong there rather than
in a comment that nobody re-runs.

**Styling is CSS Modules, colocated with the component.** The only global stylesheets
are `shared/styles/tokens.css` (the palette and scale, as custom properties) and
`base.css`. Re-theming Jean should mean editing about thirty custom properties and
nothing else.

**Biome is the linter and the formatter**, on its own defaults. Where a rule fires on
something deliberate, the suppression carries its reason.

**Tag hygiene is the library owner's business.** Jean reads tags and never writes or
normalises them to make its own life easier.


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

Playlist contents are a separate path. They arrive in chunks, rendered as they land, so
the list is usable long before the tail arrives. The shape of that chunking is measured
rather than guessed: a request costs about 270 ms before it returns a single row and only
30 ms more to return 2,000 rows instead of 500, so what matters is how many requests there
are, not how big they are. One modest chunk lands first to paint something, then four
concurrent large ones finish the job — a 30,441-track library shows its first rows at
~730 ms and is fully loaded in ~1.5 s, where sixteen sequential chunks of 2,000 took 5.5 s.

Rows are kept as the raw positional arrays beefweb returns rather than being turned into
objects, and play-count "heat" is precomputed into typed arrays alongside them. One load
is shared by everything that needs it, so opening the library playlist and searching it do
not fetch it twice.

Searching is a **view, not a playlist**: a filter over the rows already in memory, matching
every word of the query against title, artist and album in any order. Typing writes nothing
to the player.

**Playing does**, and it has to. beefweb plays from playlists and knows nothing else, so
playing a result in place would leave the player carrying on from *there* — the next track
would be the library's next track, and with shuffle on a random one out of everything.
Neither is what a list of matches promises. So the first time you play from a set of
results they become a real playlist named `#Jean [your query]`, and playback happens inside
it: shuffle shuffles your matches, and the end of the results is the end of playback.

**You will see that playlist in foobar2000**, sitting next to its own `#Quicksearch [...]`
ones. There is no hidden-playlist concept in the API and beefweb cannot fake one, so Jean
hides it from its own sidebar and leaves it visible in yours. It is reused rather than
piling up: one playlist, renamed and refilled per search. Dismissing the search deletes it,
unless it is what you are currently listening to.

It is also how a search survives a reload and reaches your phone — the query is in the
title, and every client can see the player's playlists.

Keeping results takes an explicit click, and when they are already playing it costs no copy
at all: the playlist they are playing from *is* what you are saving, so it is renamed and
stops being Jean's. Playback carries straight on through it. Otherwise
`POST /playlists/add` returns the new playlist id, and
`POST /playlists/{src}/{dst}/items/copy` copies by **index** — no `%path%` lookup, no
upload beyond a list of numbers. Measured: 15,000 indices in a single request, 323 ms. The
button is hidden entirely when the player reports `changePlaylists: false`, and disabled
while the library is still loading, since a partial result set would save as if it were the
whole answer.

## Stack

React 19 · TypeScript 7 · Vite 8 · TanStack Query 5 · TanStack Virtual ·
TanStack Hotkeys · lucide-react · CSS Modules · Biome · pnpm · Playwright. No unit
tests and no jsdom, on purpose: the things that break here need real layout, real
pointers and a real viewport. See `test/README.md`.

Styling is CSS Modules per component, with the palette in `src/shared/styles/tokens.css` as
custom properties — re-theming Jean means editing about thirty values there, with no
build step required to know what they do.
