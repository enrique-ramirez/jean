# foo_jean

A foobar2000 component that exposes over HTTP the things [beefweb](https://github.com/hyperblast/beefweb) does not: writing metadata tags, creating autoplaylists, reading the whole media library in one piece, and streaming what the player is playing. It runs *alongside* beefweb rather than replacing it, on its own port. Its first client is [Jean](https://github.com/enrique-ramirez/jean), though nothing here assumes it.

## What it does

**Writes metadata tags.** Your request arrives over HTTP and *foobar2000* performs the write, through `metadb_io_v2::update_info_async`, so the player's own database is current the instant the write returns. Anything writing tags from outside the player leaves that database stale until a rescan, so the rating your client just set does not come back when it asks. Ratings are the first caller, but nothing here is rating-shaped: it writes fields.

**Creates autoplaylists.** foobar2000 has a Media Library and beefweb cannot see it; an autoplaylist is a live library query that then shows up in beefweb's `/api/playlists` like any other playlist. This creates, updates, previews and deletes them, and annotates the playlist list with the one thing beefweb cannot say: which playlists are autoplaylists, and which of those are this component's.

**Serves the media library.** The whole of it, in one binary response, in whichever title-formatting columns the request asks for. The component keeps a snapshot of the library it walked, watches foobar2000's own change notifications to keep it current, and hands a client a small patch for what moved rather than the library again. A client that holds everything answers its own searches, counts and shelves without asking anybody.

**Streams the player's output.** A live mirror of what foobar2000 is playing, in Ogg Opus or in AAC-LC for Safari. The capture is post-DSP and pre-volume, so silencing the player leaves the stream at full level: choosing a device moves the sound to it rather than doubling it. `GET /api/stream/listeners` says who else has it, and anybody can ask for the speakers back alongside them. It lives here because beefweb's static file server answers a `Range` request with the whole file and a `200`, so nothing built on top of beefweb can seek or stream.

## Building

The component is Windows-only, because beefweb is: the released `foo_beefweb.fb2k-component` carries no macOS bundle, so a Mac build would have no client to serve. Editing on one machine and building over SSH on a Windows one works well. On the build machine you need:

- **Visual Studio 2022 Build Tools** with the C++ workload **and the ATL component** (`Microsoft.VisualStudio.Component.VC.ATL`). `--includeRecommended` does not bring ATL, and the SDK's helpers include `atlbase.h`. The SDK ships MSBuild project files, so there is no CMake to write.
- **The foobar2000 SDK**, fetched by `scripts/fetch-sdk.ps1` into `sdk/`. It is not vendored: its licence does not permit redistribution.
- **WTL**, fetched by `scripts/fetch-wtl.ps1`. It is not ATL and does not ship with Visual Studio; `libPPUI` and the SDK helpers include `atlapp.h`, which is WTL's.
- **libopus and libogg**, fetched by `scripts/fetch-opus.ps1` here and by `scripts/fetch-opus.sh` on whatever machine runs the tests. Both are BSD; they are fetched rather than committed because together they are four megabytes of C. The fetch pins a version and checks a SHA-256.
- **Nothing else to fetch.** cpp-httplib, nlohmann/json and doctest are single MIT headers committed under `third_party/`, and zlib is committed beside them as a directory of C under the zlib licence. `third_party/README.md` carries the versions and why each one is the one vendored.

```powershell
scripts\fetch-sdk.ps1
scripts\fetch-wtl.ps1
scripts\fetch-opus.ps1
scripts\build.ps1 -Project src\foo_jean.vcxproj   # -> bin\x64\Release\foo_jean.dll
scripts\package.ps1                                # -> dist\foo_jean.fb2k-component
```

### Build traps

This build has several traps, each of which fails in a way that does not name its cause, and each is written down where it is enforced rather than listed here. `src/foo_jean.vcxproj`'s own header covers what the project file settles, `scripts/build.ps1` the toolset and the compiler flags, `scripts/package.ps1` where an x64 payload goes in the archive, and `scripts/generate-sln.ps1` the per-project configuration. Read all four before debugging a link, a packaging or a resource-compiler error.

Two things about the solutions, which no script says. **`scripts\generate-sln.ps1` exists to build the SDK's own `foo_sample`**, which is how you prove a new machine's toolchain before there is any of this code to blame. **`foo_jean.sln` in this directory is for opening the tree in Visual Studio** and is not used by the build.

## Installing

```powershell
scripts\install.ps1 -Foobar2000Dir <foobar2000-install>
```

foobar2000 must not be running, and `-StopPlayer` has the script ask it to exit first. That is `/exit`, a request rather than a kill, so configuration, playlists and the media database are written out properly.

A hand installation has to reproduce what the script does, and `scripts/install.ps1`'s own header says what that is. One thing it does not: the profile is not always in `%APPDATA%`. A portable install keeps it beside the executable and announces itself with a `portable_mode_enabled` file, which the script tests for rather than assuming.

The script never runs `foobar2000.exe` directly, and neither should anything else over SSH. See `plugins/fb2k/CLAUDE.md`, *Driving the player*.

`scripts/deploy.local.sh` does the whole round trip from an editing machine: run the tests, sync, build, package, install. It is gitignored, because the route to a player is personal to whoever has one. It reads `FOO_JEAN_SSH`, `FOO_JEAN_REMOTE` and `FOOBAR2000_DIR`.

## Configuring

Everything is a file. `<profile>/foo_jean/config.json` is written on first start with a generated token, and it is the source of truth rather than a fallback for a dialog: this component is built for installs with nobody at the keyboard.

```json
{
  "port": 8881,
  "bindAddress": "0.0.0.0",
  "authToken": "generated on first run, 32 bytes of OS randomness as 64 hex characters",
  "allowedOrigins": [],
  "allowedFields": ["rating"],
  "maxAutoPlaylists": 100,
  "writePlaylists": true,
  "streamingEnabled": true,
  "opusBitrate": 256000,
  "aacBitrate": 192000,
  "maxConcurrentStreams": 8,
  "streamTicketTtlSeconds": 120,
  "muteWhileStreaming": true
}
```

Every key is optional. An absent key keeps its default; a present but malformed one logs a line naming it and keeps its default, so a single bad edit cannot stop a headless player coming up. A key that is not a setting at all is reported too, because a typo like `bindaddress` otherwise changes nothing and says nothing.

| key | meaning |
|---|---|
| `port` | Default 8881, because beefweb's is 8880 and this runs alongside it. If the port is taken the component refuses to start and says so in the log and in its discovery record; it never quietly picks another, because a client can only find it at a port it can predict. |
| `bindAddress` | Every local interface by default, the same as beefweb. Set it to `127.0.0.1` to harden deliberately. |
| `authToken` | Mandatory. An empty token means the listener refuses to start; a token shorter than 32 characters is refused outright. There is no unauthenticated mode to fall into. |
| `allowedOrigins` | Empty reflects any origin, so a client works wherever it is served from. List origins to narrow it to exactly those, matched whole and case-insensitively. `POST /api/pair` is the exception, and `plugins/fb2k/ARCHITECTURE.md` has why. |
| `allowedFields` | The write allowlist. Nothing outside it is ever written, and clients read it from `/api/capabilities` rather than being configured twice. Empty switches writing off. |
| `maxAutoPlaylists` | How many autoplaylists this component will keep at once, counting only the ones it created. `0` switches creation off. |
| `writePlaylists` | `true` by default, so leaving it alone permits every playlist write this component can make: create, add, edit, delete, reorder, rename. Set it to `false` to make every playlist and autoplaylist read-only except the component's own scratch playlist, which stays writable because it is how Jean works rather than the user's music. |
| `streamingEnabled` | `false`, or a `maxConcurrentStreams` of `0`, and the capture callback is never registered at all. `/api/capabilities` then reports `canStream: false`. |
| `opusBitrate` | Bits per second for the Opus stream, between 32000 and 510000. One bitrate rather than a per-request choice: each distinct value would need its own encoder and buffer for as long as anybody listened to it. Opus is hard to tell from the source above 192000, and libopus can barely spend more than 256000. |
| `aacBitrate` | Bits per second for the AAC stream, and **only one of four values**, which `src/core/settings.h` names beside the reason. A refusal would cost the ADTS format altogether, which is the only one older Safari can play, so a value off the list is reported and replaced rather than passed on. |
| `maxConcurrentStreams` | Stream *connections*, which is not the same as listeners: one device is routinely two, for the reason `plugins/fb2k/ARCHITECTURE.md`, *Facts about the player*, gives. Over the cap is a `503` saying so. |
| `streamTicketTtlSeconds` | How long a stream ticket stays valid, between 10 and 3600. A ticket is **not** single-use, for that same reason; the window is what bounds a leaked URL. |
| `muteWhileStreaming` | Silences the player while anybody is listening, so the sound moves rather than doubles. `false` makes the player one more speaker alongside every listener: fine a room away, an echo in the same room, because the stream runs a second or two behind. |

### The preferences page

**Preferences → Tools → Jean** edits the port, the bind address and the two lists; its **Devices** child page holds the token, a **Regenerate** button and **Pair a device**. Two pages rather than one because foobar2000 sizes a preferences page to the host window and does not scroll it, so a tall page has content nobody can reach. Between them they write `config.json` and nothing else, so a headless install loses nothing by never opening the page, and a key the page has no control for is carried through untouched rather than reset.

The page is stricter than the file parser, deliberately: a hand-edited file must never stop a headless player coming up, so a bad key there falls back to a default, while the dialog refuses and says what to type.

**Applying needs a restart, and the page says so.** Nothing rebinds a listening socket: the port, the address, the token and both lists are read once at start. The page shows *"changes require a restart"* whenever what is saved is not what the process is serving with.

## The API

**[`contract/openapi.yaml`](../../contract/openapi.yaml) is the contract.** Every route, every shape, every status and every error string is written down there, by hand, with the reasoning a client needs beside each one. The component does not serve it; fetch it from the repository, and a typed client is one command away:

```sh
npx openapi-typescript contract/openapi.yaml -o fooJean.d.ts
```

`contract/` beside it is the conformance suite that measures an implementation against it. `plugins/fb2k/ARCHITECTURE.md` is the design behind the spec: which routes are reachable without a credential and what keeps that safe, how the media library snapshot is built and kept current, and what the audio path is made of.

Two things hold across the whole surface. Every route but `/api/status`, `/api/pair` and `/api/stream` requires `Authorization: Bearer <token>`, compared in constant time; `/api/stream` takes a ticket instead, because an `<audio>` element cannot send a header, and a bearer token is not accepted in its place. And a response is gzipped whenever the client offers `Accept-Encoding: gzip`, which `third_party/README.md` has the mechanics of, including what keeps the live encode out of the compressor.

## Pairing a device

The token is 64 hex characters, which is unpleasant to type on a phone and unreasonable on a television remote. So:

1. At the player, **Preferences → Tools → Jean → Devices → Pair a device**. A two-minute window opens and the pane counts it down.
2. On the device, in the client's settings, press **Pair**.

Four bounds make that safe and not one of them is optional. `plugins/fb2k/ARCHITECTURE.md`, *Pairing, and one accepted risk*, is what they are, and what the arrangement deliberately does not defend against.

## How a client finds it

On every start the component writes `<profile>/beefweb/clientconfig/foo_jean.json`, which beefweb serves at `GET /api/clientconfig/foo_jean`, **same-origin** for anything beefweb is already serving, so one request replaces a port scan:

```json
{ "name": "foo_jean", "version": "0.3.0", "apiVersion": 1,
  "port": 8881, "authRequired": true, "listening": true }
```

No component, no file, and beefweb answers `null`, so treat this as optional and light up features only when it is there. A listener that failed to start still publishes a record, with `"listening": false` and the reason.

**The token is never in that file**, and the record is a hint rather than a place to send credentials. `POST /api/clientconfig/{id}` is a real beefweb route, `changeClientConfig` defaults to on, and beefweb ships without authentication, so anyone who can reach beefweb can overwrite the record and name any port they like. A client MUST call unauthenticated `GET /api/status` on the advertised port first and require `name` to be `foo_jean` before sending the token.

## Testing

```bash
scripts/fetch-opus.sh                     # once; the suite links libopus and libogg
scripts/test.sh                           # the whole suite
scripts/test.sh '-sf=*cors_test.cpp'      # one file
scripts/test.sh --sanitize=thread         # ThreadSanitizer
scripts/format.sh --check                 # clang-format, without writing
scripts/lint.sh                           # clang-tidy over src/core/ and tests/
scripts/compile-commands.sh               # what an editor's clangd reads
```

`scripts/compile-commands.sh` writes `compile_commands.json`, and an editor is wrong without it. clangd finds no compilation database, falls back to compiling each file with no include paths and no `-std`, and reports the first `#include "core/..."` as a file-not-found followed by a hundred errors that are all cascade from it. The file holds absolute paths and is gitignored, so it is generated per machine. It covers `src/core/` and `tests/`; `src/fb2k/` resolves only where the foobar2000 SDK and the Windows SDK are, which is the build machine.

`.github/workflows/plugin.yml` runs `scripts/test.sh`, `scripts/format.sh --check` and `scripts/lint.sh` on a Linux runner for every change under `plugins/fb2k/` or to `contract/openapi.yaml`. The two that need clang-format and clang-tidy pin the version they install.

On Windows the same two steps are `scripts\fetch-opus.ps1` and then `scripts\test.ps1`. The `.ps1` and `.sh` fetchers are the same fetch for different shells; run whichever belongs to the machine the tests will run on.

`plugins/fb2k/CONTRIBUTING.md` rule 11 is what a machine that runs the suite needs beyond this directory.

`scripts/test.sh`'s own header has the rest of its arguments and what each one costs.

The tests need **neither Windows nor the foobar2000 SDK nor a running player**: everything they cover lives in `src/core/`, which compiles standalone. They are feature tests rather than unit tests: `tests/` starts a real `HttpServer` on a real port and drives it with a real HTTP client, so an assertion about a bearer token or a CORS header is about the bytes a browser would see. Run the suite more than once before believing it; `tests/support/test_server.cpp` retries a port race.

Covered: authentication, CORS and preflight, every way a hand-edited `config.json` can be wrong, the discovery record, the listener and its port collision, pairing, the preferences page's decisions, tag-write permission and the tag route, autoplaylist requests and their routes, the rate limiter with time passed in, stream tickets, the stream route, the audience and the listener roster, the output hold, the PCM and broadcast rings, the Ogg Opus encoder (whose tests decode their own output), the timeline and its route, the artwork route and what it will and will not send, and every key set and status `contract/openapi.yaml` publishes.

**Nothing here covers `src/fb2k/`.** That half needs the SDK and compiles for the first time on the build machine.

Three end-to-end checks run against a real player. `scripts/verify-tag-write.ps1` writes a rating to every track in the test fixture playlist and reads it back **through beefweb**, which is the point rather than a formality: the failure this design exists to avoid is a write the player performed but its own database did not learn about. `scripts/verify-stream.ps1` checks the stream with playback going: two listeners reading one encoder, a ticket, both formats well formed, the clock advancing, and a skipped track leaving a mark. `scripts/verify-listeners.ps1` checks the roster and the mute hold: who is listening, the player silenced for them, and the level put back afterwards.

`scripts/test-fixtures.ps1` builds the corpus those run against: one MP3, one FLAC, one M4A and one with a non-ASCII filename, copied out of the library into a scratch directory and added to their own playlist. **Tag writes are only ever pointed at those**, never at a real library.

## Layout

```
src/core/     the portable half. Knows nothing about foobar2000
src/fb2k/     everything that touches the SDK, or Windows
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

TBD. The foobar2000 SDK has its own terms and is not redistributed here.
