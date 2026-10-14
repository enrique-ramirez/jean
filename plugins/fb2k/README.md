# foo_jean

A foobar2000 component that serves [Jean](https://github.com/enrique-ramirez/jean)'s page and the whole HTTP API behind it, on a port of its own: playback and the player's state, playlists and the play queue, the media library in one piece, cover art, tag writing, autoplaylists, and a live stream of what the player is playing. Jean is its first client, though nothing in the API assumes it.

## What it does

**Writes metadata tags.** A request arrives over HTTP and *foobar2000* performs the write, through `metadb_io_v2::update_info_async`, so the player's own database is current the instant the write returns. Anything writing tags from outside the player leaves that database stale until a rescan, so the rating a client just set does not come back when it asks. Ratings are the first caller, but nothing here is rating-shaped: it writes fields.

**Creates autoplaylists.** An autoplaylist is a live query over foobar2000's Media Library that then shows up in `GET /api/playlists` like any other playlist. This creates, updates, previews and deletes them, and the playlist list says which playlists are autoplaylists, and which of those are this component's. Updating and deleting accept any autoplaylist, whoever made it.

**Serves the media library.** The whole of it, in one binary response, in whichever title-formatting columns the request asks for. The component keeps a snapshot of the library it walked, watches foobar2000's own change notifications to keep it current, and hands a client a small patch for what moved rather than the library again. A client that holds everything answers its own searches, counts and shelves without asking anybody.

**Streams the player's output.** A live mirror of what foobar2000 is playing, in Ogg Opus or in AAC-LC for Safari. The capture is post-DSP and pre-volume, so silencing the player leaves the stream at full level: choosing a device moves the sound to it rather than doubling it. `GET /api/stream/listeners` says who else has it, and anybody can ask for the speakers back alongside them.

## Building

The component builds on Windows into `foo_jean.dll` and on macOS into `foo_jean.component`, from the same `src/core/` and one table of Jean's page. A release joins both in one `foo_jean.fb2k-component`.

### The page

Neither build generates the page it compiles in, and each refuses to start without `src/fb2k/ui_assets_table.cpp`. On the machine that built `ui/`, run the generator after the page build:

```sh
pnpm --dir ui build
node plugins/fb2k/scripts/embed-ui.mjs   # -> src/fb2k/ui_assets_table.cpp
```

`scripts/embed-ui.mjs` is plain Node. The table it writes is one list of paths and bytes, gitignored, read through `src/core/assets.h` by both builds, so the DLL and the bundle cannot ship different pages. `scripts/lint.sh`, `scripts\lint.ps1` and `scripts/format.sh` leave it out.

### Windows

The build machine needs:

- **Visual Studio 2022 Build Tools** with the C++ workload **and the ATL component** (`Microsoft.VisualStudio.Component.VC.ATL`). `--includeRecommended` does not bring ATL, and the SDK's helpers include `atlbase.h`. The SDK ships MSBuild project files, so there is no CMake to write.
- **The foobar2000 SDK**, fetched by `scripts/fetch-sdk.ps1` into `sdk/`. It is not vendored: its licence does not permit redistribution.
- **WTL**, fetched by `scripts/fetch-wtl.ps1`. It is not ATL and does not ship with Visual Studio; `libPPUI` and the SDK helpers include `atlapp.h`, which is WTL's.
- **libopus and libogg**, fetched by `scripts/fetch-opus.ps1` here and by `scripts/fetch-opus.sh` on whatever machine runs the tests. Both are BSD; they are fetched rather than committed because they are a large body of C. The fetch pins a version and checks a SHA-256.
- **Nothing else to fetch.** cpp-httplib, nlohmann/json and doctest are single MIT headers committed under `third_party/`, and zlib is committed beside them as a directory of C under the zlib licence. `third_party/README.md` carries the versions and why each one is the one vendored.

```powershell
scripts\fetch-sdk.ps1
scripts\fetch-wtl.ps1
scripts\fetch-opus.ps1
scripts\build.ps1 -Project src\foo_jean.vcxproj   # -> bin\x64\Release\foo_jean.dll
scripts\package.ps1                                # -> dist\foo_jean.fb2k-component
```

### Build traps

The Windows build has several traps, each of which fails in a way that does not name its cause, and each is written down where it is enforced rather than listed here. `src/foo_jean.vcxproj` covers the four traps its header names, and settles `/MP`, `third_party/` and `sdk/` as external headers, and `/W4` on `core/`; `Directory.Build.targets` WTL's include path, the static C++ runtime and a Release build's Control Flow Guard and CET compatibility; `scripts/build.ps1` the toolset, the compiler flags and its refusal of a DLL that imports the C++ runtime or lacks either hardening flag; `scripts/package.ps1` where an x64 payload goes in the archive; and `scripts/generate-sln.ps1` the per-project configuration. Read all five before debugging a link, a packaging or a resource-compiler error.

Two things about the solutions, which no script says. **`scripts\generate-sln.ps1` exists to build the SDK's own `foo_sample`**, which proves a new machine's toolchain before there is any of this code to blame. **`foo_jean.sln` in this directory is for opening the tree in Visual Studio** and is not used by the build.

### macOS

`scripts/build-mac.sh` needs a Mac with the Xcode command line tools, and no Xcode project. It compiles with clang, from the flags in `scripts/lib/compile-flags.sh`:

```sh
scripts/fetch-sdk.sh
scripts/fetch-opus.sh
scripts/build-mac.sh                           # -> bin/mac/foo_jean.component
scripts/package-mac.sh [path/to/foo_jean.dll]  # -> dist/foo_jean.fb2k-component
```

The script builds the SDK's four static libraries from their own Xcode project files, reading each one's sources and settings from the project and restating none, then the component for arm64 and x86_64. It joins the two with `lipo` and signs the bundle ad hoc, which is all a Mac install needs and not a Developer ID. `scripts/package-mac.sh` writes the archive with `mac/foo_jean.component/`, and with `x64/foo_jean.dll` beside it where it is handed a DLL. `scripts/package.ps1` writes an archive of the DLL alone, from a Windows build made alone.

## Installing

On a Mac, the archive installs through foobar2000's Preferences, Components, Install, and loads after a restart. On Windows:

```powershell
scripts\install.ps1 -Foobar2000Dir <foobar2000-install>
```

foobar2000 must not be running, and `-StopPlayer` has the script ask it to exit first. That is `/exit`, a request rather than a kill, so configuration, playlists and the media database are written out properly.

A hand installation has to reproduce what the script does, and `scripts/install.ps1`'s own header says what that is. One thing it does not: the profile is not always in `%APPDATA%`. A portable install keeps it beside the executable and announces itself with a `portable_mode_enabled` file, which the script tests for rather than assuming.

`scripts/deploy.local.sh` does the whole round trip from an editing machine: run the tests, sync, build, package, install. It is gitignored, because the route to a player is personal to whoever has one. It reads `FOO_JEAN_SSH`, `FOO_JEAN_REMOTE` and `FOOBAR2000_DIR`.

## Configuring

Everything is a file. `<profile>/foo_jean/config.json` is written on first start with every key at its default, and it is the source of truth rather than a fallback for a dialog: this component is built for installs with nobody at the keyboard. A Mac install has no preferences page: its settings are `config.json`, and a failed bind or a held address is said in the log alone.

```json
{
  "port": 8881,
  "bindAddress": "0.0.0.0",
  "allowedOrigins": [],
  "allowedHosts": [],
  "allowedFields": ["rating", "unsynced lyrics"],
  "maxAutoPlaylists": 100,
  "writePlaylists": true,
  "controlPlayback": true,
  "changeOutput": true,
  "streamingEnabled": true,
  "opusBitrate": 256000,
  "aacBitrate": 192000,
  "maxConcurrentStreams": 8,
  "streamTicketTtlSeconds": 120,
  "muteWhileStreaming": true,
  "maxSessions": 4,
  "openBrowserAtStart": false
}
```

Every key is optional. An absent key keeps its default; a present but malformed one logs a line naming it, the value it refused and the default it took, so a single bad edit cannot stop a headless player coming up, and the log says what happened. A key that is not a setting at all is reported too, because a typo like `bindaddress` otherwise changes nothing and says nothing.

`controlPlayback`, `writePlaylists`, `allowedFields`, `changeOutput`, `streamingEnabled`, `maxAutoPlaylists`, `allowedHosts` and `allowedOrigins` take effect on the next request once the file changes on disk, with no restart. `port`, `bindAddress`, `opusBitrate`, `aacBitrate`, `maxConcurrentStreams`, `streamTicketTtlSeconds`, `muteWhileStreaming`, `maxSessions` and `openBrowserAtStart` keep their running values until foobar2000 restarts, because nothing rebinds a listening socket, reopens a stream already open or resizes the session cap the listener started with, and the browser is opened once, at start.

| key | meaning |
|---|---|
| `port` | Default 8881. If the port is taken the component refuses to start and says so in the log, and on the preferences page where the install has one; it never quietly picks another, because a client can only find it at a port it can predict. |
| `bindAddress` | Every local interface by default. Set it to `127.0.0.1` for a deployment that only ever answers its own machine. On a Mac, a port held on every interface is not exclusive: another program can bind one of the machine's addresses on it and take the connections to that address. The log says so at start, and one address here closes it. |
| `allowedOrigins` | Empty reflects no origin, so only a page served by the component itself, same-origin, can read a response. List origins to grant them the same access, matched whole and case-insensitively. |
| `allowedHosts` | The `Host` allowlist, beside what the component already admits on its own: an IPv4 or bracketed IPv6 literal, `localhost`, a name with no dot, and a name ending `.lan`, `.local` or `.home.arpa`. Matched case-insensitively, with the port and one trailing dot stripped. A request whose `Host` matches none of these is `403`, so a public name needs listing here. A reverse proxy on another machine must pass the client's own `Host` through unchanged for this check to see it; Caddy's `reverse_proxy` does that by default. |
| `allowedFields` | The write allowlist. Nothing outside it is ever written, and clients read it from `/api/capabilities` rather than being configured twice. Empty switches writing off. |
| `maxAutoPlaylists` | How many autoplaylists this component will keep at once, counting only the ones it created. `0` switches creation off. |
| `writePlaylists` | `true` by default, so leaving it alone permits every playlist write this component can make: create, add, edit, delete, reorder, rename. Set it to `false` to make every playlist and autoplaylist read-only except the component's own scratch playlist, which stays writable because it is how Jean works rather than the user's music. |
| `controlPlayback` | `true` by default. Set it to `false` and the volume, every scratch write, and every playback command, seek, playback mode, row played and queue write addressed to the player's own session answer `403`; reading the queue and the state still answers. A detached session is governed by none of it, and creating one is not refused. |
| `changeOutput` | `true` by default. Set it to `false` and `POST /api/outputs/active` answers `403`, so no client can switch the player's output device; `GET /api/outputs` still lists them. |
| `streamingEnabled` | `false` refuses every stream, the player's own session's and every detached session's, and refuses creating a detached session, since a detached session is heard nowhere else. `/api/capabilities` then reports `canStream: false` and `canCreateSessions: false`. A `maxConcurrentStreams` of `0` does the same, and then the capture callback is never registered at all. |
| `opusBitrate` | Bits per second for the Opus stream, between 32000 and 510000. One bitrate rather than a per-request choice: each distinct value would need its own encoder and buffer for as long as anybody listened to it. Opus is hard to tell from the source above 192000, and libopus can barely spend more than 256000. |
| `aacBitrate` | Bits per second for the AAC stream, and **only one of four values**, which `src/core/settings.h` names beside the reason. A refusal would cost the ADTS format altogether, which is the only one older Safari can play, so a value off the list is reported and replaced rather than passed on. |
| `maxConcurrentStreams` | Stream *connections*, across every session together, which is not the same as listeners: one device is routinely two, for the reason `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*, gives. Over the cap is a `503` saying so. |
| `streamTicketTtlSeconds` | How long a stream ticket stays valid, between 10 and 3600. A ticket is **not** single-use, for that same reason; the window is what bounds a leaked URL. |
| `maxSessions` | How many detached playback sessions this component will keep at once, between 0 and 8; the player's own session is never counted. One past the cap is a `503` saying so, and `0` switches creating them off. |
| `muteWhileStreaming` | Silences the player while anybody is listening to the player's own session, so the sound moves rather than doubles. A listener to a detached session never silences it. `false` makes the player one more speaker alongside every listener: fine a room away, an echo in the same room, because the stream runs a second or two behind. |
| `openBrowserAtStart` | `false` by default. `true` opens Jean in this machine's default browser once the listener is up, at `http://127.0.0.1:<port>/`, or at the `bindAddress` where one names a single interface. A browser treats a loopback address over plain HTTP as a secure context, so no certificate is involved. For an install somebody double-clicks rather than browses to: a portable foobar2000 on a USB stick, with `bindAddress` at `127.0.0.1` so Windows Firewall never asks about it. Nothing opens when the port could not be bound. |

### The preferences page

On Windows, **Preferences → Tools → Jean** edits the port, the bind address, `allowedOrigins` and `openBrowserAtStart`; its **Permissions** child page holds everything else: a checkbox each for `controlPlayback`, `writePlaylists`, `changeOutput` and `streamingEnabled`, the `allowedFields` list, `maxAutoPlaylists`, and the `allowedHosts` list. Two pages rather than one because foobar2000 sizes a preferences page to the host window and does not scroll it, so a tall page has content nobody can reach. Between them they write `config.json` and nothing else, so a headless install loses nothing by never opening the page, and a key the page has no control for is carried through untouched rather than reset.

The page is stricter than the file parser, deliberately: a hand-edited file must never stop a headless player coming up, so a bad key there falls back to a default, while the dialog refuses and says what to type.

**Applying most switches needs no restart**, since a change to `config.json` reaches a running listener within a couple of seconds. Either page shows *"a restart is needed for some changes to take effect"*, and only where a saved value differs from what the process is actually running with for one of the keys above that wait for a restart.

## The API

**[`contract/openapi.yaml`](../../contract/openapi.yaml) is the contract.** Every route, every shape, every status and every error string is written down there, by hand, with the reasoning a client needs beside each one. The component does not serve it; fetch it from the repository, and a typed client is one command away:

```sh
npx openapi-typescript contract/openapi.yaml -o fooJean.d.ts
```

`contract/` beside it is the conformance suite that measures an implementation against it. `plugins/fb2k/ARCHITECTURE.md` is the design behind the spec: how a request is admitted and what keeps that safe, how the media library snapshot is built and kept current, and what the audio path is made of.

Two things hold across the whole surface. Every request is checked first for where it came from and what `Host` it named, refused before it reaches a route where either fails; `/api/stream` needs a ticket as well, because an `<audio>` element cannot send a header. `plugins/fb2k/ARCHITECTURE.md`, *Admission*, is what decides both checks and what they leave for the switches in `config.json` to decide instead. And a response is gzipped whenever the client offers `Accept-Encoding: gzip`, which `third_party/README.md` has the mechanics of, including what keeps the live encode out of the compressor.

## Testing

```bash
scripts/fetch-opus.sh                     # once; the suite links libopus and libogg
scripts/fetch-sdk.sh                      # once, on a Mac; build-mac.sh, clangd and lint need it
scripts/test.sh                           # the whole suite
scripts/test.sh '-sf=*cors_test.cpp'      # one file
scripts/test.sh --sanitize=address        # AddressSanitizer and UBSan
scripts/test.sh --sanitize=thread         # ThreadSanitizer
scripts/format.sh --check                 # clang-format, without writing
scripts/lint.sh                           # clang-tidy over src/core/ and tests/, and src/fb2k/ on a Mac
scripts/compile-commands.sh               # what an editor's clangd reads
```

`scripts/compile-commands.sh` writes `compile_commands.json`, and an editor is wrong without it. clangd finds no compilation database, falls back to compiling each file with no include paths and no `-std`, and reports the first `#include "core/..."` as a file-not-found followed by a hundred errors that are all cascade from it. The file holds absolute paths and is gitignored, so it is generated per machine. It covers `src/core/` and `tests/`, and `src/fb2k/` on a Mac where `scripts/fetch-sdk.sh` has fetched the foobar2000 SDK, all but the files `fb2k_unparsed_sources` lists in `scripts/lib/compile-flags.sh`. Anywhere else the script says it skipped `src/fb2k/` and why.

`.github/workflows/plugin.yml` runs `scripts/test.sh`, both sanitizer suites, `scripts/format.sh --check` and `scripts/lint.sh` on a Linux runner for every change under `plugins/fb2k/` or to `contract/openapi.yaml`, and builds the component on a Windows runner, where `scripts\build.ps1` lints `src/fb2k/` and `scripts\test.ps1` runs. A macOS runner builds the bundle, runs `scripts/test.sh` and lints `src/fb2k/`. `scripts/lib/llvm.sh` pins the LLVM major, which the workflow's `llvm_major` follows: `scripts/format.sh` and `scripts/lint.sh` refuse any other clang-format or clang-tidy, since a local run matches CI only at that version. `CLANG_FORMAT` and `CLANG_TIDY` name the binary on a machine carrying more than one.

On Windows the same two steps are `scripts\fetch-opus.ps1` and then `scripts\test.ps1`. `scripts\lint.ps1` is clang-tidy over `src/fb2k/` against MSVC's headers, with the vcxproj's own defines and include paths, and the only lint of the files `fb2k_unparsed_sources` lists in `scripts/lib/compile-flags.sh`; `scripts\build.ps1` runs it after every build of the component, so a finding fails the build. It wants the LLVM major `scripts\lint.ps1` pins: `winget install LLVM.LLVM` on a machine, `.github/actions/windows-llvm` on a runner. The `.ps1` and `.sh` fetchers are the same fetch for different shells; run whichever belongs to the machine the tests will run on.

`plugins/fb2k/CONTRIBUTING.md`, *Tests*, rule 10, is what a machine that runs the suite needs beyond this directory.

`scripts/test.sh`'s own header has the rest of its arguments and what each one costs.

The tests need **neither Windows nor the foobar2000 SDK nor a running player**: everything they cover but the AAC codec files lives in `src/core/`, which compiles standalone. One set of AAC cases drives each platform's codec. `scripts/test.sh` on a Mac compiles `src/fb2k/aac_encoder_mac.cpp` and drives AudioToolbox's encoder; `scripts\test.ps1` on Windows with the SDK fetched compiles `src/fb2k/aac_encoder.cpp` and drives Media Foundation's; on Linux no AAC encoder is built in. Every run prints one line saying which: `AAC tested through this platform's codec.`, `AAC not tested: this platform's AAC encoder is unavailable on this machine`, or `AAC not tested: no AAC encoder is built into this suite.` They are feature tests rather than unit tests: `tests/` starts a real `HttpServer` on a real port and drives it with a real HTTP client, so an assertion about admission or a CORS header is about the bytes a browser would see.

Covered: admission, CORS and preflight, every way a hand-edited `config.json` can be wrong including a reload while the listener runs, the listener and its port collision, the preferences page's decisions, tag-write permission and the tag route, autoplaylist requests and their routes, the rate limiter with time passed in, the main-thread queue and its stall watch, the order refusals are weighed in and the order a budgeted route refuses in, stream tickets, the stream route, the audience and the listener roster, the output hold, the PCM and broadcast rings, the Ogg Opus encoder (whose tests decode their own output), the 16-bit conversion AAC is fed, AAC's framing, bitrates and refusals against a fake codec, the timeline and its route, the artwork route and what it will and will not send, and every key set and status `contract/openapi.yaml` publishes.

**No test reaches `src/fb2k/` but the two AAC codec files.** Both builds compile and link the rest, and on a Mac with the SDK fetched all of it but `preferences.cpp` and `aac_encoder.cpp` is parsed and linted. A compile is not a test: that code runs inside a player only.

Four end-to-end checks, in PowerShell, run against a real player on Windows. `scripts/verify-tag-write.ps1` writes a rating to every track in the test fixture playlist and reads it back **from the player**, through each row's `%rating%` column, which is the point rather than a formality: the failure this design exists to avoid is a write the player performed but its own database did not learn about. It refuses the whole playlist if any row sits outside the tree `scripts/test-fixtures.ps1` built, and puts back each track's own rating afterwards. `scripts/verify-stream.ps1` refuses a player that is not playing or not muted, then checks two listeners reading one encoder, a ticket, both formats well formed, the clock advancing, and a skipped track or a seek leaving a mark; the track and the place in it go back afterwards, pass or fail. `scripts/verify-listeners.ps1` checks the roster and the mute hold without writing the volume or the mute: who is listening, the linger, a hold taken and given back on an unmuted player or a person's own mute left alone on a muted one, and the player left at the level it was found at. `scripts/verify-library.ps1` checks the library routes against a real library, writing no tag and no playlist: `GET /api/state`'s library object, export and changes revalidation by ETag, the export capture with `-Full`, the player's own path order, covers through `/api/artwork`, and a forced rebuild, plus the two CORS checks when `-Origin` names an allowed origin.

`scripts/test-fixtures.ps1` builds the corpus those run against, out of files kept for the purpose rather than anybody's music. `-Corpus`, or `FOO_JEAN_CORPUS_DIR`, is the folder holding them, and the script refuses to run without it. It copies them into a tree of its own beside the player and adds the copies to a playlist of their own, with an internet radio stream beside them. **Tag writes are only ever pointed at that tree**, never at a real library.

The tree is two media library roots and a folder outside both, so one run reaches every address form. The roots hold a different recording at one library-relative path, which is the address the component refuses as ambiguous; nothing under the third folder has a library-relative address at all. Among the copies are one MP3, one FLAC and one M4A, a filename that is not ASCII, and a FLAC whose subsongs foobar2000 numbers from 1. **Registering the two roots as media library folders is by hand.** The script prints them at the end and changes nothing in the player's configuration.

## Releasing

`.github/workflows/release.yml` assembles `foo_jean.fb2k-component` from two builds of one page. A `ui` job builds `ui/` once and generates the table; the `build` job compiles it into `foo_jean.dll` on `windows-2022`; the `build-mac` job compiles it into the bundle on `macos-15` and runs `scripts/package-mac.sh` on that DLL, so the archive holds `x64/foo_jean.dll` and `mac/foo_jean.component`. `build-mac` needs `build`, so the archive exists only where both builds passed, and a tag publishes nothing otherwise. Every push to `main` uploads the archive as a workflow artifact. Pushing a tag matching `v*` also publishes it to a GitHub Release of that tag, once `scripts/release-tag.sh` has confirmed the tag is `v` followed by `kVersion` in `src/core/version.h`; a tag that does not match fails the workflow before anything is built.

A release carries `SHA256SUMS` and a build provenance attestation. To check a downloaded component, in the folder holding both files:

```bash
sha256sum -c SHA256SUMS
gh attestation verify foo_jean.fb2k-component --repo enrique-ramirez/jean
```

## Layout

```
src/core/     the portable half. Knows nothing about foobar2000
src/fb2k/     everything that touches the SDK, or an operating system
tests/        the suite, which runs against src/core/ on any machine
third_party/  cpp-httplib, nlohmann/json, doctest -- single MIT headers, committed.
              zlib -- a directory of C rather than a header, committed, zlib licence.
              libopus and libogg land here too, fetched rather than committed
sdk/          foobar2000 SDK, fetched not vendored (gitignored)
scripts/      fetch, build, test, lint, format, package, install, fixtures, verify
bin/, obj/, dist/   build output and the packaged component (gitignored)
```

`plugins/fb2k/ARCHITECTURE.md` is how the pieces fit and which thread owns what, `src/README.md` maps the source tree file by file, `plugins/fb2k/CONTRIBUTING.md` is how to write code in it, and `third_party/README.md` carries the vendored versions.

The HTTP contract is not in this tree. `contract/openapi.yaml` sits at the repository root, beside the conformance suite that measures an implementation against it.

## Licence

MIT, in `LICENSE` at the repository root. The foobar2000 SDK has its own terms and is not redistributed here.
