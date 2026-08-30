# Jean

A replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin,
controlling foobar2000 (and, best-effort, DeaDBeeF) over HTTP.

Named for how it feels to use. Rhymes with *pan*, not *bean*.

## What this is

**A general-purpose UI meant for public release, not a personal dashboard.** It happens
to be developed against one person's library, but nothing may assume that library. No
hardcoded playlist IDs, no assumed paths, no assumed scale, no assumed components.

The primary axis of quality is **UX/UI, and performance is part of UX**. A feature that
makes the interface slower needs to justify itself. When in doubt, favour the choice that
keeps interaction responsive.

## Ground rules

- **Fully responsive.** One codebase, no separate mobile build.
- **Desktop is keyboard-first.** Rich, discoverable keyboard navigation via
  `@tanstack/react-hotkeys`. Anything reachable by mouse should be reachable by key.
- **Mobile is aggressively optimised** — touch targets, safe-area insets, and a much
  tighter payload and interaction budget than desktop.
- **Light and dark themes, both designed.** Neither is `#000` / `#fff`.
- **Minimum required components: beefweb alone.** Everything beyond that is optional,
  auto-detected, and individually toggleable in Jean's own settings UI. A bare beefweb
  install must get a complete, coherent app — never a dead panel or an empty shelf.
- Keep the supported-component list in `README.md` current as features are added.

## foobar is the source of truth

Prefer the player's own metadata over anything Jean invents. In order of preference:

1. **Read it from foobar** via title-formatting columns. Always check this first — the
   player computes, so the reachable surface is much wider than beefweb's own schema.
2. **Get it to live in foobar**, if a component or tag can supply it. Requiring an
   optional component for an optional feature is acceptable and expected.
3. **Store it locally in Jean**, only when foobar genuinely cannot hold it. This is a
   legitimate fallback, not a failure — but reach for it third, not first.

Writing a custom foobar component to feed Jean is a deliberate last resort. Don't design
toward it.

Corollary: **Jean's own settings live server-side** in `/api/clientconfig/{id}`, so they
follow the user between devices. Fall back to `localStorage` only when
`permissions.changeClientConfig` is false.

## Product decisions already made

**The home screen leads with play-history shelves** — Most Played, Recently Played, and
"haven't heard since" — with the albums grid below them. These depend on a playcount
component, so on an install without one they disappear and **the albums grid must stand
alone as a complete home screen**, not a leftover.

**Search is a persistent, always-visible control** that is *also* bound to `⌘K` and `/`.
Not a keyboard shortcut with an icon added later — mobile has no keyboard, and an invisible
affordance means the feature does not exist there. On mobile it belongs within thumb reach.

Icons come from **`lucide-react`**, imported per-icon so they tree-shake.

## Architecture decisions already made

### The library

beefweb has **no library API**. It sees playlists and the filesystem, and that is the whole
surface. foobar's Media Library is invisible to it.

The way through is an **autoplaylist**: a live Media Library query, created once inside
foobar (query `ALL`), which then appears in `/api/playlists` like any other playlist and
stays in sync as the library changes. That converts "there is no library API" into "there
is one, you switch it on once". Jean's first run must guide the user through creating it.

Three rules follow, all of them load-bearing:

- **Never read or write `Default Playlist`.** It is foobar's scratch buffer — selecting an
  album in the library view replaces its entire contents. Measured: it went from 30,441
  items to 12 in the space of an hour. Any design that treats it as a library is broken.
- **Resolve the library playlist by stored ID, falling back to title.** Playlist IDs are
  neither contiguous nor guaranteed stable — creating one playlist produced `p7`, not `p6`,
  and the spec only promises stability while the player runs.
- **Treat it as volatile and sanity-check it.** If `itemCount` swings wildly, the user has
  probably pointed us at scratch space. Say so rather than silently presenting twelve tracks
  as their library.

Fallback for users who won't create an autoplaylist: Jean can build its own playlist from
`/api/browser/roots` via `POST /playlists/add` + `items/add`. That mirrors the *disk* rather
than the library and needs manual refresh, so it is a second choice, not the default.

### Never mutate playlists as a side effect

**Browsing and playing must never create, clear, reorder or overwrite a user's playlist.**
The library being a real playlist makes this easy to hold:

- **Play a track** — `POST /player/play/{playlistId}/{index}` plays it in place. Nothing is
  written.
- **Play or queue a selection** — `/playqueue/add` takes playlist+index, so an arbitrary
  set of tracks drawn from anywhere can be queued without touching a playlist. The play
  queue is ephemeral by design and is the correct home for "play these 40 results". Do not
  build a scratch playlist for this; it is the one case where the temptation is real.
- **Never `POST /playlists/{id}/items/sort` to browse.** It mutates. It is a tool for
  building derived playlists on explicit request only.

This is about side effects, not capability. **Explicit user intent is different** — if the
user asks to add an album to a playlist, reorder one, or delete tracks, do exactly that. A
player UI that cannot manage playlists is crippled.

What Jean does legitimately change: **playback state** (play, pause, seek, volume, playback
order, output), **the play queue**, and **`/api/clientconfig/{id}`**, which is Jean's own
data. Note also that playing a track has downstream effects on the user's data — it
scrobbles and increments play counts, and on some setups rewrites the file's mtime.

### Showing playlists

**Show playlists under their real names. Never relabel or reinterpret them.** `Default
Playlist` is a volatile scratch buffer on one install and someone's primary working playlist
on the next; Jean cannot tell which, and guessing wrong means confidently mislabelling a
user's own data.

Use **`isCurrent`** to mark the playlist the player is playing from. It is maintained by the
player, it means the same thing on every install, and it is the honest way to surface "what
is happening on the desktop right now".

### Playlist kinds — real, but undetectable

There is a genuine functional split between playlist kinds:

| Kind | Editable? | Stable? |
|---|---|---|
| Regular playlist | yes | yes — only the user changes it |
| Smart / autoplaylist | **no** — rejects add, remove, reorder | no — the library drives it |
| `Default Playlist` | yes | **no** — foobar's own UI clobbers it |

**The API cannot express it.** `PlaylistInfo` has exactly six fields — `id`, `index`,
`title`, `isCurrent`, `itemCount`, `totalTime` — verified against both the live API and
`docs/player-api.yml`. `GET /playlists/{id}` returns the same six. **There is no
autoplaylist flag. Do not go looking for one again.**

Every detection route is worse than not detecting: probing with a mutation is destructive,
inferring from `itemCount` drift is slow and cannot separate a smart playlist from
`Default Playlist` churn, and name heuristics only catch foobar's `#Quicksearch` prefix.

So handle the split by design rather than detection:

- **Volatility mostly does not matter.** Only the library playlist gets the expensive
  indexed treatment. Every other playlist is small enough to read on demand, so there is no
  stale cache to protect and auto-updating is harmless.
- **Editability is graceful failure.** `permissions.changePlaylists` can already deny an
  edit, so that code path must exist anyway. Attempt, catch, explain. Then *learn* — record
  the refusal in `clientconfig` so edit affordances disappear from that playlist afterwards.
- **Hierarchy belongs to the user.** Let people pin, group and order playlists in Jean's
  sidebar, stored in `clientconfig` so it follows them across devices. Library pinned at the
  top as the primary browse entry. This is tier three of the source-of-truth ladder, and
  legitimate precisely because foobar exposes no such concept.

### Search results are a view, not a playlist

Search is a client-side filter over the in-memory library index. **No request, no playlist
created, nothing written to the player.** Do not render it as a playlist in the sidebar —
that invites the expectation that it persists. To play a filtered set, queue it through
`/playqueue/add`, which takes playlist+index and needs no playlist to exist.

### Loading it

Measured on a 30,441-track library, 12 columns: 1.03 MB gzipped, 6.95 MB raw, ~680 ms
fetch, ~46 ms parse. That scales to 100k–200k libraries only with the following, all of
which are required, not optional:

- **Fetch in chunks** (`offset:count`). Not for throughput — the server is the bottleneck
  and parallel chunks barely beat one request — but for **time to first paint**. The first
  chunk lands in ~77 ms and can render immediately while the rest streams in.
- **Parse and index in a Web Worker.** A 46 ms parse at 30k is a ~300 ms main-thread
  freeze at 200k.
- **Dictionary-encode into columns.** Parallel `Uint32Array`s of indices into shared string
  tables. The fields users browse and sort by have few distinct values (743 album artists,
  145 genres in a 30k library) so they cost almost nothing. Naive objects at 200k tracks
  are ~100 MB of heap; encoded columns are under 20 MB.
- **Never hold per-track-unique strings you don't need.** `%path%` alone is ~31 MB at 200k
  and is not needed — tracks are addressed by playlist index. Fetch it on demand for the
  one track that needs it. Same rule for lyrics.
- **Integers, not strings**, for dates, durations and counts. Sorting a typed array is
  sub-millisecond; sorting objects by a string field is not.
- **Persist to IndexedDB.** `structuredClone` handles TypedArrays natively, so a warm start
  is a buffer read. Revalidate in the background against `itemCount` and SSE playlist
  events.

### Rendering

**React does not virtualize.** Render 30k rows and you get 30k DOM nodes. Use
[TanStack Virtual](https://tanstack.com/virtual/latest) for any list that can grow
unbounded. `content-visibility: auto` is not a substitute — it skips paint but still
builds every node.

Artwork is per-playlist-index (`/api/artwork/{playlistId}/{index}`, ~46 KB each). It
**must** be lazy-loaded off the virtualizer's visible window. Eagerly fetching a 2,000-album
grid is ~100 MB of images.

Two traps, both of which have already shipped bugs:

- **Measurements are cached by index, and an index means different things in
  different layouts.** The compact list and the album view share one virtualizer;
  row 4 is a track in one and an album group in the other. Switching layouts without
  calling `virtualizer.measure()` hands each layout the other's heights — which
  looked like list rows suddenly being 200px tall. Reset on any change that
  redefines what an index is.
- **Rendered is not visible.** `overscan` deliberately mounts rows past the fold, and
  an album group is tall enough that its rows can be mounted while sitting well below
  the screen. Anything asking "is this row on screen?" must measure the element
  against the scroll container, not check whether the virtualizer rendered it.

Prefer computed sizes where they are genuinely fixed (compact rows are exactly one
height) and `measureElement` where they are not. Album group heights depend on
caption wrapping and breakpoint, and hand-computing them left visible gaps between
groups.

### Layout

The app shell is a `100dvh` grid, rows `auto / 1fr / auto` — chrome, content, status bar —
where **the content row is the only scroll container**. Not `vh`; mobile browser chrome
breaks it.

That one choice buys three things: the status bar is pinned by construction rather than
`position: sticky` (no z-index fights, no iOS sticky bugs), the virtualizer gets the
explicit scroll element it needs, and safe-area insets have somewhere to live. Do not move
scrolling to `<body>`.

The status bar is **one component with two shapes**, not two components: a full-width
footer on desktop, a compact strip that expands to a full-screen sheet on mobile.

Model **what is playing** separately from **where it is playing**. Output is a named
target, not an assumption that audio comes from the remote player.

### Keyboard

Virtualization and keyboard navigation collide: the virtualizer unmounts the focused row
when it scrolls out of view, and DOM focus evaporates. So **the active row is an index in
state**, and the virtualizer is told to scroll that index into view. A roving `tabindex`
alone will not survive. Every list component must be built knowing this.

Position updates arrive only on change events, so the progress display **interpolates**
locally (`src/player/position.js`). `<SeekBar>` runs the animation-frame loop and is
deliberately a leaf — that state must never be lifted, or it will one day repaint a
virtualised 30k-row list sixty times a second.

### Theming

The accent is `#ffb454` on `#0e1013` — effectively the Ayu Dark palette, and the
identity of the app. Keep the warmth.

`#ffb454` on white is ~1.7:1 and unreadable, so the **light theme must darken the accent**
(Ayu Light's `#fa8d3e` is the reference), not reuse it. Define both themes in `oklch` as
one hue with different lightness ramps, so they stay in sync rather than drifting into two
hand-tuned palettes.

## Capability detection

A title-formatting field that **does not exist returns `?`**. A field that exists but is
empty returns `0`, `''` or `N/A`. That difference is the whole feature-detection mechanism:
probe a set of columns against a few sample tracks on connect, and enable features for
whatever resolves. Users can override in settings when detection guesses wrong.

`player.info.name` distinguishes foobar2000 from DeaDBeeF. Support DeaDBeeF on a best-effort
basis — feature detection covers most of it. Do not invest in a second title-format dialect
without a real report.

## API facts that will bite you

`API.md` is the full surface. The traps worth repeating:

- **The column list is split on commas before evaluation**, so any title-format function
  taking more than one argument is unusable — `$if(a,b,c)` arrives as three columns.
  **Single-argument functions do nest**, though: `$len($meta(unsynced lyrics))` works. Use
  that for cheap server-side computation.
- **`%date%` and `%added%` are corrupt**, not empty — they return mangled constants. Use
  `%year%` instead.
- **`%last_modified%` is not a date-added field.** Playback can rewrite tags, which bumps
  the file mtime — measured, the mtime moves ~55 s before the scrobble lands, and 21% of
  played tracks have an mtime within ten minutes of their last play. It is
  `max(added, last played or retagged)`, and it is wrong precisely at the recent end. Build
  "recently added" from Jean's own first-seen index instead, seeded from mtime on first
  sync.
- **Lyrics are `$meta(unsynced lyrics)`** — with a space, and it holds LRC-timestamped
  content despite the name. Reading them needs **no component**; they're an ordinary tag.
  `%lyrics%` returns `?` and `$meta(unsyncedlyrics)` finds nothing.
- **`GET /api/player` ignores `trcolumns`** and returns `"columns": []`. Use
  `GET /api/query?player=true&trcolumns=…`.
- **Volume is decibels** (`-100..0`), not a percentage, and `volume.type` says so --
  another player may report a linear range. `src/player/volume.js` squares the
  normalised distance from the top, which puts half the slider around -25 dB and
  three quarters around -6 dB instead of spending most of the travel on silence.
- **Playlist items have no ID.** Index is identity, so any mutation invalidates indices
  you were holding.
- **SSE is change-driven, not a ticker.** Long silences are normal; `position` alone never
  triggers a message.
- **The static server has no SPA fallback** — `/playlists/p2` is a 404. Use hash routing.

## Generality constraints

Things that vary between installs and must never be assumed:

| | |
|---|---|
| Which playlist is "the library" | An autoplaylist the user creates. Guide them through it on first run. Never assume `p1` — that is scratch space. |
| `permissions` | `changePlaylists`, `changeOutput`, `changeClientConfig` come from the player. Gate the UI on them — a read-only instance gets a read-only Jean, not buttons that 403. |
| `authRequired` | May be on. Support Basic auth and a credentials prompt. |
| `pathSeparator` | From `/api/browser/roots`. `\` on Windows, `/` elsewhere. |
| Library size | Anywhere from empty to 200k+. |
| Components | Detect, never require. |
| Player | foobar2000 or DeaDBeeF. |

CORS is off in beefweb by default, so Jean must be served same-origin — either by beefweb
itself, or through a dev proxy. See `README.md`.

## Code layout and conventions

```
src/
  api/        beefweb client -- every fetch to the player lives here
  app/        shell: App, Sidebar, CommandPalette, theme, hash routing
  hooks/      shared, generic (useDebounced, useMediaQuery, useStoredState, ...)
  keyboard/   keymap.js, useKeymap, ShortcutSheet
  player/     transport, seek bar, player state and mutations
  playlist/   the playlist view and everything it needs
  ui/         shared presentational pieces and DOM helpers
  styles/     tokens.css and base.css -- the only global CSS
```

**Styling is CSS Modules, colocated with the component.** The only global stylesheets
are `styles/tokens.css` (the palette and scale, as custom properties) and
`styles/base.css` (reset and a couple of utilities). That split is deliberate:
someone re-theming Jean should only ever need to edit ~30 lines of custom properties,
with no build step and no knowledge of our class names. Do not add global classes for
component styling.

**Keyboard bindings are declared in `keyboard/keymap.js` and nowhere else.**
`useKeymap(scope, handlers)` registers whatever that scope declares and has a handler
for, and `ShortcutSheet` renders the help overlay from the same array — so the
documented shortcuts cannot drift from the real ones. Adding a binding means adding a
row there and a handler; never call `useHotkey` directly in a component.

**Compare tag values loosely, display them exactly.** Tags drift in case and spacing
between files in the same album -- `5 Seconds Of Summer` and `5 Seconds of Summer` are
one artist. Anything comparing tags to decide what the user sees goes through
`sameTagValue()` in `playlist/fields.js`; anything rendering a value still shows the
original spelling. A strict `===` here makes a track look like a guest on its own
album, and splits one album into two groups mid-run.

**Comments explain why, not what.** No JSDoc. If a line needs a comment to say what it
does, rename something instead. The comments worth writing are the ones recording a
measurement, a trap, or a decision that looks wrong until you know the reason.

**Animation is compositor-only by default** — `transform`, `scale`, `rotate`,
`opacity`. `border-radius` and layout properties repaint every frame; that is
acceptable for a single small element and not for anything in a list. Continuous
motion should layer animations with coprime durations rather than repeat a single
short loop, and must never move an element's position on screen.

## Development

```sh
pnpm install
pnpm dev            # http://localhost:5173, proxies /api to the player
```

Vite proxies `/api` to a real player, so development runs against live playlists and live
playback with no deploy step and no CORS. Point it elsewhere with
`BEEFWEB_URL=http://host:8880 pnpm dev`. The dev server binds on the LAN, so a phone can
load it directly for real-device testing.

Deploying is only for making it permanent — see `README.md`.

**Stack:** React 19 · Vite 8 · TanStack Query 5 · TanStack Virtual · TanStack Hotkeys ·
lucide-react · CSS Modules · pnpm. No test setup yet.

**Built so far:** the app shell, both themes, and the playlist view (compact and album
layouts, heat/patina, the finder, column picker, keyboard navigation, transport with a
seekable progress bar). The home screen, library-wide search, selection actions, the
Web Worker and IndexedDB persistence are not built yet.
