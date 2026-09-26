# The source tree

```
src/core/   portable. Knows nothing about foobar2000.
src/fb2k/   everything that touches the SDK, or Windows.
```

Why that boundary exists and what enforces it is [`../ARCHITECTURE.md`](../ARCHITECTURE.md); the rules for working either side of it are [`../CONTRIBUTING.md`](../CONTRIBUTING.md). What follows is the map. Most files say at their top what they are for, so this is where to look rather than what to read; the ones that do not are described here.

## `src/core/`

Twelve features are split across the boundary, and each is a pair. Five share a name: `artwork`, `library`, `log`, `playlists` and `preferences`. Seven do not: `settings` against `config_file`, `tag_write` against `tag_writer`, `stream` against `streamer`, `output_hold` against `player_mute`, `outputs` against `player_outputs`, `player_state` against `playback_watch`, and `reload` against `config_watch`. The `core/` half decides and the `fb2k/` half asks the player, so a question about whether something is *permitted* is answered here and a question about what the player *did* is answered there.

The rest of `core/` is the machinery those decisions run on: `json` reads anything that came from outside, `api` is every JSON document this component publishes, `admission`, `rate_limit` and `stream_ticket` are who may connect and the bounds on what a connection may do, and `pcm_ring`, `broadcast_ring`, `opus_stream`, `timeline` and `audience` are the audio path.

| | |
|---|---|
| `version.h` | Name, version, API version. Three consumers, two of them contracts with things outside this repository |
| `settings.{h,cpp}` | The `Settings` struct and a pure parser and serialiser for `config.json`. No file IO |
| `reload.{h,cpp}` | Compares a freshly parsed `config.json` against what is running, and decides which keys move and which wait for a restart |
| `admission.{h,cpp}` | `isPrivateAddress` and the `Host` allowlist: who may reach the component at all |
| `http_server.{h,cpp}` | The listener, the routes, CORS, admission, the body cap |
| `stream.h` | The stream seam: what a session is, and who may open one |
| `device.{h,cpp}` | How a device names itself, and the bound on what it may call itself |
| `audience.{h,cpp}` | Who is listening. Groups sockets into devices, caps the sockets, and holds the linger that stops a reconnect reading as a departure |
| `output_hold.{h,cpp}` | Silencing the player while somebody listens elsewhere, and never arguing with a person who undoes it |
| `player_state.{h,cpp}` | What the player is doing, held under a mutex with a monotonic version, and the transitions a real player writes it through |
| `playback_modes.{h,cpp}` | Jean's own names for a playback order, and the map to and from whatever foobar2000 calls its own |
| `text.{h,cpp}` | Case-insensitive comparison, the printable-text check, and `secureEquals`, the constant-time compare every credential goes through |

## `src/fb2k/`

Beside the twelve halves named above: `component.cpp` is the `initquit` that owns everything, so startup order is a constructor and shutdown order is a destructor; `playback_commands` is the six playback and volume seams into `playback_control` or `playlist_manager`, with `core/http_server.h` and `core/playback_modes.h` deciding what may be asked and which order an index names; `queue` is what the play queue asks of the player, with `core/api.h` deciding what may be asked; `main_thread` and `ask_player` are how every call into the player gets onto its thread; `ticket_mint` mints a stream ticket and `files` writes a text file; `strings` and `resource.h` are the Windows plumbing; `running_settings` is what the listener actually came up with, so the page can tell a saved change from a live one; `aac_encoder` is the Media Foundation half of streaming; and `PCH.{h,cpp}` is the precompiled header, which is the SDK and nothing else.

And the ones with no description of their own:

| | |
|---|---|
| `paths.{h,cpp}` | Every path used, resolved against what the player reports rather than remembered |
| `streamer.{h,cpp}` | The live pipeline: the capture callback, the player's resampler chain, and the encoder thread |
| `playback_watch.{h,cpp}` | Three callbacks writing `player_state`, `PlaylistVersions` for the row playback leaves, and `NowPlayingArtwork`, which it clears on a new track and on a stop; each seeded at construction from what the player is already doing: a `play_callback_impl_base` for new track, pause, stop, seek, dynamic info, a broadcast's own dynamic info and volume; a `playlist_callback_impl_base` for the playback order, which `playback_control` does not carry; and a second `playlist_callback_impl_base` for the playing item's place, narrowed to the playing playlist by comparing against `get_playing_item_location` before touching the store, since the SDK has no per-playlist subscription. The name reruns two title-format scripts compiled once at construction, on a track change and on the broadcast callback alike; volume depends on `output_hold` to tell the user's own mute from the stream's. Beside the watch, `playingTrackReader` fills `Player::readPlayingTrack` for `GET /api/track/playing`: on each request it hops to the main thread through `askPlayer` to read `get_now_playing` and format the caller's columns through `playback_control`, rather than off a handle's stored tags |
| `running_server.{h,cpp}` | The running listener's status, published for the preferences page to read: whether it is serving and what a bind failure said |
| `config_watch.{h,cpp}` | Polls `config.json`'s write time once a second on a thread of its own, and on a change asks `core/reload.h` what moved and applies it to the running `HttpServer`, so a switch takes effect with no restart |
| `preferences.{cpp,rc}` | The page under **Tools**, which moves text between controls and `core/preferences.h` and decides nothing itself |
| `log.cpp` | The console and `<profile>/foo_jean/foo_jean.log`, which appends, carries levels, and starts over rather than rotating past its cap |
| `ui_assets.{h,cpp}` | Fills `Player::readPage`, `pageNames` and `readDiskPage`: an id lookup into the resources `scripts/embed-ui.ps1` writes from `ui/dist`, and a `www/` reader that canonicalizes every request and refuses one a symlink or junction resolves outside it |
