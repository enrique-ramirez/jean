# jean

Jean (/ʝan/) is a replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin,
controlling foobar2000 - and, best-effort, DeaDBeeF - from any browser on your
network. Namely affectively for the feelings it evoked on me when the idea came.

Jean shows your playlists and your whole library, in a compact list or grouped by
album, over a virtualised view that stays smooth at 30,000 tracks. Search the library
from the bar at the top -- accents optional, `babasonicos` finds `Babasónicos` -- or
find a track inside the list you are already looking at, which jumps to it rather than
filtering it away. Columns are yours to pick, everything is reachable from the
keyboard, and there is a light theme and a dark one.

If your player reports play counts, tracks are shaded by how often you have played
them and faded by how long it has been. The flame in the toolbar turns that off, and
explains itself the first time you see it.

Jean opens on **Home**, which starts with what your library adds up to: how long it
would take to play -- *85 days 11 hr of music* -- over how many tracks, records,
artists, genres and playlists, and the years it spans. Play it from the top or shuffle
the lot from the two buttons beside it.

Under that, rows of albums drawn out of your own listening -- what you play most, what
you played to death and then put down, what you have never opened, and what you play
constantly but only own as a bad rip. Each card says why it is there. Click one and
the whole row plays, starting from that album; click the row's title to open it
without starting anything. **All music** is the whole library, unfiltered.

Tap the cover in the bar at the bottom -- on a phone or a desktop -- and Jean opens
**what's playing**: the artwork large, the rating, and tabs for **Lyrics**, **Details**
and **Artist**. Lyrics come out of your own files and scroll in time with the track when
they carry LRC timestamps; tap any line to jump there. Details lists what *that file*
actually holds -- publisher, composer, disc, bitrate, sample rate, ReplayGain -- and
leaves out what it does not, so it is never a grid of empty cells. On a phone this is
where previous, next, shuffle, the queue and the rating live, at a size you can hit;
the bar itself keeps only volume and a big Play, with Play nearest your thumb.

**Artist** is the one thing in Jean that talks to the internet, so it is switched off
until you turn it on in Settings. On, it asks MusicBrainz and Wikipedia for a short
biography -- no account and no key, but it does mean telling them what you are playing.

Shelves your library cannot support do not appear -- no ratings, no starred shelf; no
playback statistics, no play-history shelves at all -- and an install with none of it
still opens on a row of records to press. The same goes for the counts: a library with
no genre tags is not told it has none, it is simply not asked. Four songs in a folder
gets *1 album*, not *1 albums*.

Playing from search results confines playback to them -- shuffle shuffles your matches,
and the end of the results ends playback rather than wandering off into the library.
The search survives a reload and shows up on your other devices, and results can be
kept as a real playlist in one click.

Playlists in the sidebar can be created, renamed, deleted and dragged into whatever
order you want. The `+` on the Playlists heading makes an empty one and puts the cursor
straight in its name. Right-click one for the menu, or press and hold it on a phone.
`Alt` with the arrow keys moves a playlist without touching the mouse.

Drag tracks onto a playlist to add them, or right-click and pick one from the menu.
Select several first and they all go in one go. Whatever it does, it tells you, and
gives you an undo.

On a phone the sidebar is a drawer, menus arrive as sheets you can flick away, the
volume fader is sized for a thumb rather than a mouse, and anything that only means
something with a keyboard attached is not shown at all.

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

## Components

Jean needs **one** component. Everything else is detected at runtime and simply stays hidden
if it is not there — a bare beefweb install still gets a complete app.

| | Component | What it gives you |
|---|---|---|
| **Required** | [`foo_beefweb`](https://github.com/hyperblast/beefweb) | Everything core: playback, playlists, the play queue, outputs, artwork, filesystem browsing, search |
| **Recommended** | `foo_beefweb` **0.11+** | The media library, read directly instead of through an autoplaylist. Unreleased at the time of writing; Jean detects it and falls back cleanly |
| **Optional** | `foo_enhanced_playcount` *or* `foo_playcount` | Play counts and first/last played, which drive the Most Played, Recently Played and "haven't heard since" shelves |
| **Optional** | [`foo_jean`](https://github.com/enrique-ramirez/foo_jean) | Two things beefweb cannot do. **Writing tags back** -- today that is ratings, so without it the stars are read-only. And **listening on this device**: a control beside the volume moves the sound out of the player and into whatever browser you are holding, and hands it back when you are done |
| **Optional** | any component publishing title-formatting fields | Auto-detected. Jean probes the fields it knows about and enables whatever resolves |

**Some features need no component at all**, because they read tags your files already carry:

- **Lyrics**, from the `UNSYNCED LYRICS` tag — including LRC-timestamped lyrics that scroll
  in time with playback, and where every line is a place you can seek to.
  [`foo_openlyrics`](https://github.com/jacquesh/foo_openlyrics) is a good way to
  *populate* that tag; Jean only reads it, and says so when a track has none.
- Ratings, ReplayGain, composer, publisher, ISRC, and all standard metadata. *Reading*
  them needs nothing; writing a rating back is the one thing that needs `foo_jean`.

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
| `q` | Show / hide the queue |
| `w` | Show / hide what's playing |

## Working on Jean

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development loop, the layout of the
code and the conventions. [API.md](./API.md) documents the beefweb surface Jean is
built on -- measured response shapes, and what is and is not reachable.
