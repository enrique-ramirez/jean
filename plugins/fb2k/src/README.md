# The source tree

```
src/core/   portable. Knows nothing about foobar2000.
src/fb2k/   everything that touches the SDK, or an operating system.
```

Why that boundary exists and what enforces it is [`../ARCHITECTURE.md`](../ARCHITECTURE.md); the rules for working either side of it are [`../CONTRIBUTING.md`](../CONTRIBUTING.md). Most files say at their top what they are for. What follows is what a listing cannot show.

## The pairs

Twelve features are split across the boundary, one file each side. The `core/` half decides whether a thing is permitted and the `fb2k/` half asks the player what it did, so a change to one usually moves the other.

| feature | `core/` | `fb2k/` |
|---|---|---|
| artwork | `artwork` | `artwork` |
| the media library | `library` | `library` |
| the log | `log` | `log` |
| playlists | `playlists` | `playlists` |
| the preferences pages | `preferences` | `preferences`, `preferences_mac` |
| settings | `settings` | `config_file` |
| tag writing | `tag_write` | `tag_writer` |
| the stream | `stream` | `streamer` |
| the output hold | `output_hold` | `player_mute` |
| output devices | `outputs` | `player_outputs` |
| the player's state | `player_state` | `playback_watch` |
| reload | `reload` | `config_watch` |

## Threads

Each file below starts a thread or a pool. *Threads, and what may block* in [`../ARCHITECTURE.md`](../ARCHITECTURE.md) is what each may wait on and must never do.

| file | thread |
|---|---|
| `core/http_server.cpp` | the listener |
| `core/output_hold.cpp` | the hold's watcher |
| `fb2k/streamer.cpp` | one encoder per `Streamer` |
| `fb2k/decoder_source.cpp` | one decoder per detached session |
| `fb2k/library.cpp` | the snapshot worker |
| `fb2k/config_watch.cpp` | the poll of `config.json`'s write time |

## Platform files

Each build compiles one file of each pair below and never sees the other, so a change to one wants the same change in its twin.

| Windows | macOS |
|---|---|
| `fb2k/aac_encoder.cpp`, Media Foundation | `fb2k/aac_encoder_mac.cpp`, AudioToolbox |
| `fb2k/preferences.cpp` and `preferences.rc`, Win32 | `fb2k/preferences_mac.mm`, Cocoa, and the only Objective-C++ file |

`tests/platform_seams_test.cpp` is the list of every file that may hold a platform call: these two pairs, and the files with an `#ifdef` inside.

## Generated files

| file | written by | from |
|---|---|---|
| `fb2k/ui_assets_table.cpp`, gitignored | `scripts/embed-ui.mjs` | `ui/dist`, and `contract/openapi.yaml` with its Swagger UI page under `api/` |
| `core/unicode_tables.cpp`, committed | `scripts/unicode-tables.mjs` | Node's `toLowerCase`, `normalize` and `\p{…}`, and `scripts/Latin-ASCII.xml`, CLDR's transform file kept as published |

The same run of `scripts/unicode-tables.mjs` writes `ui/src/shared/lib/asciiFolding.ts`, so both sides fold alike. To change a table, change the script or the CLDR file and run it.
