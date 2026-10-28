# The source tree

```
src/core/   portable. Knows nothing about foobar2000.
src/fb2k/   everything that touches the SDK, or an operating system.
```

Why that boundary exists and what enforces it is [`../ARCHITECTURE.md`](../ARCHITECTURE.md); the rules for working either side of it are [`../CONTRIBUTING.md`](../CONTRIBUTING.md). What follows is the map. Most files say at their top what they are for, so this is where to look rather than what to read; the ones that do not are described here.

## `src/core/`

Twelve features are split across the boundary, and each is a pair. Five share a name: `artwork`, `library`, `log`, `playlists` and `preferences`. Seven do not: `settings` against `config_file`, `tag_write` against `tag_writer`, `stream` against `streamer`, `output_hold` against `player_mute`, `outputs` against `player_outputs`, `player_state` against `playback_watch` and `reload` against `config_watch`. The `core/` half decides and the `fb2k/` half asks the player: whether something is *permitted* is answered in `core/`, and what the player *did* in `fb2k/`.

The rest of `core/` is the machinery those decisions run on: the `Player` seam (`player`, `player_outcome`), the main-thread hop (`main_thread_queue`, `ask_player`, `main_thread_watch`), `json` and the `requests_` files that read what a route was asked, the `routes_` files that answer, one area each, through `http_responses`, `documents` and `failures` for what the component publishes, `admission`, `rate_limit` and `stream_ticket` for who may connect and how often, `worker_restarts` for when a worker thread that failed runs again and when it stops for good, and `pcm_ring`, `broadcast_ring`, `opus_stream`, `pcm16`, `timeline`, `pacer` and `audience` for the audio path. Playlists take three route files: `routes_playlists` for the list, `routes_playlist_rows` for a playlist's rows and `routes_own_playlists` for the component's own, addressed by role.

| | |
|---|---|
| `version.h` | Name, version, API version. Three consumers, two of them contracts with things outside this repository |
| `settings.{h,cpp}` | The `Settings` struct and a pure parser and serialiser for `config.json`. No file IO |
| `preferences.{h,cpp}` | What both preferences pages share: the declaration of every setting they show, in English, and the decisions behind Apply and Reset. A page's own file draws and moves text |
| `reload.{h,cpp}` | Compares a freshly parsed `config.json` against what is running, and decides which keys move and which wait for a restart |
| `admission.{h,cpp}` | `isPrivateAddress`, the `Host` allowlist and the `Sec-Fetch-Site` check: who may reach the component at all |
| `http_server.{h,cpp}` | The listener, starting and stopping it, why a bind failed, whether another program can take its port and the two log sentences that say so, the pre-routing filter, CORS, the body cap, `/api/status` and `/api/capabilities`, and the session registry, which stopping closes before the listener |
| `stream.h` | The stream seam: what a listener is, who may open one, the `StreamEncoder` both formats implement, and the `PcmSource` a `Streamer` is fed by |
| `device.{h,cpp}` | How a device names itself, and the bound on what it may call itself |
| `audience.{h,cpp}` | Who is listening. Groups sockets into devices, caps the sockets, and holds the linger that stops a reconnect reading as a departure; a detached session's is a sibling of the engine's, counted against the same cap |
| `session.{h,cpp}` | A detached playback session: its snapshot, queue, order and transport, its members and when it expires, the turn its decoder takes, and the reports of what failed |
| `session_registry.{h,cpp}` | The detached sessions there are, and who may find, share and leave one; it answers for the engine session without holding it, creates the detached ones under the cap and reaps the expired |
| `session_scope.{h,cpp}` | Which session a request names in its query, which device names it, and the `controlPlayback` refusal, which only the engine session meets |
| `session_order.{h,cpp}` | The five orders a detached session offers, their names, and which row plays next under each, drawn from an injected source of randomness |
| `session_audio.{h,cpp}` | What a detached session's decoder asks of ReplayGain and the DSP chain: the gain source its order resolves to, the flags each run carries, and where a track's timeline mark lands |
| `pacer.{h,cpp}` | Holds a detached session's decoder to 1x, a short lead ahead of what has played and never past the ring's room |
| `output_hold.{h,cpp}` | Silencing the player while somebody listens elsewhere, and never arguing with a person who undoes it |
| `player_state.{h,cpp}` | What the player is doing, held under a mutex with a monotonic version, and the transitions a real player writes it through |
| `playback_modes.{h,cpp}` | Jean's own names for a playback order, and the map to and from whatever foobar2000 calls its own |
| `text.{h,cpp}` | Case-insensitive comparison that folds ASCII letters only, whatever the process locale; the printable-text check; `toHex` and `forwardSlashed`; `tagKey`, which makes two spellings of a tag one key as a browser would; `fold`, `squash`, `glyphs`, `nameKey`, `foldedWords`, `squashedWords`, `nameWords`, `searchesMarks`, `ValueDigest`, `utf16Length`, `utf16Before`, `ecmaTrimmed` and the ECMAScript whitespace scans, which make and compare text for a search as a browser does; and `secureEquals`, the constant-time compare every credential goes through |
| `unicode_tables.{h,cpp}` | The tables behind `tagKey` and `fold`: lower-casing, NFD decompositions, the order of marks, the Diacritic, letter and number ranges, and the ASCII foldings, written by `scripts/unicode-tables.mjs` from what Node's `toLowerCase`, `normalize` and `\p{…}` do and from `scripts/Latin-ASCII.xml`, CLDR's own transform file, which is kept byte for byte as published. The script writes the same foldings into `ui/src/shared/lib/asciiFolding.ts`. Generated: change the script or replace the CLDR file and run it |
| `library_roles.{h,cpp}` | The roles a request gives its columns, read from the query string with the refusals the summary makes, and the verdict on whether the snapshot can answer them |
| `library_groups.{h,cpp}` | What a question over the library groups rows by: tag keys, the credited artist, and the albums with the path their cover is addressed by, and a disc or track number read as free text |
| `library_paths.{h,cpp}` | Where a library-relative path sits in the snapshot, built once per `structure`: the playing track's ordinal for the state, and the album cover of every queue and playlist row that names roles |
| `library_questions.{h,cpp}` | The album, artist and genre questions over a `Snapshot`, each answered as the whole document its route sends, and the mutex-guarded store that keeps what they and search read: the album and artist grouping, the credit lessons, and the search parts, each for the structure and the change counts of the columns it reads |
| `library_search.cpp` | `LibraryQuestions::search`: scoring the tracks against each word of the query, ranking the artists, albums and genres a word begins, and the document the route sends |
| `library_entities.{h,cpp}` | What search reads beyond the tracks: the folded text of its four columns and the artist, album and genre entities, each with the key a section ranks it by |
| `library_credits.{h,cpp}` | Who a credit names: the lead and the guests after a `feat.`, the members of a joined credit from its names tag, its ids or what the library credits alone, and the lessons the library teaches |
| `library_wire.{h,cpp}` | The JLIB framing every library body shares: the magic number, the length-prefixed JSON header, and the blob of ids and dictionaries the header places at four-byte-aligned offsets |
| `library_rows.{h,cpp}` | A window of the snapshot as one JLIB body: the rows at the ordinals named, each column's dictionary cut to the values the window uses, the whole library's facts in the header |
| `library_runs.{h,cpp}` | How the whole library falls into album runs, each with its length and cover ordinal, and the mutex-guarded store that keeps them for the structure and the change counts of the columns they read |
| `playlist_runs.{h,cpp}` | How a playlist's rows fall into album runs by the library's rule, whether a row is a library ordinal or carries its own columns, with the highest play count and the header figures over all of them, and the mutex-guarded store that keeps each playlist's answer for its pair and the library's change counts |
| `playlist_find.{h,cpp}` | The positions of a playlist whose rows match a query, a library row on the folded text held for the snapshot and any other on the folding of its own columns |
| `library_summary.{h,cpp}` | The `GET /api/library/summary` document, computed from a `Snapshot` under the roles a request named. It reads no clock and no time zone of its own; both arrive as arguments |
| `library_sets.{h,cpp}` | The figures, artist cards, records and genre tiles of a set of ordinals, by the summary's own reading of durations, years, play counts and last-played stamps, and the JSON each is sent as |
| `ordinal_sets.{h,cpp}` | A set of ordinals as an answer carries it, `runs` or a base64 `bitset`, whichever is shorter by the rule the client weighs a fill by |
| `local_time.{h,cpp}` | This machine's local time for the summary, the one place Windows and the rest differ in spelling |
| `assets.{h,cpp}` | What a request for Jean's own page meets on its way to a file: the path shape that may be looked up, the content type and cache lifetime, the lookup in the embedded table, the build's root names, and `isWithin`, which decides whether a `www/` path has escaped |
| `aac_stream.{h,cpp}` | The AAC-LC stream over any `AacCodec`: whole blocks in, ADTS packets out. The codec is the platform's call and nothing else about AAC is |
| `format_feed.{h,cpp}` | One format of a stream: its encoder, its ring, its listener count and its preamble, the listener that reads it, and what a block does to it |

## `src/fb2k/`

Beside the twelve halves named above: `component.cpp` is the `initquit` that owns everything, so startup order is a constructor and shutdown order is a destructor; `playback_commands` is the seven seams into `playback_control` or `playlist_manager` that play a playlist row, drive the transport, seek, and set the order, the volume and the mute, with `core/player.h` and `core/playback_modes.h` deciding what may be asked and which order an index names; `queue` is what the play queue asks of the player, with `core/requests_queue.h` deciding what may be asked, and how a detached session's queue is read back; `playlists` is what `playlist_reads`, `playlist_edits`, `autoplaylists`, `playlist_properties` and `playlist_watch` share; `tracks` is what a track handle is published as, and how a session's track carries its handle; `main_thread` is foobar2000's `MainThreadCalls`; `ticket_mint` asks the operating system for a stream ticket's 32 random bytes and `files` writes a text file; `strings` converts between the SDK's strings and `std::string` and holds the separator foobar2000 writes in a library path, and `resource.h` is the Windows pages' control ids; `running_settings` is what the listener actually came up with and the port it is on, so a page can tell a saved change from a live one; `aac_encoder` is the Media Foundation AAC codec and `platformAacCodec()`, the one factory, and `aac_encoder_mac` is AudioToolbox's, each the only AAC file its platform builds; and `PCH.{h,cpp}` is the precompiled header, which is the SDK and nothing else.

And the ones with no description of their own:

| | |
|---|---|
| `paths.{h,cpp}` | Every path used, resolved against what the player reports rather than remembered, and the native path `std::filesystem` can open |
| `streamer.{h,cpp}` | One stream's pipeline from its `PcmSource` on, the engine session's or a detached session's: the player's resampler chain, the encoder thread, the timeline and both formats' `FormatFeed`; and `engineCapture`, the capture callback that is the engine session's source |
| `decoder_source.{h,cpp}` | A detached session's pipeline: its own `Streamer`, built in one main-thread job and fed by a thread decoding the session's tracks through `input_helper`, ReplayGain and the player's DSP chain at the pace `core/pacer.h` sets |
| `player_audio_settings.{h,cpp}` | The DSP chain and ReplayGain settings foobar2000 plays with, kept current by its two change notifications for every session's decoder to copy |
| `session_track.{h,cpp}` | A detached session's track as its poll, `GET /api/track/playing` and `GET /api/artwork/playing` read it: the names and the caller's columns formatted off the handle the session holds, the columns compiled in one main-thread job, and the cover read through `AlbumArt` on the connection thread |
| `com_thread.h` | COM initialised multithreaded for the life of a thread on Windows, held by the encoder thread and each session's decoder thread. Off Windows it does nothing |
| `playback_watch.{h,cpp}` | Four callbacks writing `player_state`, `PlaylistVersions` for the row playback leaves, and `NowPlayingArtwork`, which it clears on a new track and on a stop; each is seeded at construction from what the player is already doing. The SDK has no per-playlist subscription, so the playing item's place is narrowed to the playing playlist by hand. Volume depends on `output_hold` to tell the user's own mute from the stream's. Beside the watch, `playingTrackReader` fills `Player::playback.readPlayingTrack` for `GET /api/track/playing`; `plugins/fb2k/ARCHITECTURE.md`, *The seams*, says how it reads |
| `browser.{h,cpp}` | Opens a URL in the machine's default browser, through `ShellExecute` on Windows and Launch Services on macOS, for `openBrowserAtStart`; `core/settings.h`'s `browserAtStart` decides whether and which |
| `running_server.{h,cpp}` | The running listener's status, published for the preferences pages to read: whether it is serving and what a bind failure said |
| `config_watch.{h,cpp}` | Polls `config.json`'s write time once a second on a thread of its own, and on a change asks `core/reload.h` what moved and applies it to the running `HttpServer`, so a switch takes effect with no restart |
| `preferences.{cpp,rc}` | On Windows, the pages under **Tools**. Wording comes from `core/preferences.h` when the dialog opens, so `preferences.rc` holds positions and no wording |
| `preferences_mac.mm` | On macOS, the same two pages, built in code from the same declaration. The only Objective-C++ file, and where Apply and Reset are drawn, since macOS gives a page neither |
| `preferences_ids.h` | The two pages' GUIDs, for both platforms |
| `log.cpp` | The console and `<profile>/foo_jean/foo_jean.log`, which appends, carries levels, and starts over rather than rotating past its cap |
| `ui_assets.{h,cpp}` | Fills `Player::page.read`, `page.names` and `page.readDisk`: a lookup into the table `scripts/embed-ui.mjs` writes from `ui/dist` and, under `api/`, from the contract and its Swagger UI page, read through `core/assets.h`, and a `www/` reader that canonicalizes every request and refuses one a symlink or junction resolves outside it |
