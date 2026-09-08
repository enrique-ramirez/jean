# Jean

Jean (/ʝan/) is a replacement web UI for the [beefweb](https://github.com/hyperblast/beefweb) plugin. It drives foobar2000, and DeaDBeeF as best it can, from any browser on your network. Your library, on the phone in your pocket, without a subscription or an account or a company in the middle.

**[Try it](https://enrique-ramirez.github.io/jean/)**: the whole app, running against a library and a player that live entirely in your browser tab. Nothing to install. Nothing actually plays.

## What it does

- **Browses** your playlists and your whole library, as a list or grouped by album, over a virtualised view that does not care how many tracks you own.
- **Searches** without making you find the accents. `babasonicos` finds `Babasónicos`. Play from the results and playback stays in them. Keep them as a playlist in one click, or leave them: a search lives on the player, so it survives a reload and shows up on your other devices.
- **Finds within** whatever list is on screen and jumps you there, rather than hiding everything else.
- **Opens on what you own**: the hours, the records, the artists, the years it spans, then shelves built out of your play counts. Most played. Your favourites. Records you played to death and put down. Records you play constantly and only own as a bad rip. Records you have never once opened.
- **Shows what's playing** properly: big artwork, the rating, and tabs for lyrics, the tags the file actually carries, and who the artist is. Lyrics scroll in time when they carry LRC timestamps, and tapping a line seeks there.
- **Writes ratings back to your tags**, with `foo_jean` installed. Without it the stars are read-only.
- **Manages playlists**: create, rename, reorder by dragging, drop tracks in from anywhere. Adding tracks comes with an undo; deleting a playlist asks first.
- **Moves the sound to you.** With `foo_jean`, a control beside the volume plays what the player is playing, here, in this browser, and mutes the player so the sound moves rather than doubles. It names who else is listening and can put the speakers back on alongside everyone.
- **Indexes your genres**, all of them, found by typing, and turns any of them into an autoplaylist the player keeps filled.
- **Draws the play queue as a timetable**, so every row says when it will play.

Light and dark, both actually designed. English and Spanish, with any other language a JSON file away. Full keyboard control on desktop. On a phone the sidebar is a drawer, menus arrive as sheets, the volume fader is sized for a thumb, and anything that only means something with a keyboard attached is not there.

Anything your library cannot support is not drawn. No ratings, no starred shelf. No playback statistics, no play-history shelves at all. A library with no genre tags does not get told it has none.

## What you need

**One component.** Everything else is detected at runtime and stays out of sight when it is absent, so a bare beefweb install gets a complete app rather than a screen full of dead buttons.

| | Component | What it buys you |
|---|---|---|
| **Required** | [`foo_beefweb`](https://github.com/hyperblast/beefweb) | Playback, playlists, the play queue, outputs, artwork, filesystem browsing |
| **Recommended** | `foo_beefweb` **0.11+** | The media library, read directly rather than through an autoplaylist. Skips the setup step below entirely |
| **Optional** | `foo_enhanced_playcount` *or* `foo_playcount` | Play counts and last-played dates, which are what the play-history shelves are made of |
| **Optional** | [`foo_jean`](https://github.com/enrique-ramirez/foo_jean) | Writing ratings back to your tags. Turning a genre into an autoplaylist, and knowing which playlists the player fills itself, neither of which beefweb can express. And listening on this device, with the roster of who else is, plus the track on your lock screen and media keys wherever Jean is served over HTTPS |
| **Optional** | anything that publishes title-formatting fields | Jean probes for the fields it knows and turns on whatever answers |

Some of the good parts need nothing at all, since they read tags your files already carry: **lyrics**, from the `UNSYNCED LYRICS` tag ([`foo_openlyrics`](https://github.com/jacquesh/foo_openlyrics) is a good way to fill it; Jean only reads it), plus ratings, ReplayGain, composer, publisher and the rest of the standard metadata.

## Point it at your library

**On beefweb 0.11+, skip this.** That release has a media library API, Jean asks for it first, and there is nothing to set up.

Earlier releases have no library API at all: beefweb sees playlists and the filesystem and nothing else. So Jean needs a playlist that mirrors the library, and the right kind is an **autoplaylist**: a live Media Library query that keeps itself in sync.

In foobar2000: **Library → Search**, enter `ALL` as the query, and save the result as an autoplaylist. Name it exactly this:

```
#Jean Library
```

The name is how Jean knows the playlist is meant for it, so it has to match. If you already have one called `Library`, Jean will spot it and offer to rename it for you. Once it matches, Jean keeps it out of its own sidebar. It stays visible in foobar2000, where you can ignore it. Every other playlist stays yours; Jean never quietly reinterprets one as something else.

## Put it on your player

Jean is a static build. `pnpm build` produces a `dist/` folder: an `index.html`, a favicon, a `locales/` folder and an `assets/` folder with one JS and one CSS file. Copy it where the player can read it, point beefweb at it, restart.

**1. Build.**

```sh
pnpm install
pnpm build
```

**2. Copy `dist/` somewhere the player process can read.** **Empty `assets/` first if you are replacing an older build.** Asset filenames are content-hashed, so old bundles pile up rather than being overwritten. Empty the *whole* folder only if you have not written a translation of your own; `locales/custom.json` is yours and nothing else replaces it.

**3. Point beefweb at it** in `config.json`, in the beefweb profile directory. Create the file if it is not there:

```json
{
  "urlMappings": {
    "/jean": "C:\\Music\\jean"
  }
}
```

**The path must be absolute**, with backslashes escaped for JSON on Windows. Relative paths and the `webroot/` fallthrough documented on beefweb's `master` branch are not in release 0.10, where a relative path silently 404s.

**4. Restart the player.** `config.json` is read at startup and never again.

**5. Open `http://<player-host>:8880/jean/`**, or whatever port beefweb is set to. The trailing slash matters.

Jean then lives at `/jean` while the stock UI stays at `/`. Nothing to uninstall, and an instant fallback if you hate it.

### Where the beefweb profile directory is

| Setup | Location |
|---|---|
| foobar2000, Windows | `%APPDATA%\foobar2000-v2\beefweb\` |
| foobar2000, **portable install** | next to the executable, at `<install dir>\profile\beefweb\` rather than `%APPDATA%` |
| DeaDBeeF, Linux/BSD | `~/.config/deadbeef/beefweb/` |
| DeaDBeeF, macOS | `~/Library/Preferences/deadbeef/beefweb/` |

The portable case catches people out. A deploy to `%APPDATA%` there fails silently: the files copy fine and beefweb goes on serving the stock UI.

**There is no foobar2000 build of beefweb for macOS.** The released component carries Windows binaries and nothing else. DeaDBeeF on macOS is a different question, and does work.

### You do not have to tell Jean your port

Jean asks beefweb for everything by a root-relative path, which the browser resolves against whatever origin served the page. Change the port in the player's settings and nothing here needs touching. The one arrangement this does not survive is hosting Jean somewhere *other* than beefweb. There is no same-origin API then, and beefweb has CORS off by default.

## Language

Jean ships in English, with a Spanish translation beside it. Pick one under **Settings → Language**; with nothing picked it follows the browser, so a phone set to Spanish opens in Spanish without anyone configuring it. Dates, figures and sort order follow whatever is chosen, not the browser.

### Translating it yourself

The languages live in `locales/`, beside `index.html`, one JSON file per language named after its code: `en.json`, `es.json`, `fr.json`. Copy one, translate the right-hand side of each line, and leave anything in `{braces}` alone: those are filled in at runtime, and a field renamed shows up as `{prot}` on screen.

Then tell Jean the file is there. It cannot look: beefweb's static server publishes no directory listing, and its file browser refuses anything outside your music folders. So name the code in `locales/custom.json`, which is a plain list and is the one file here that is yours:

```json
["fr", "pt-BR"]
```

A phrase your file does not carry falls back to English, so a half-finished translation works from the first line, and one written for an older release of Jean goes on working. Settings names how many phrases are missing. `en.json` is written by the build as the file to copy; English is built into Jean, so editing it changes nothing.

**Names outside Jean stay in their own language.** `Library → Search`, the `File → Preferences → Tools → Jean` pane, foo_jean's own labels: those are things to find on a foobar2000 screen that is in English whatever Jean is showing, and translating them sends people looking for a menu that is not there.

A translation you would like shipped is welcome as a pull request. Put it in `public/locales/` and `pnpm test:unit` will check it against the catalogue.

## Keyboard

Everything is reachable from the keyboard on desktop, and `?` shows you what is bound. That overlay is generated from the same table that registers the bindings, so it cannot drift. **`Cmd` on macOS, `Ctrl` everywhere else.** The ones worth knowing:

| | |
|---|---|
| `Space` · `←` `→` · `Cmd ←` `Cmd →` | Play/pause · seek · previous/next |
| `=` `-` `M` | Volume up, down, mute |
| `0`–`5` | Rate the row under the cursor, or the playing track |
| `↑` `↓` `Enter` | Move through the list, play what you land on |
| `Cmd K` · `/` | Search the library · find in this list |
| `G` · `P` | Go to a playlist · go to what is playing |
| `S` · `V` · `H` · `T` | Shuffle play · list or albums · play-count heat · light or dark |
| `Cmd B` `Q` `W` · `Cmd ,` | Sidebar · queue · what's playing · settings |

## Working on Jean

[CONTRIBUTING.md](./CONTRIBUTING.md) is the development loop and the conventions. [ARCHITECTURE.md](./ARCHITECTURE.md) is how the pieces fit and why the boundaries sit where they do. [src/shared/api/README.md](src/shared/api/README.md) is the reference for what the player answers. [test/README.md](./test/README.md) is the suite and the fake player it runs against.
