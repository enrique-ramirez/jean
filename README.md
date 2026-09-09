# Jean

<!-- site:tagline -->
Jean (/ʝan/) is a different face for [beefweb](https://github.com/hyperblast/beefweb), the plugin that puts a small web server inside foobar2000 and DeaDBeeF. It plays nothing itself. Your player does that, on the machine it has always done it on, and Jean is what you point a browser at: full keyboard control at a desk, gestures sized for a thumb on a phone, and a front door built to hand you back the records you already own and had forgotten about.
<!-- /site:tagline -->

**[Try it](https://enrique-ramirez.github.io/jean/demo/)**: the whole interface, running against a library and a player that live entirely in your browser tab. Nothing to install. Nothing actually plays.

## What it does

<!-- site:rediscover -->
### Re-discover what you already own

Every list shades its rows by how often you have played them, so a playlist you thought you knew shows its cold spots at a glance. The front door is built out of the same counts. Records you play constantly. Records you played to death and then put down. Records you only own a bad rip of. Records you have never once opened. Genres carry their own figures, and when nothing appeals, one button shuffles the lot.
<!-- /site:rediscover -->

<!-- site:search -->
### Find anything in it

One box takes the whole library and answers as you type, sorted into artists, records and tracks. Accents are optional, so you can type a name the way you say it rather than the way it is spelt. Inside whatever list is already on screen, a second finder narrows that list and jumps you to the row instead of hiding everything around it. A search you keep is a real address: it lives on the player, survives a reload, and turns up on the other devices in the house.
<!-- /site:search -->

<!-- site:nowplaying -->
### Your music, your way

The now-playing screen is the one that stays open on a phone. Big artwork, the rating under your thumb, the transport where your hand already is, and tabs for the lyrics, the tags the file actually carries, and who the artist is. Lyrics scroll in time when the file carries the timestamps, and tapping a line seeks there. Light and dark are both drawn rather than one inverted from the other, so pick whichever suits the room.
<!-- /site:nowplaying -->

<!-- site:more -->
- **Browses** your playlists and your whole library, as a list or grouped by album, over a virtualised view that does not care how many tracks you own.
- **Manages playlists**: create, rename, reorder by dragging, drop tracks in from anywhere. Adding tracks comes with an undo; deleting a playlist asks first.
- **Draws the play queue as a timetable**, so every row says when it will play.
- **Indexes your genres**, all of them, found by typing, and turns any of them into an autoplaylist the player keeps filled.
<!-- /site:more -->

<!-- site:closing -->
English and Spanish, with any other language a JSON file away. On a phone the sidebar is a drawer, menus arrive as sheets, and anything that only means something with a keyboard attached is not there.

Anything your library cannot support is not drawn. No ratings, no starred shelf. No playback statistics, no play-history shelves at all. A library with no genre tags does not get told it has none.
<!-- /site:closing -->

## The extra

<!-- site:extra -->
[`foo_jean`](https://github.com/enrique-ramirez/foo_jean) is a component of Jean's own, and everything above works without it. Install it and two more things switch on.

**Rate a track from the browser.** The stars stop being read-only, and a rating you set here is written into the file's own tags, where every other program that reads your library will find it.

**Send the sound to whatever you are holding.** A control beside the volume plays what the player is playing, here, in this tab, and mutes the player as it hands over, so the music follows you to the kitchen instead of doubling. It names who else is listening, and it can put the speakers back on alongside everyone.
<!-- /site:extra -->

## Requirements

<!-- site:requirements -->
Jean is not a music player, and on its own it does nothing at all. It draws a player that is already running somewhere else, so two things have to be in place before it has anything to talk to.

**A player that beefweb runs in.** foobar2000 on Windows, or DeaDBeeF on Linux, macOS or BSD. There is no foobar2000 build of beefweb for macOS, so a Mac means DeaDBeeF.

**[beefweb](https://github.com/hyperblast/beefweb), installed and enabled in it.** This is the piece that answers a browser at all. Playback, playlists, the queue, artwork and the library itself all arrive through it, and Jean is a face drawn on top.

Two more are optional:

| | |
|---|---|
| `foo_playcount` or `foo_enhanced_playcount` | Jean is compatible with both. They are where the play counts and last-played dates come from, which is what the shelves and the row shading are made of. Without one, none of that is drawn |
| [`foo_jean`](https://github.com/enrique-ramirez/foo_jean) | The extra above: ratings written back to your tags, and the sound sent to this device |
<!-- /site:requirements -->

## Install

<!-- site:install -->
**1. Download [the latest release](https://github.com/enrique-ramirez/jean/releases) and unzip it.**

**2. Put what came out of the zip into a folder called `jean`, beside your beefweb settings.** The files go straight in. A `jean` folder holding a second `jean` folder is the usual slip, and beefweb serves nothing at all when it happens:

```
beefweb/
├── config.json
├── jean/
│   ├── index.html
│   ├── favicon.svg
│   ├── assets/
│   └── locales/
```

Replacing a copy you already have? Delete the old `jean` folder rather than unzipping over it, or yesterday's files pile up beside today's. If you wrote your own translation, keep `locales/custom.json`: that one is yours.

**3. Open `config.json`, in that same folder, in any text editor** and tell beefweb where the `jean` folder is. Create the file if it is not there:

```json
{
  "urlMappings": {
    "/jean": "C:\\Users\\you\\AppData\\Roaming\\foobar2000-v2\\beefweb\\jean"
  }
}
```

Write the full path, not a shortened one, and on Windows double every backslash exactly as above.

**4. Restart the player.** It reads that file once, at startup.

**5. Open `http://<the player's computer>:8880/jean/`** in any browser in the house. The trailing slash matters.

Jean now lives at `/jean`, and the interface beefweb came with is still at `/`. Nothing has been replaced, so if you hate it, delete the folder.
<!-- /site:install -->

### Where the beefweb folder is

<!-- site:profiles -->
| Setup | Location |
|---|---|
| foobar2000, Windows | `%APPDATA%\foobar2000-v2\beefweb\` |
| foobar2000, **portable install** | next to the executable, at `<install dir>\profile\beefweb\` rather than `%APPDATA%` |
| DeaDBeeF, Linux/BSD | `~/.config/deadbeef/beefweb/` |
| DeaDBeeF, macOS | `~/Library/Preferences/deadbeef/beefweb/` |

The portable case catches people out. Copying to `%APPDATA%` there fails quietly: the files land, and beefweb goes on serving the interface it came with.
<!-- /site:profiles -->

### If Jean asks for a library playlist

Newer beefweb releases hand Jean the media library directly, and there is nothing to do. Older ones cannot: beefweb sees playlists and the filesystem and nothing else. When yours is one of those, Jean says so on first run and asks for a playlist that mirrors the library. The right kind is an **autoplaylist**, a live Media Library query that keeps itself in sync.

In foobar2000: **Library → Search**, enter `ALL` as the query, and save the result as an autoplaylist. Name it exactly this:

```
#Jean Library
```

The name is how Jean knows the playlist is meant for it, so it has to match. If you already have one called `Library`, Jean will spot it and offer to rename it for you. Once it matches, Jean keeps it out of its own sidebar. It stays visible in foobar2000, where you can ignore it. Every other playlist stays yours; Jean never quietly reinterprets one as something else.

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
