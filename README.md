# Jean

<!-- site:tagline -->
Jean (/ʝan/) is a web interface for foobar2000, served by [`foo_jean`](https://github.com/enrique-ramirez/jean/tree/main/plugins/fb2k), the component that puts a small web server inside it. It plays nothing itself. Your player does that, on the machine it has always done it on, and Jean is what you point a browser at: full keyboard control at a desk, gestures sized for a thumb on a phone, and a front door built to hand you back the records you already own and had forgotten about.
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
[`foo_jean`](https://github.com/enrique-ramirez/jean/tree/main/plugins/fb2k) is a component of Jean's own, and it is what answers your library. Two more things come with it.

**Rate a track from the browser.** The stars stop being read-only, and a rating you set here is written into the file's own tags, where every other program that reads your library will find it.

**Send the sound to whatever you are holding.** A control beside the volume plays what the player is playing, here, in this tab, and mutes the player as it hands over, so the music follows you to the kitchen instead of doubling. It names who else is listening, and it can put the speakers back on alongside everyone.
<!-- /site:extra -->

## Requirements

<!-- site:requirements -->
Jean is not a music player, and on its own it does nothing at all. It draws a player that is already running somewhere else, so one thing has to be in place before it has anything to talk to.

**[`foo_jean`](https://github.com/enrique-ramirez/jean/tree/main/plugins/fb2k), installed in foobar2000 on Windows.** Playback, playlists, the queue, your library, its covers, ratings written back to your tags, the sound sent to this device, and Jean itself all come from here. There is nothing else to install. The media library needs foobar2000 2.0 or newer; on an older version you still get playback, playlists and the queue.

One more is optional:

| | |
|---|---|
| `foo_playcount` or `foo_enhanced_playcount` | Jean is compatible with both. They are where the play counts and last-played dates come from, which is what the shelves and the row shading are made of. Without one, none of that is drawn |
<!-- /site:requirements -->

## Install

<!-- site:install -->
**1. Install [`foo_jean`](https://github.com/enrique-ramirez/jean/tree/main/plugins/fb2k).** Download `foo_jean.fb2k-component` from [the latest release](https://github.com/enrique-ramirez/jean/releases) and open it with foobar2000, which installs it and offers to restart.

**2. Open `http://<the player's computer>:8881/`** in any browser in the house. `foo_jean` serves Jean itself, at the port it listens on. That is the whole install.

**Rating a track or writing a tag needs nothing extra.** `foo_jean` allows it from the moment it starts; the player owner narrows or turns it off under `File → Preferences → Tools → Jean → Permissions`.

**A translation lives at `<profile>/foo_jean/www/locales/<code>.json`**, added by hand.

**A folder at `<profile>/foo_jean/www/<name>/` is a web interface of its own, served at `/<name>/`.** It shares Jean's origin, so it reaches `foo_jean`'s API the same way Jean does, with nothing to configure.
<!-- /site:install -->

### Where your foobar2000 profile is

<!-- site:profiles -->
`<profile>` is foobar2000's own settings folder, the one it already keeps your playlists and library index in. `foo_jean` reads and writes its own files under `<profile>/foo_jean/`. foobar2000 shows the path under **File → Preferences → Advanced → Display → Profile folder**, or, for a portable install, it is the `profile` folder beside the executable.
<!-- /site:profiles -->

## Language

Jean ships in English, with a Spanish translation beside it. Pick one under **Settings → Language**; with nothing picked it follows the browser, so a phone set to Spanish opens in Spanish without anyone configuring it. Dates, figures and sort order follow whatever is chosen, not the browser.

### Translating it yourself

`en.json` and `es.json` are built into `foo_jean` rather than sitting in that folder, so start from a running Jean instead of copying a file: open `http://<the player's computer>:8881/locales/es.json` in a browser and save it. Translate the right-hand side of each line, and leave anything in `{braces}` alone: those are filled in at runtime, and a field renamed shows up as `{prot}` on screen.

Save the result at `<profile>/foo_jean/www/locales/<code>.json`, named after the language's own code, such as `fr.json`. Then tell Jean the file is there. It cannot list its own folder, so name the code in `locales/custom.json`, right beside it, which is a plain list and is the one file here that is yours:

```json
["fr", "pt-BR"]
```

A phrase your file does not carry falls back to English, so a half-finished translation works from the first line, and one written for an older release of Jean goes on working. Settings names how many phrases are missing. `en.json` is written by the build as the file to copy; English is built into Jean, so editing it changes nothing.

**Names outside Jean stay in their own language.** `Library → Search`, the `File → Preferences → Tools → Jean` pane, foo_jean's own labels: those are things to find on a foobar2000 screen that is in English whatever Jean is showing, and translating them sends people looking for a menu that is not there.

A translation you would like shipped is welcome as a pull request. Put it in `ui/public/locales/` and `pnpm test:unit` will check it against the catalogue.

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

[CONTRIBUTING.md](./CONTRIBUTING.md) is where to start.
