# Jean

Jean (/ʝan/) is a replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin. It controls foobar2000 — and, best-effort, DeaDBeeF — from any browser on the network.

**[Try it](https://enrique-ramirez.github.io/jean/)**: the whole app, running against a library and a player that live in your browser. Nothing to install, nothing plays.

## What it does

- **Browse** playlists and the whole library, in a compact list or grouped by album, over a virtualised view that stays smooth at 30,000 tracks.
- **Search** the library from the bar at the top, accent-insensitively — `babasonicos` finds `Babasónicos`. Playing from the results confines playback to them. A search survives a reload and is visible on your other devices, and results can be kept as a real playlist in one click.
- **Find within** the list already on screen, which jumps to a track rather than filtering the list away.
- **Home** opens on what the library adds up to — total duration, tracks, records, artists, genres and the years it spans — followed by shelves drawn from play counts: most played, recently played, records you played to death and put down, records you have never opened, and records you play constantly but only own as a bad rip.
- **What's playing** — tap the cover in the bottom bar for large artwork, the rating, and tabs for **Lyrics**, **Details** and **Artist**. Lyrics come from your own files and scroll in time when they carry LRC timestamps; tap a line to seek there. Details lists what that file actually holds and omits what it does not.
- **Ratings** are read from tags, and writable when `foo_jean` is installed.
- **Playlists** can be created, renamed, deleted and dragged into order. Drag tracks onto one to add them, or use the context menu. Every write is confirmed with an undo.
- **Listen on this device** — with `foo_jean` installed, play what the player is playing in this browser. Choosing a device *moves* the sound: the player is muted while you listen, and gets it back when you stop. The picker names the other devices listening, and can put the player's speakers back on alongside them.
- **Genres** get an index of their own: every genre in the library, found by typing, and each one a filter over what you already have. With `foo_jean` installed a genre can also become an autoplaylist the player keeps filled.
- **Play queue**, drawn as a timetable: each row says when it will play.
- **Themes**, light and dark, and full keyboard control on desktop.

Anything the library cannot support is not drawn. No ratings means no starred shelf; no playback statistics means no play-history shelves at all; a library with no genre tags is not told it has none.

On a phone the sidebar is a drawer, menus arrive as sheets, the volume fader is sized for a thumb, and anything that only means something with a keyboard attached is hidden.

## Components

Jean requires **one** component. Everything else is detected at runtime and stays hidden when absent — a bare beefweb install gets a complete app.

| | Component | What it gives you |
|---|---|---|
| **Required** | [`foo_beefweb`](https://github.com/hyperblast/beefweb) | Playback, playlists, the play queue, outputs, artwork, filesystem browsing |
| **Recommended** | `foo_beefweb` **0.11+** | The media library, read directly instead of through an autoplaylist |
| **Optional** | `foo_enhanced_playcount` *or* `foo_playcount` | Play counts and first/last played, which drive the play-history shelves |
| **Optional** | [`foo_jean`](https://github.com/enrique-ramirez/foo_jean) | Writing tags back — today that is ratings, so without it the stars are read-only. Making an autoplaylist from a genre, and marking which playlists the player fills itself, neither of which beefweb can express. And listening on this device: a control beside the volume plays what the player is playing, in this browser, muting the player so the sound moves rather than doubling. It also names who else is listening, and — where Jean is served over HTTPS — puts the track on the lock screen, the media keys and the Bluetooth buttons while the sound is here |
| **Optional** | any component publishing title-formatting fields | Auto-detected. Jean probes the fields it knows about and enables whatever resolves |

Some features need no component, because they read tags the files already carry: **lyrics**, from the `UNSYNCED LYRICS` tag ([`foo_openlyrics`](https://github.com/jacquesh/foo_openlyrics) is a good way to populate it; Jean only reads it), plus ratings, ReplayGain, composer, publisher, ISRC and all standard metadata.

## Pointing Jean at your library

**On beefweb 0.11+ this step does not apply.** That release has a media library API; Jean asks the player first and falls back to the autoplaylist below only when the answer is no — on DeaDBeeF, or on beefweb 0.10 and earlier.

beefweb 0.10 has no library API: it sees **playlists and the filesystem, and nothing else**. So Jean needs a playlist that mirrors the library, and the right kind is an **autoplaylist** — a live Media Library query that stays in sync on its own.

In foobar2000: **Library → Search**, enter `ALL` as the query, and create an autoplaylist from the result. Name it exactly:

```
#Jean Library
```

**The name is how Jean knows the playlist is meant for it**, so it must match exactly. Jean will not adopt a playlist merely called `Library`. Once it matches, Jean keeps it out of its own sidebar; it stays fully visible in foobar2000.

Browsing a playlist still browses that playlist. Jean never reinterprets one of your playlists as something else.

If you would rather not create an autoplaylist, Jean can build a playlist from your music folders instead. That mirrors what is on disk rather than what is in the library, and needs a manual refresh when you add music.

## Installing it on a player

Jean is a static build. `pnpm build` produces a `dist/` folder holding an `index.html` and one JS and one CSS file. Copy those where the player can read them, point beefweb at them, and restart it.

**1. Build.**

```sh
pnpm build
```

**2. Copy `dist/` somewhere** the player process can read. **Empty the target folder first if you are replacing an older build** — asset filenames are content-hashed, so old bundles accumulate rather than being overwritten.

**3. Point beefweb at it** in `config.json`, in the beefweb profile directory. Create the file if it does not exist:

```json
{
  "urlMappings": {
    "/jean": "F:\\Music\\jean"
  }
}
```

**The path must be absolute**, with backslashes escaped for JSON on Windows. Relative paths and the `webroot/` fallthrough documented on beefweb's `master` branch are not in release 0.10; a relative path there silently 404s.

**4. Restart the player.** `config.json` is read at startup.

**5. Open `http://<player-host>:8880/jean/`**, or whatever port beefweb is set to. The trailing slash matters.

Jean then lives at `/jean` while the stock UI stays at `/`, so there is nothing to uninstall and an instant fallback if something breaks.

### The beefweb profile directory

| Setup | Location |
|---|---|
| foobar2000, Windows | `%APPDATA%\foobar2000-v2\beefweb\` |
| foobar2000, **portable install** | next to the executable — `<install dir>\profile\beefweb\`, *not* `%APPDATA%` |
| DeaDBeeF, Linux/BSD | `~/.config/deadbeef/beefweb/` |
| DeaDBeeF, macOS | `~/Library/Preferences/deadbeef/beefweb/` |

The portable case catches people out: a deploy to `%APPDATA%` there fails silently, because the files copy fine and beefweb keeps serving the stock UI.

**There is no foobar2000 build of beefweb for macOS.** The released `.fb2k-component` carries `foo_beefweb.dll` and `x64/foo_beefweb.dll` and nothing else. DeaDBeeF on macOS is a different question and does work.

### You do not have to tell Jean your port

Every request Jean makes is a root-relative path — `/api/playlists`, never a full URL — and the browser resolves those against whatever origin served the page. Changing the port in the player's settings needs no change here.

The one arrangement this does not survive is hosting Jean somewhere *other* than beefweb. There is no same-origin API then, and it would need both a configurable base URL and `responseHeaders` set on the beefweb side to allow CORS, which is off by default.

## Keyboard

Everything is reachable from the keyboard on desktop, and `?` lists the lot — that overlay is generated from the same table that registers the bindings, so it cannot go stale. The short version:

| | |
|---|---|
| `Space` | Play / pause |
| `←` `→` | Seek ∓5 seconds |
| `⌘←` `⌘→` | Previous / next track |
| `⌘.` | Stop |
| `=` `-` | Volume up / down |
| `m` | Mute |
| `0`–`5` | Rate the cursor row, or the playing track |
| `↑` `↓` | Move through the list |
| `Enter` | Play the selected track |
| `/` | Find within the list |
| `⌘K` | Search the library |
| `⌘S` | Save search results as a playlist |
| `g` | Go to playlist |
| `n` | Jump to what is playing |
| `s` | Shuffle play |
| `v` | Switch compact / album layout |
| `h` | Show / hide play-count heat |
| `t` | Switch light / dark |
| `⌘B` | Show / hide the sidebar |
| `q` | Show / hide the queue |
| `w` | Show / hide what's playing |
| `⌘,` | Settings |

## Working on Jean

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development loop, the layout of the code and the conventions. [API.md](./API.md) is the reference for the beefweb surface Jean is built on.
