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

## Look it up before you draw it

**Every piece of UI gets a reference pass before it gets written.** Search for how good
products solve the same problem, then decide. Worth having in the rotation: **Mobbin**,
**Refero**, **Screenlane**, **UI Sources**, **Godly**, **Awwwards**, **Land-book**,
**Dribbble**, **Behance**, **DeviantArt**, **Pinterest**. Naming the component and the
platform is usually enough of a query -- "action sheet mobile", "context menu desktop
dark", "sidebar drag reorder".

The point is not to copy. It is that the shape a component takes when you write it from
memory is the median of everything you have ever seen, and the median is exactly what
makes an interface look templated. Look at several, take the one decision from each that
is actually good, and know what you rejected.

Two standing rules fall out of it:

- **Never look like Spotify.** It is the obvious reference for a music player and
  therefore the one place Jean has nothing to gain by resembling. If a screen could be
  mistaken for it, redraw it.
- **Record the choice.** A comment saying "this is an action sheet, not a bottom sheet,
  because ..." is worth more than the code under it. Vocabulary is a design decision --
  the two are different components and only one of them is detached from the edges.

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

**Adding tracks to a playlist does not check for duplicates.** foobar2000 playlists are
ordered lists, not sets; the player appends without comment, and Jean inventing a
uniqueness rule the player does not have would be Jean lying about the data. There is no
cheap check available either -- items have no id, so identity is `%path%`, and reading
it is a request of its own before the drop could land.

**Undo instead, as the general rule for anything that writes.** Because tracks are
appended, the indices just created are exactly `[itemCount, itemCount + n)`, and
`itemCount` is already in `PlaylistInfo` -- so undo costs no extra request and needs no
path matching. Re-read `itemCount` before undoing and abandon it if it no longer
matches: the desktop may have changed the playlist underneath, and removing the wrong
rows is far worse than not offering the undo.

**Confirm only what is not already visible.** Creating a playlist needs no notification
-- the row appears, named, waiting to be renamed. Adding forty tracks to a playlist you
are not looking at does, and that is what a toast is for; it is also where the undo
lives. A message about something already on screen is noise.

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

- **Fetch in chunks** (`offset:count`), but count the requests, not the rows. Measured
  since: a request costs ~270 ms before it returns anything and only ~30 ms more to return
  2,000 rows instead of 500, so sixteen sequential chunks of 2,000 took 5.5 s where one
  small chunk followed by four concurrent large ones paints at ~730 ms and finishes in
  ~1.5 s. Chunk for **time to first paint**, then go wide, and never issue many small
  sequential requests.
- **One load, shared.** The library has more than one consumer — the playlist view and
  search — and neither may fetch its own copy. `playlist/playlistStore.js` owns it.
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

### Menus, gestures and other shared behaviour

`ui/ActionMenu.jsx` is the only menu surface in the app. Actions are declared as **data**
and the surface decides how to draw them -- a popover at the pointer on a desktop
viewport, a floating action sheet on a compact one. Adding a menu anywhere means writing
an array, not another component.

- **An action sheet, not a bottom sheet.** Detached from every edge, all four corners
  rounded, floating above the safe-area inset. The edge-to-edge kind is Spotify's, and is
  also the less interesting of the two.
- **Nested pages slide in place, on desktop too**, rather than flying out to the side. A
  flyout that closes when the pointer strays is the wrong place to put a confirmation,
  and one drill-in implementation beats two half-tested ones. **Destructive actions
  confirm on a nested page** -- same machinery, no dialog component, identical on both
  surfaces.
- **A nested page can be typed at.** `filter: '<placeholder>'` on a submenu node puts a
  field at the top of its page, pinned rather than scrolling away with the list it
  filters; Enter takes the first match. It matches through the same `fold()` the library
  search uses, so typing at a menu behaves like typing at the search field.
- **A sheet with a field in it has to follow the visual viewport.** A `position: fixed`
  element is laid out against the *layout* viewport, which neither platform shrinks for
  the keyboard -- iOS does not resize it at all and Chrome defaults to
  `interactive-widget=resizes-visual` -- so a bottom-anchored sheet puts its own field
  under the keyboard the moment you tap it. `ui/useVisualViewport.js` sizes the scrim to
  `visualViewport`, which makes "above the keyboard" fall out of the existing
  `align-items: flex-end`, and follows `offsetTop` as well, because iOS scrolls the page
  to reveal a focused field. It writes to the element, not to state: iOS fires a stream
  of these while the keyboard animates.
- **The field takes focus on the popover and waits to be tapped on the sheet.** Most opens
  of a menu are scroll-and-tap, and those should never cost half the screen.
- **`touch-action: none` intersects down the tree.** It was on the sheet's scrim and would
  have left a long list unscrollable on touch. It was never needed either: the scrim
  portals to `<body>`, which has nothing to scroll.
- **The accent budget of a menu is the two-pixel rail on the item under the cursor.**
  Scaled, not faded, so it grows out of its own centre.
- **`useContextMenu` unifies the three ways of asking for one**: right-click,
  press-and-hold, and the Menu key -- which reports no coordinates, so a keyboard
  invocation has to anchor to the element rather than to `0,0`.
- **`useLongPress` owns the echoes of the gesture, not just the gesture.** The synthetic
  click and, on Android, a native `contextmenu` both arrive after a hold has already been
  answered, and both have to be swallowed. Suppression is time-boxed rather than cleared
  by whichever event turns up, because which one turns up differs by platform: iOS sends
  the click and no contextmenu, Android the reverse, and waiting for a specific one
  leaves the guard permanently on.
- Anything long-pressable needs `-webkit-touch-callout: none` or iOS draws its own
  selection callout over the menu. `useLongPress` returns the style to spread.
- **While a menu is open, no key belongs to the app behind it.** Without stopping
  propagation, the arrow keys seek the player while you are choosing an action.
- **An exit animation's "closing" flag must be derived during render, not set in an
  effect.** An effect leaves one commit in which the menu is neither open nor leaving:
  it unmounts, the effect brings it straight back to play the exit, and that remount
  re-runs the surface's focus effect. Anything the chosen action just focused loses it —
  which is how Rename came to close itself on the phone, one frame after opening.
- **A menu returns focus only if it still has it.** An action is allowed to send focus
  somewhere on purpose; restoring blindly on close undoes that.

`ui/useSortableList.js` is drag-to-reorder for lists short enough to see at once. Rows
are measured on drag start, so variable heights need no special case. What is
load-bearing:

- **The drop is held, not cleared.** The reorder goes through the query cache, which is a
  microtask away at best, so clearing the transforms on `pointerup` flicks the row back
  to where it started for a frame. It keeps the landing transform until the caller's
  `keys` actually change, with a timeout in case the player refuses the move.
- **On a pointer the row itself drags, with no affordance at all.** That is what a
  sidebar of links does everywhere -- Finder favourites, Chrome bookmarks, Slack
  sections -- and a grip on every row is a permanent cost for something done twice a
  year. Grips are an *editor* idiom: they exist where a row has several parts and one of
  them has to be named as the one that drags.
- **Touch is a different question, not a smaller one.** There the vertical axis is
  already the scroller's, and the gesture that would normally settle it -- hold, then
  drag -- is spent on the menu. So a coarse pointer gets a permanent handle, because
  nothing else can claim the axis. Same fact, stated once in CSS and once in JS: the row
  starts a drag for `pointerType === 'mouse'` only.
- **A drag that starts on a link ends with a click on that link.** Reordering would also
  navigate. The gesture has to swallow its own click, exactly as the long press does --
  and the flag is cleared on the next pointer-down rather than on a timer, so a gesture
  that produced no click leaves nothing armed.
- **`setPointerCapture` moves the click, not just the pointer events.** It retargets the
  compatibility `mousedown` and `mouseup` too, and `click` is dispatched at the common
  ancestor of those two -- so capturing on a row makes every click land on the row
  instead of on the button inside it, and plain navigation silently stops working with
  no error anywhere. Capture only once the gesture is definitely a drag. A small handle
  is the exception and has to claim the pointer up front, because it can be left behind
  inside the threshold distance; a full-width row cannot.
- **Two behaviours on one element share their handler names.** A row that both
  press-and-holds and drags wants `onPointerDown/Move/Up/Cancel` twice over, and
  spreading one props object after the other drops the first silently. Compose them
  through `ui/mergeHandlers.js`.
- `Alt+Arrow` does the same from the keyboard, registered only while a row has focus.

### Dragging across containers

`ui/dnd.js` is the other drag primitive, and it is deliberately *not* built on
`useSortableList`. That one reorders a single list, where the dragged element stays
mounted and the drop position is arithmetic. Dragging tracks onto a sidebar playlist is a
different problem: the source row can be unmounted by the virtualiser mid-gesture, and
the target is elsewhere in the tree entirely. So the drop is decided by hit-testing the
document (`elementFromPoint` up to a `[data-drop-target]`), and what follows the pointer
is a ghost rather than the row.

- **No pointer capture, here of all places.** Capture retargets every later event to the
  capturing element, so a handler on a *descendant* of it never fires again -- and the
  natural capture element is the scroll container, which is an ancestor of the rows.
  Window listeners for the length of the gesture have none of that ambiguity.
- **The store carries only coarse facts** -- dragging or not, which target is armed.
  Those change rarely, so subscribing is free, and the track list does not subscribe at
  all. It must never re-render during a drag.
- **The ghost is moved imperatively**, because position is the one thing that changes
  every frame. It is two elements: a CSS animation beats an inline style, so an entrance
  touching `transform` would override the position and the ghost would fly in from the
  top-left. Outer element owns position, inner owns anything that animates.
- **Pressing inside a multi-track selection must not collapse it on pointer-down.** That
  decision waits for the release -- otherwise the selection is gone before the pointer has
  moved a pixel and a multi-track drag cannot exist. Every file manager does this.
- Hit-testing runs on a frame rather than on the move event, so a target that autoscrolls
  under a stationary pointer still arms.
- Drag is mouse-only, and the mobile path is the menu. There is nothing to drag onto on a
  phone: the sidebar is a drawer that covers the list it would be dragged from.

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

**Context menus come from `ui/ActionMenu.jsx`, as an array of actions.** Never hand-roll
a popover, an action sheet or a confirmation dialog -- the gestures, the keyboard
handling, the nested pages and both surfaces already exist there, and a second
implementation of any of them will be the one that is wrong on a phone. `ui/Menu.jsx` is
a different thing and stays: a dropdown anchored under a button you can see, which needs
none of that. Menu *you asked for* against menu *you summoned*.

**Notifications come from `ui/toasts.js`, and only for things you cannot see.** Pushing
one is a bare function call from anywhere, deliberately -- it is a module-level store
rather than a context because a provider holding the list would re-render the virtualised
track list every time a toast appeared or expired.

**Keyboard bindings are declared in `keyboard/keymap.js` and nowhere else.**
`useKeymap(scope, handlers)` registers whatever that scope declares and has a handler
for, and `ShortcutSheet` renders the help overlay from the same array — so the
documented shortcuts cannot drift from the real ones. Adding a binding means adding a
row there and a handler; never call `useHotkey` directly in a component.

**Anything the user types at a list is matched through `fold()` in `ui/text.js`**, which
lowercases and strips diacritics, so `babasonicos` finds `Babasónicos`. Requiring people
to type the accents in their own library taxes exactly the tracks they are most likely
to be hunting for, and from outside it does not look strict, it looks broken. Fold when
the haystack is *built*, never per keystroke: measured over 30,441 rows, folding the
whole index costs ~6 ms against the ~0.6 ms a plain lowercase took, and a search is still
one `includes()`. Both sides have to go through it -- fold the query too, or an accented
query stops matching the folded index.

**Compare tag values loosely, display them exactly.** Tags drift in case and spacing
between files in the same album -- `5 Seconds Of Summer` and `5 Seconds of Summer` are
one artist. Anything comparing tags to decide what the user sees goes through
`sameTagValue()` in `playlist/fields.js`; anything rendering a value still shows the
original spelling. A strict `===` here makes a track look like a guest on its own
album, and splits one album into two groups mid-run.

**Never gate behaviour on a `mounted` ref set only in an effect cleanup.**
StrictMode mounts, unmounts and remounts in development, so the cleanup sets the
flag false and nothing sets it back -- the guard is then permanently on, in dev
only, and silently disables whatever it protects. If a guard is genuinely needed,
set it true in the effect body as well. Usually it is not needed: work that only
touches refs and network calls is safe to finish after unmount, and finishing it
is often the correct behaviour.

**Writes driven by a drag must be coalesced, not fired per event.** One pointer
gesture is ~40 pointer moves; a request each floods the player, and the responses
can land out of order so the last value to arrive wins rather than the last one
sent. `useCoalescedWrite` keeps one request in flight and sends the newest value
after it. Drag state stays local to the control -- writing it into shared player
state on every move re-renders every subscriber, including the virtualised list,
for the whole gesture.

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

**Built so far:** the app shell, both themes, the playlist view (compact and album
layouts, heat/patina, the finder, column picker, keyboard navigation, transport with a
seekable progress bar), and library-wide search — a persistent field bound to `⌘K`, its
own `#/search` route with a sidebar entry, and per-view scroll and cursor memory so
leaving a result set and coming back returns you to where you were. The shared list
machinery both views render through is `playlist/TrackBrowser.jsx`, and `indices` is how
a filtered view maps a row back to the playlist index the player addresses.
Tracks can be added to another playlist by dragging them onto it in the sidebar, or from
a context menu on the rows -- both selection aware, so a multi-track selection copies in
one `items/copy` request, and both leaving an undo in the toast that follows. Playlists themselves can be created, renamed, deleted and
reordered from the sidebar: a
`+` on the section heading that makes an empty one and drops it straight into rename, an
action menu on secondary-click or press-and-hold, inline renaming in the row itself,
delete behind a confirmation page, and drag-to-reorder through
`/playlists/move/{id}/{index}`.
Results can also be saved as a real playlist -- `/playlists/add` returns the new id and
`/playlists/{src}/{dst}/items/copy` copies by index, so no `%path%` is ever fetched -- gated
on `permissions.changePlaylists` and on the library having finished loading. The home
screen, the Web Worker and IndexedDB persistence are not built yet.
