# jean

Jean (/ʝan/) is a replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin,
controlling foobar2000 - and, best-effort, DeaDBeeF - from any browser on your
network. Namely affectively for the feelings it evoked on me when the idea came.

**Where it is:** the playlist view and library search work. Compact and album layouts
over a virtualised list that stays smooth at 30,000 tracks, search across the whole
library from the bar at the top — accents optional, `babasonicos` finds `Babasónicos` —
find-within-the-list-you-are-looking-at that jumps rather than filters, in every view
that shows tracks,
toggleable columns, full keyboard navigation, light and dark themes, and a transport
with a seekable progress bar. If your player reports play counts, tracks are shaded by
how often you have played them and faded by how long it has been; the flame in the
toolbar turns that off, and explains itself the first time you see it.

Playing from search results confines playback to them — shuffle shuffles your matches, and
the end of the results ends playback rather than wandering off into the library. The search
survives a reload and shows up on your other devices. Results can be kept as a real
playlist in one click, copied by index so nothing is uploaded but a list of numbers.

Playlists in the sidebar can be created, renamed, deleted and dragged into whatever
order you want them in. The `+` on the Playlists heading makes an empty one and puts
the cursor straight in its name. Right-click a playlist for the menu, or press and hold it on a phone,
where the same menu arrives as a sheet you can flick away. `Alt` with the arrow keys
moves a playlist without touching the mouse.

Drag tracks onto a playlist in the sidebar to add them, or right-click -- press and hold,
on a phone -- and pick one from the menu. Select several first and they all go in one go.
Whatever it does, it tells you, and gives you an undo.

Jean opens on **Home**, which starts by telling you what your library adds up to: how
long it would take to play it — *85 days 11 hr of music* — over how many tracks,
records, artists, genres and playlists, and which years it spans. Play it from the top
or shuffle the lot, from the two buttons beside it.

Under that, rows of albums drawn out of your own listening -- what you play most, what
you played to death and then put down, what you have never opened, and **what you play
constantly but only own as a bad rip**. Each card says why it is there. Click one and
the whole row plays, starting from that album; click the row's title to open it without
starting anything. The sidebar and the status bar both tell you what you are listening
to, which can be somewhere other than what you are looking at. **All music** is the
whole library, unfiltered, and plays like any other view.

Shelves that your library cannot support simply do not appear -- no ratings, no starred
shelf; no playback statistics, no play-history shelves at all -- and an install with
none of it still opens on a row of records to press. The same goes for the counts: a
library with no genre tags is not told it has none, it is simply not asked. Four songs
in a folder gets *1 album*, not *1 albums*.

On a phone the sidebar is a drawer, menus arrive as sheets you can flick away, the
volume fader is sized for a thumb rather than a mouse, and anything that only means
something with a keyboard attached is not shown at all.

**Not built yet:** a folder browser.

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

## Pointing Jean at your library

> **This step disappears on beefweb 0.11+**, which adds a real media library API.
> Jean asks the player first and only falls back to the autoplaylist below when the
> answer is no — on DeaDBeeF, or on any beefweb up to and including 0.10, which is
> the current release. Nothing here is wasted; it is just no longer the only route.
>
> On a player that has it, **searching reads the media library directly** and the
> autoplaylist is not involved. Browsing a playlist still browses that playlist:
> Jean never reinterprets one of your playlists as something else, so if you made a
> `Library` autoplaylist it stays exactly what it is.

beefweb has no library API — it can see **playlists and the filesystem, and nothing else**.
foobar2000's Media Library is invisible to it. So Jean needs a playlist that mirrors your
library, and the right kind is an **autoplaylist**: a live Media Library query that stays in
sync on its own.

In foobar2000: **Library → Search**, enter `ALL` as the query, and create an autoplaylist
from the result. Name it exactly:

```
#Jean Library
```

That playlist then contains every track in your Media Library, updates itself when you add
or remove music, and costs nothing to keep around.

**The name is how Jean knows the playlist is meant for it**, rather than one of yours — so
it has to match exactly, and Jean will not adopt a playlist merely called "Library". That
is deliberate: it used to, and a playlist of that name holding a dozen unrelated tracks
would quietly become "your library", with every count Jean reported after it wrong. If you
already have one from an earlier version, the search page offers to rename it for you.

Once it matches, **Jean keeps it out of your sidebar** — it is plumbing, not one of your
playlists. It stays fully visible in foobar2000, next to its own `#Quicksearch […]`.

If you would rather not create an autoplaylist, Jean can build a playlist from your music
folders instead. That mirrors what is on disk rather than what is in your library, and needs
a manual refresh when you add music.

## Installing it on a player

Jean is a static build. `pnpm build` produces a `dist/` folder holding an
`index.html` and one JS and one CSS file — about 108 KB over the wire, since beefweb
gzips. Copy those files anywhere the player can read, point beefweb at them, and
restart it.

**1. Build.**

```sh
pnpm build
```

**2. Copy `dist/` somewhere.** Any directory the player process can read. Inside the
beefweb profile directory is tidy, but nothing requires it. **Empty the target folder
first if you are replacing an older build** — asset filenames are content-hashed, so
old bundles accumulate rather than being overwritten.

**3. Point beefweb at it** in `config.json`, in the beefweb profile directory. Create
the file if it does not exist:

```json
{
  "urlMappings": {
    "/jean": "F:\\Music\\jean"
  }
}
```

> **The path must be absolute**, with backslashes escaped for JSON on Windows.
> Relative paths and the `webroot/` fallthrough described in beefweb's `master`
> documentation are **not in the current release (v0.10)** — a relative path there
> silently 404s.

**4. Restart the player.** `config.json` is read at startup, so nothing happens until
you do.

**5. Open `http://your-player-host:8880/jean/`** — or whatever port you have beefweb
set to. The trailing slash matters.

Jean then lives at `/jean` while the stock UI stays at `/`, so there is nothing to
uninstall and an instant fallback if something breaks.

### Finding the beefweb profile directory

| Setup | Location |
|---|---|
| foobar2000, Windows | `%APPDATA%\foobar2000-v2\beefweb\` |
| foobar2000, **portable install** | next to the executable — `<install dir>\profile\beefweb\`, *not* `%APPDATA%` |
| DeaDBeeF, Linux/BSD | `~/.config/deadbeef/beefweb/` |
| DeaDBeeF, macOS | `~/Library/Preferences/deadbeef/beefweb/` |

The portable case catches people out: a deploy to `%APPDATA%` there fails silently,
because the files copy fine and beefweb simply keeps serving the stock UI.

**There is no foobar2000 build of beefweb for macOS.** This table used to claim one,
at `~/Library/foobar2000-v2/beefweb/`, which looks right because it is where
foobar2000 keeps its Mac profile — but the released `.fb2k-component` carries
`foo_beefweb.dll` and `x64/foo_beefweb.dll` and nothing else. Checked by unzipping
it, after an afternoon spent asking whether the component could be developed
against a local foobar2000 on a Mac. It cannot: there would be no beefweb there to
serve it. DeaDBeeF on macOS is a different question and does work.

### You do not have to tell Jean your port

Every request Jean makes is a root-relative path — `/api/playlists`, never a full
URL. The browser resolves those against whatever origin served the page, and beefweb
serves both the UI and the API. So changing the port in the player's settings needs no
change here: open it on the new port and the API follows. The stock UI works the same
way, which is why beefweb has no way to tell a UI its own address.

The one arrangement this does not survive is hosting Jean somewhere *other* than
beefweb — a static host, or a separate box. There is no same-origin API then, and you
would need both a configurable base URL and `responseHeaders` set on the beefweb side
to allow CORS, which is off by default.

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

## API notes worth remembering

- **A request body over 1 MiB is refused by hanging up.** Measured: 1,018,757 bytes
  accepted, 1,049,652 closed the connection mid-upload, which reaches the browser as a
  network error rather than a status code. Naming 30,441 tracks is a 2.9 MB body, so
  "play everything" silently did nothing at all until Jean stopped naming them —
  `add-from-library` with no `items` means *the whole library*, in one request with no
  body, in 299 ms.
- **A set comes back in the player's order, not the order you asked for or the order
  you read it in.** `add-from-library` returns the media library's *browse* order —
  album artist, album, track — while `GET /library/items` pages by **file path**. Of
  1,000 tracks sent in path order, 426 land somewhere else. Nothing reproduces that
  order client-side, so Jean overwrites it instead: fill, then `POST items/sort` by the
  same expression the library was read with. Every position correct at 100, 1,000,
  4,000 and 30,441 tracks, for ~340 ms of the player's time and no state of Jean's own.
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
| **Recommended** | `foo_beefweb` **0.11+** | The media library, read directly instead of through an autoplaylist. Unreleased at the time of writing; Jean detects it and falls back cleanly |
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
| `/` | Find within the list — the library field, on the search page |
| `⌘K` | Search the library |
| `⌘S` | Save search results as a playlist |
| `⌘⇧P` | Go to playlist |
| `n` | Jump to what is playing |
| `v` | Switch compact / album layout |
| `t` | Switch light / dark |
| `⌘B` | Show / hide the sidebar |

## Stack

React 19 · Vite 8 · TanStack Query 5 · TanStack Virtual · TanStack Hotkeys ·
lucide-react · CSS Modules · pnpm · Playwright. No unit tests and no jsdom, on
purpose: the things that break here need real layout, real pointers and a real
viewport. See `test/README.md`.

Styling is CSS Modules per component, with the palette in `src/styles/tokens.css` as
custom properties — re-theming Jean means editing about thirty values there, with no
build step required to know what they do.
