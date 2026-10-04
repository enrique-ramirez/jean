# The source tree

```
src/core/   portable. Knows nothing about foobar2000.
src/fb2k/   everything that touches the SDK, or Windows.
```

Why that boundary exists and what enforces it is [`../ARCHITECTURE.md`](../ARCHITECTURE.md); the rules for working either side of it are [`../CONTRIBUTING.md`](../CONTRIBUTING.md). What follows is the map. Most files say at their top what they are for, so this is where to look rather than what to read; the ones that do not are described here.

## `src/core/`

Twelve features are split across the boundary, and each is a pair. Five share a name: `artwork`, `library`, `log`, `playlists` and `preferences`. Seven do not: `settings` against `config_file`, `tag_write` against `tag_writer`, `stream` against `streamer`, `output_hold` against `player_mute`, `outputs` against `player_outputs`, `player_state` against `playback_watch`, and `reload` against `config_watch`. The `core/` half decides and the `fb2k/` half asks the player, so a question about whether something is *permitted* is answered here and a question about what the player *did* is answered there.

The rest of `core/` is the machinery those decisions run on. `player` is the `Player` seam and `player_outcome` what a call through it answers; `main_thread_queue` and `ask_player` carry that call onto the player's main thread, `main_thread_watch` notices when that thread stops answering, and `refusal_order` picks the refusal a playlist or queue edit answers when several apply. `json` reads anything that came from outside, the four `requests_` files decode what a route was asked, and `selection` the ordinals or positions a request names. The `routes_` files answer the API, one area each, through `http_responses`; playlists take three, `routes_playlists` for the list itself, `routes_playlist_rows` for a playlist's rows and `routes_own_playlists` for the component's own, addressed by role. `shared_bytes` is how a cover or a library export is held once and handed to every reader. `documents` is every JSON document this component publishes and `failures` every refusal and failure among them with its status; `admission`, `rate_limit` and `stream_ticket` are who may connect and the bounds on what a connection may do, and `pcm_ring`, `broadcast_ring`, `opus_stream`, `pcm16`, `timeline`, `pacer` and `audience` are the audio path.

| | |
|---|---|
| `version.h` | Name, version, API version. Three consumers, two of them contracts with things outside this repository |
| `settings.{h,cpp}` | The `Settings` struct and a pure parser and serialiser for `config.json`. No file IO |
| `reload.{h,cpp}` | Compares a freshly parsed `config.json` against what is running, and decides which keys move and which wait for a restart |
| `admission.{h,cpp}` | `isPrivateAddress`, the `Host` allowlist and the `Sec-Fetch-Site` check: who may reach the component at all |
| `http_server.{h,cpp}` | The listener, starting and stopping it, why a bind failed, the pre-routing filter, CORS, the body cap, `/api/status` and `/api/capabilities`, and the session registry, which stopping closes before the listener |
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
| `text.{h,cpp}` | Case-insensitive comparison, the printable-text check, and `secureEquals`, the constant-time compare every credential goes through |

## `src/fb2k/`

Beside the twelve halves named above: `component.cpp` is the `initquit` that owns everything, so startup order is a constructor and shutdown order is a destructor; `playback_commands` is the seven seams into `playback_control` or `playlist_manager` that play a playlist row, drive the transport, seek, and set the order, the volume and the mute, with `core/player.h` and `core/playback_modes.h` deciding what may be asked and which order an index names; `queue` is what the play queue asks of the player, with `core/requests_queue.h` deciding what may be asked, and how a detached session's queue is read back; `playlists` is what `playlist_reads`, `playlist_edits`, `autoplaylists`, `playlist_properties` and `playlist_watch` share; `tracks` is what a track handle is published as, and how a session's track carries its handle; `main_thread` is foobar2000's `MainThreadCalls`; `ticket_mint` mints a stream ticket and `files` writes a text file; `strings` and `resource.h` are the Windows plumbing; `running_settings` is what the listener actually came up with, so the page can tell a saved change from a live one; `aac_encoder` is the Media Foundation half of streaming; and `PCH.{h,cpp}` is the precompiled header, which is the SDK and nothing else.

`playlist_edits` holds the row writes, a move and a sort among them: a move takes its permutation from `moveOrder` in `core/playlists.h`, which is pure, and a sort takes its permutation from the SDK; `autoplaylists` answers a preview's matches as ordinals through the `OrdinalMatcher` that `library` builds over its snapshot, empty where there is no snapshot.

And the ones with no description of their own:

| | |
|---|---|
| `paths.{h,cpp}` | Every path used, resolved against what the player reports rather than remembered |
| `streamer.{h,cpp}` | One stream's pipeline from its `PcmSource` on, the engine session's or a detached session's: the player's resampler chain, the encoder thread and both formats' rings; and `engineCapture`, the capture callback that is the engine session's source |
| `decoder_source.{h,cpp}` | A detached session's pipeline: its own `Streamer`, built in one main-thread job and fed by a thread decoding the session's tracks through `input_helper`, ReplayGain and the player's DSP chain at the pace `core/pacer.h` sets |
| `player_audio_settings.{h,cpp}` | The DSP chain and ReplayGain settings foobar2000 plays with, kept current by its two change notifications for every session's decoder to copy |
| `session_track.{h,cpp}` | A detached session's track as its poll, `GET /api/track/playing` and `GET /api/artwork/playing` read it: the names and the caller's columns formatted off the handle the session holds, the columns compiled in one main-thread job, and the cover read through `AlbumArt` on the connection thread |
| `com_thread.h` | COM initialised multithreaded for the life of a thread, held by the encoder thread and each session's decoder thread |
| `playback_watch.{h,cpp}` | Four callbacks writing `player_state`, `PlaylistVersions` for the row playback leaves, and `NowPlayingArtwork`, which it clears on a new track and on a stop; each seeded at construction from what the player is already doing: a `play_callback_impl_base` for new track, pause, stop, seek, dynamic info, a broadcast's own dynamic info and volume; a `playlist_callback_impl_base` for the playback order, which `playback_control` does not carry; a second for the active playlist; and a third `playlist_callback_impl_base` for the playing item's place, narrowed to the playing playlist by comparing against `get_playing_item_location` before touching the store, since the SDK has no per-playlist subscription. The name reruns the scripts `compiledNameScripts` compiles once at construction, on a track change and on the broadcast callback alike; volume depends on `output_hold` to tell the user's own mute from the stream's. Beside the watch, `playingTrackReader` fills `Player::playback.readPlayingTrack` for `GET /api/track/playing`: on each request it hops to the main thread through `askPlayer` to read `get_now_playing` and format the caller's columns through `playback_control`, rather than off a handle's stored tags |
| `running_server.{h,cpp}` | The running listener's status, published for the preferences page to read: whether it is serving and what a bind failure said |
| `config_watch.{h,cpp}` | Polls `config.json`'s write time once a second on a thread of its own, and on a change asks `core/reload.h` what moved and applies it to the running `HttpServer`, so a switch takes effect with no restart |
| `preferences.{cpp,rc}` | The page under **Tools**, which moves text between controls and `core/preferences.h` and decides nothing itself |
| `log.cpp` | The console and `<profile>/foo_jean/foo_jean.log`, which appends, carries levels, and starts over rather than rotating past its cap |
| `ui_assets.{h,cpp}` | Fills `Player::page.read`, `page.names` and `page.readDisk`: an id lookup into the resources `scripts/embed-ui.ps1` writes from `ui/dist`, and a `www/` reader that canonicalizes every request and refuses one a symlink or junction resolves outside it |
