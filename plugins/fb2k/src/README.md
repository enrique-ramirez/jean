# The source tree

```
src/core/   portable. Knows nothing about foobar2000.
src/fb2k/   everything that touches the SDK, or Windows.
```

Why that boundary exists and what enforces it is [`../ARCHITECTURE.md`](../ARCHITECTURE.md); the rules for working either side of it are [`../CONTRIBUTING.md`](../CONTRIBUTING.md). What follows is the map.

## `src/core/`

| | |
|---|---|
| `version.h` | Name, version, API version. One place, three consumers, two of them contracts with things outside this repo |
| `json.{h,cpp}` | Parsing JSON that came from outside, without throwing. Bodies, config files and playlist properties all read the same way |
| `settings.{h,cpp}` | The `Settings` struct and a pure parser and serialiser for `config.json`. No file IO |
| `api.{h,cpp}` | The JSON documents published, and which HTTP status each answer carries. `/api/status` and the discovery record overlap, and building them in one place is what stops them drifting |
| `http_server.{h,cpp}` | The listener, the routes, CORS, the bearer check, the body cap |
| `tag_write.{h,cpp}` | Whether a write is permitted: allowlist, path shape, field values. Pure |
| `playlists.{h,cpp}` | What an autoplaylist request may say, what a playlist id looks like, and the record kept about the ones this component made. Pure |
| `preferences.{h,cpp}` | The preferences page's controls as plain text, and everything the page decides: what a configuration looks like on screen, and what a screenful of text means |
| `pairing.{h,cpp}` | The pairing window: one grant, private source addresses only, and the history the pane shows |
| `rate_limit.{h,cpp}` | A token bucket, in front of the routes that change playlists. Takes the time as an argument, so the tests need no clock |
| `stream_ticket.{h,cpp}` | Short-lived grants, because `<audio>` cannot send a header. Good until they expire rather than once. Takes the time as an argument |
| `stream.h` | The stream seam: what a session is, and who may open one |
| `device.{h,cpp}` | How a device names itself, and the bound on what it may call itself. Untrusted text both, so it is cleaned in one place |
| `audience.{h,cpp}` | Who is listening. Groups sockets into devices, caps the sockets, and holds the linger that stops a reconnect reading as a departure |
| `output_hold.{h,cpp}` | Silencing the player while somebody listens elsewhere, and never arguing with a person who undoes it |
| `pcm_ring.{h,cpp}` | The player's main thread to the encoder thread. Bounded in seconds, drops the oldest, so the main thread never waits |
| `broadcast_ring.{h,cpp}` | One encode, one cursor per listener. A listener the writer laps is dropped rather than waited for |
| `opus_stream.{h,cpp}` | 48 kHz float in, one continuous Ogg Opus stream out. Never restarted at a track change |
| `timeline.{h,cpp}` | The stream's own clock and the marks in it: where a track started or a seek landed, and where the player was in it |
| `text.{h,cpp}` | Case-insensitive comparison, the printable-text check, and `secureEquals`, the constant-time compare every credential goes through. Shared because the allowlist, the `Bearer` scheme, playlist titles and track paths all need one of them |
| `log.h` | The logging seam, declaration only |

## `src/fb2k/`

| | |
|---|---|
| `component.cpp` | `initquit`; owns everything, so startup order is a constructor and shutdown order is a destructor |
| `paths.{h,cpp}` | Every path used, resolved against what the player reports rather than remembered |
| `strings.h` | Between `pfc::string8`, `std::wstring` and `std::string` |
| `files.{h,cpp}` | Text files through the SDK's filesystem. The only place that does it |
| `config_file.{h,cpp}` | Reads, first-run-writes and saves `config.json` |
| `token.{h,cpp}` | 32 bytes from the OS CSPRNG as 64 hex characters. First run needs one; so does the page's Regenerate |
| `advertise.{h,cpp}` | Writes the discovery record into beefweb's `clientconfig` directory |
| `tag_writer.{h,cpp}` | The other half of writing: resolve the path, refuse tracks the player does not manage, then `metadb_io_v2` on the main thread |
| `playlists.{h,cpp}` | The other half of autoplaylists: `autoplaylist_manager`, the playlist property holding this component's record, and the one holding beefweb's id. Also `playlistIndices()`, which turns the SDK's count-and-getter into a range to fold over |
| `player_mute.{h,cpp}` | The volume calls `output_hold` needs, marshalled onto the main thread |
| `streamer.{h,cpp}` | The live pipeline: the capture callback, the player's resampler chain, and the encoder thread. `audio_sample` is float or double depending on the SDK build, so this file converts at both ends |
| `aac_encoder.{h,cpp}` | AAC-LC in ADTS through the encoder Windows ships, for Safari |
| `preferences.{cpp,rc}` | The page under Tools. Plain Win32, so no ATL and no WTL |
| `resource.h` | The dialog's control ids. Classic include guards, not `#pragma once`: `rc.exe`'s preprocessor is not the compiler's |
| `running_settings.{h,cpp}` | What the listener came up with, so the page can tell a saved change from a live one |
| `running_server.{h,cpp}` | The live listener itself, so the page can open a pairing window on it. Safe when nothing is serving |
| `main_thread.{h,cpp}` | The coalescing queue over `fb2k::inMainThread` |
| `ask_player.h` | Marshal onto the main thread, wait, give up after a timeout. Every caller into the player does exactly this |
| `log.cpp` | The console and `<profile>/foo_jean/foo_jean.log`, which appends, carries levels, and starts over rather than rotating past a megabyte |
| `PCH.{h,cpp}` | The precompiled header, which is the SDK and nothing else |
