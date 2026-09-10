# foo_jean

A foobar2000 component that exposes over HTTP the things [beefweb](https://github.com/hyperblast/beefweb) does not: writing metadata tags, creating autoplaylists, reading the whole media library in one piece, and streaming what the player is playing. It runs *alongside* beefweb rather than replacing it, on its own port. Its first client is [Jean](https://github.com/enrique-ramirez/jean), though nothing here assumes it.

## What it does

**Writes metadata tags.** Your request arrives over HTTP and *foobar2000* performs the write, through `metadb_io_v2::update_info_async`, so the player's own database is current the instant the write returns. Anything writing tags from outside the player leaves that database stale until a rescan, so the rating your client just set does not come back when it asks. Ratings are the first caller, but nothing here is rating-shaped: it writes fields.

**Creates autoplaylists.** foobar2000 has a Media Library and beefweb cannot see it; an autoplaylist is a live library query that then shows up in beefweb's `/api/playlists` like any other playlist. This creates, updates, previews and deletes them, and annotates the playlist list with the one thing beefweb cannot say: which playlists are autoplaylists, and which of those are this component's.

**Serves the media library.** The whole of it, in one binary response, in whichever title-formatting columns the request asks for. The component keeps a snapshot of the library it walked, watches foobar2000's own change notifications to keep it current, and hands a client a small patch for what moved rather than the library again. A client that holds everything answers its own searches, counts and shelves without asking anybody. There is no paged route on purpose: paging needs a stable sorted order, producing one needs a full pass over every track, and this is where the database already sits in memory.

**Streams the player's output.** A live mirror of what foobar2000 is playing, in Ogg Opus or in AAC-LC for Safari. The capture is post-DSP and pre-volume, so silencing the player leaves the stream at full level: choosing a device moves the sound to it rather than doubling it. `GET /api/stream/listeners` says who else has it, and anybody can ask for the speakers back alongside them. It lives here because beefweb's static file server answers a `Range` request with the whole file and a `200`, so nothing built on top of beefweb can seek or stream.

## Building

The component is Windows-only, because beefweb is: the released `foo_beefweb.fb2k-component` carries no macOS bundle, so a Mac build would have no client to serve. Editing on one machine and building over SSH on a Windows one works well. On the build machine you need:

- **Visual Studio 2022 Build Tools** with the C++ workload **and the ATL component** (`Microsoft.VisualStudio.Component.VC.ATL`). `--includeRecommended` does not bring ATL, and the SDK's helpers include `atlbase.h`. The SDK ships MSBuild project files, so there is no CMake to write.
- **The foobar2000 SDK**, fetched by `scripts/fetch-sdk.ps1` into `sdk/`. It is not vendored: its licence does not permit redistribution.
- **WTL**, fetched by `scripts/fetch-wtl.ps1`. It is not ATL and does not ship with Visual Studio; `libPPUI` and the SDK helpers include `atlapp.h`, which is WTL's.
- **libopus and libogg**, fetched by `scripts/fetch-opus.ps1` here and by `scripts/fetch-opus.sh` on whatever machine runs the tests. Both are BSD; they are fetched rather than committed because together they are four megabytes of C. The fetch pins a version and checks a SHA-256.
- **Nothing else to fetch.** cpp-httplib, nlohmann/json and doctest are single MIT headers committed under `third_party/`, and zlib is committed beside them as a directory of C under the zlib licence. It is there because the foobar2000 SDK ships no deflate anywhere and cpp-httplib needs one to gzip a response.

```powershell
scripts\fetch-sdk.ps1
scripts\fetch-wtl.ps1
scripts\fetch-opus.ps1
scripts\build.ps1 -Project src\foo_jean.vcxproj   # -> bin\x64\Release\foo_jean.dll
scripts\package.ps1                                # -> dist\foo_jean.fb2k-component
```

### Build traps, each of which fails in a way that does not name its cause

- **`pfc` builds as `Release FB2K`; everything else as `Release`.** Passing `/p:Configuration=Release` globally fails at link with `LNK2005` on `pfc::crashHook`. `src/foo_jean.vcxproj` carries the mapping as `SetConfiguration` metadata on the pfc `ProjectReference`, which outranks the inherited property, so `msbuild` can be pointed straight at the project file.
- **The SDK targets the v142 toolset.** With VS 2022 alone every SDK project fails `MSB8020`. `build.ps1` overrides `PlatformToolset=v143` on the command line rather than retargeting the project files, so re-fetching the SDK is never destructive.
- **Never set `/p:UseEnv=true`.** It compiles, and then `rc.exe` fails on `winres.h`, because `UseEnv` swaps MSBuild's computed search paths for the environment wholesale and the resource compiler loses the Windows SDK's `um` directory. Include directories go through `Directory.Build.targets`.
- **`/d2notypeopt` is mandatory** on any project that touches SDK classes, or whole-program optimisation miscompiles them in release builds. The SDK's own projects set it; `src/foo_jean.vcxproj` sets it too.
- **x64 payloads go in an `x64\` subfolder** of the `.fb2k-component` zip; the top level is where legacy x86 is looked for. Put an x64 DLL there and foobar2000 loads nothing at all, silently. `scripts/package.ps1` writes that entry name explicitly and reads the archive back.
- **`pfc` is not fully reachable from the master header.** `pfc::format_filetimestamp` lives in `pfc/filetimetools.h`, which neither `foobar2000.h` nor `pfc.h` includes. The error is `C2039`, not a missing header.
- **`scripts\generate-sln.ps1`** builds an x64 solution over the SDK's own projects. It is needed only to build the SDK's `foo_sample`, which is how you prove a new machine's toolchain before there is any of this code to blame. `foo_jean.sln` at the repo root is for opening the tree in Visual Studio and is not used by the build.

## Installing

```powershell
scripts\install.ps1 -Foobar2000Dir <foobar2000-install>
```

foobar2000 must not be running: a loaded component DLL is locked. Pass `-StopPlayer` to have the script ask it to exit first. That is `/exit`, a request rather than a kill, so configuration, playlists and the media database are written out properly.

Two details the script handles and a hand installation must too. **The `x64\` folder does not survive installation**: foobar2000 flattens it, so an installed component is `<profile>\user-components-x64\foo_jean\foo_jean.dll`, and `install.ps1` copies the DLL rather than unpacking the package. And the profile is not always in `%APPDATA%`: a portable install keeps it beside the executable and announces itself with a `portable_mode_enabled` file, which the script tests for rather than assuming.

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
| `streamingEnabled` | `false`, or a `maxConcurrentStreams` of `0`, and the capture callback is never registered at all. `/api/capabilities` then reports `canStream: false`. |
| `opusBitrate` | Bits per second for the Opus stream, between 32000 and 510000. One bitrate rather than a per-request choice: each distinct value would need its own encoder and buffer for as long as anybody listened to it. Opus is hard to tell from the source above 192000, and libopus can barely spend more than 256000. |
| `aacBitrate` | Bits per second for the AAC stream, and **only 96000, 128000, 160000 or 192000**. Windows' AAC encoder refuses every other value, and a refusal costs the ADTS format altogether, which is the only one Safari can play. A value off the list is reported and replaced rather than passed on. |
| `maxConcurrentStreams` | Stream *connections*, which is not the same as listeners: **Safari holds two**, because it keeps its `Range` probe open alongside the real request. Over the cap is a `503` saying so. |
| `streamTicketTtlSeconds` | How long a stream ticket stays valid, between 10 and 3600. A ticket is **not** single-use, for the same Safari reason; the window is what bounds a leaked URL. |
| `muteWhileStreaming` | Silences the player while anybody is listening, so the sound moves rather than doubles. `false` makes the player one more speaker alongside every listener: fine a room away, an echo in the same room, because the stream runs a second or two behind. |

### The preferences page

**Preferences → Tools → Jean** edits the port, the bind address and the two lists; its **Devices** child page holds the token, a **Regenerate** button and **Pair a device**. Two pages rather than one because foobar2000 sizes a preferences page to the host window and does not scroll it, so a tall page has content nobody can reach. Between them they write `config.json` and nothing else, so a headless install loses nothing by never opening the page, and a key the page has no control for is carried through untouched rather than reset.

The page is stricter than the file parser, deliberately: a hand-edited file must never stop a headless player coming up, so a bad key there falls back to a default, while the dialog refuses and says what to type.

**Applying needs a restart, and the page says so.** Nothing rebinds a listening socket: the port, the address, the token and both lists are read once at start. The page shows *"changes require a restart"* whenever what is saved is not what the process is serving with.

## The API

**[`contract/openapi.yaml`](../../contract/openapi.yaml) is the contract.** Every shape, status and error string is written down there, hand-written, and a typed client is one command away. The component does not serve it; fetch it from the repository.

```sh
npx openapi-typescript contract/openapi.yaml -o fooJean.d.ts
```

| route | what it does |
|---|---|
| `GET /api/status` | Name and versions. The only route that needs no credential at all. |
| `POST /api/pair` | Read the token, during a window somebody opened at the player. |
| `GET /api/capabilities` | What this install permits, and what it can encode. |
| `POST /api/tags` | Write metadata to one track, addressed by path and subsong. |
| `GET /api/playlists` | Which playlists are autoplaylists, and which of those are this component's. |
| `POST /api/autoplaylists` | Create one. |
| `POST /api/autoplaylists/preview` | Try a query without creating anything. |
| `POST /api/autoplaylists/{id}` | Replace the specification of one this component created. |
| `DELETE /api/autoplaylists/{id}` | Delete one this component created. |
| `GET /api/library` | Both generations and how big the library is. Small, ETagged, and the thing to poll. |
| `GET /api/library/export` | The whole library, in the columns the request declares, as one binary snapshot. |
| `GET /api/library/changes` | What moved since a revision, per column. |
| `POST /api/library/refresh` | Walk the library again and replace the snapshot. Rate limited. |
| `GET /api/artwork` | The front cover of one library track, addressed by its library-relative path. |
| `POST /api/stream/ticket` | A short-lived credential for one stream connection, and where a device says who it is. |
| `GET /api/stream` | Listen. Takes a ticket in the query string, and `?format=opus\|aac`. |
| `GET /api/stream/timeline` | What is audible, in the stream's own clock. |
| `GET /api/stream/listeners` | Who is listening, and whether the player was silenced for them. |
| `DELETE /api/stream/hold` | Ask for the player to be audible alongside the listeners. |
| `POST /api/stream/leave` | Say that a device stopped listening on purpose. |

Every route but `/api/status`, `/api/pair` and `/api/stream` requires `Authorization: Bearer <token>`, compared in constant time. `/api/stream` takes a ticket instead, because an `<audio>` element cannot send a header; a bearer token is not accepted in its place. Any answer of 400 or above carries a JSON `error` string. Bodies are capped at 256 KB. A response is gzipped whenever the client offers `Accept-Encoding: gzip`. cpp-httplib does that itself for the JSON routes; the library routes drive the same compressor by hand, because `application/octet-stream` is not a type it will compress on its own. `GET /api/stream` stays out by that same gate, which is what keeps a live encode from being fed through a compressor.

### Writing tags

```
POST /api/tags
Authorization: Bearer <token>

{ "path": "C:\\Music\\Artist\\Album\\01. Track.mp3", "subsong": 0, "fields": { "rating": "4" } }
```

`subsong` is optional and defaults to 0. A value may be a string or a whole number, and an **empty string removes the tag**, which is how a client clears a rating rather than setting it to `"0"`. The response echoes what was written, and only the named fields are touched.

Three things must be true before anything is written, and they answer differently on purpose: the field is on the allowlist, compared case-insensitively, or **403** naming the field; the path is a plain absolute local path, with no relative segment, UNC share or URL scheme, or **400**; and foobar2000 already knows the track, meaning it is in the Media Library or an open playlist, or **404**.

### Autoplaylists

`GET /api/playlists` **annotates, it does not list.** Titles, item counts and which playlist is current come from beefweb, which answers them well. Ask beefweb for its playlists, ask this for the annotations, and join the two on `beefwebId`, which is `null` until beefweb next rebuilds its map, so **ask beefweb first** for a playlist you just created.

Creating takes a required `title` and `query`, plus optional `sort`, `forceSort` and `key`. `key` is opaque here and handed back verbatim, so a client can recognise its own playlists without encoding a convention in a title the user may edit; it must be unique, so creating the same one twice is a `409`.

Two things to know before building on this:

- **Existing playlists are never converted.** Taking a populated playlist over would replace its contents, and a route that can silently empty a hand-built playlist is not one this component offers.
- **Only playlists this component created can be updated or deleted.** Anything else is a `403`. The playlists are real and visible, one tab each in the player, so somebody may rename yours at any time. Recognise your own by `key`, never by title.

`preview` runs the query through foobar2000's own parser and counts it against the core's library index. **A query that does not parse is still a `200`**, carrying `valid: false` and the player's own message: this is the route a client calls while somebody is typing. Creating with the same query is a `400`, because there it is an instruction rather than data. Debounce it, since it runs on the main thread. An autoplaylist filters the Media Library and only that, so on an install with none configured every one of them comes up empty, which is why `preview` also reports `libraryEnabled`.

**The query language is foobar2000's and stays that way.** Queries are passed through untouched, so **quoting is the client's job**: a genre named `Rock" OR %rating% IS 5` pasted in unquoted makes a perfectly valid query that is not the one anybody meant, and no validation here can catch it.

**There is deliberately no event stream.** beefweb already raises its `playlists` event for playlists this component creates, so a client subscribed there re-reads `GET /api/playlists` and has the annotation.

**Creating, updating and deleting share a token bucket**: a burst of thirty, refilling at one a second, then `429` with `Retry-After`, and one log line per burst rather than per refusal. Whoever holds the token can already rewrite tags, so this is not a security control; it bounds how fast a client bug turns into hundreds of playlist tabs. Reading and previewing are not limited.

### The media library

`GET /api/library/export?columns=…` is the whole library in one response. The columns are title-formatting expressions, the component evaluates exactly those and interprets none of them, and **the request is the declaration**: the set it names becomes the set every later rebuild evaluates.

Asking takes two steps, because the first build is the slow one. Ask, and take either the blob or a `202` saying a snapshot of that set is being built. On a `202`, poll `GET /api/library` until `ready` is true and its `columns` have the same members as the set asked for, then ask again. Order does not matter for that comparison; it decides only where a column lands in the header. Asking a second time for a set already building starts no second build.

The body is a four-character tag, a length, a JSON header and a blob: one dictionary of strings and one array of ids per column, every offset four-byte aligned so that a typed-array view over the buffer is legal. `contract/openapi.yaml` carries the whole of it. Read it as an `ArrayBuffer` rather than as text. A snapshot past the component's ceiling answers `413` rather than a truncated body.

**An ordinal is a track's position in the snapshot, and it is the only handle these routes use.** Ordinals are in library-relative path order, compared the way foobar2000 compares paths itself rather than byte by byte: a run of digits counts as a number and case does not count at all, so `2 Mello` comes before `10cc`. Ties are broken by subsong and then by the player's own canonical path, so the order is total and does not shuffle between rebuilds. An ordinal means nothing across a `structure` change.

Both generations sit in `GET /api/library`. `structure` moves when tracks are added or removed, and a client seeing it move exports again, because ordinals have shifted under it. `revision` moves when rows change in place, and a client seeing only that asks `GET /api/library/changes?since=…` for a patch. A delta names the columns that moved and carries their changed ids and the dictionary entries added since, so a play count going up says nothing about titles. A different `structure` is a `409`, and a `since` older than the retained window is a `410`.

**Two mechanisms keep the snapshot current, and neither is a promise.** foobar2000's own change notifications cover a real tag change, wherever it came from, and every track is re-read as it stops playing, which is what catches a play count that no component announced. A component keeping its data privately and publishing it through a title-formatting hook can leave a value stale until that track next plays, and foobar2000's own playlist columns show the same stale value. `POST /api/library/refresh` is the hand on the wheel, and it is rate limited.

None of these routes is reachable without the bearer token. A library says where somebody keeps their files and what they listen to.

### Artwork

`GET /api/artwork?track=…` is one front cover. The address is a track's library-relative path, `directory` and `filename` from the snapshot concatenated, and it is a lookup key rather than a path: the component matches it against what the player reported and joins it to nothing, so there is no file outside the media library to name. An address the snapshot does not carry is a `404` and never another record's sleeve.

**A relative path rather than an ordinal, so one album is one URL for as long as the file is there.** An ordinal means nothing across a `structure` change, so a URL built from one would have to name the generation and would then change every time a track was added anywhere in the library, emptying a browser's cache of every cover at once. A client points every row of a record at the one address and lets the browser store, deduplicate and revalidate it.

`Cache-Control: no-cache` says to keep the bytes and ask before drawing them again. The `ETag` is a fold over the size and modification time of whichever file the picture came from, taken with a `stat`: a conditional request costs that stat and never a read or a decode. **It is also the only thing that sees a folder image change**, which foobar2000 announces to nobody.

The body is `image/jpeg`, `image/png`, `image/gif`, `image/webp` or `image/bmp`, decided from the bytes rather than from a filename, and anything else is a `404`. Covers are never compressed. A picture past 16 MiB is a `413`. Requests are bounded by a burst of 300 refilling one every 50 milliseconds, which a grid of covers never meets and a looping client does.

### Streaming

`POST /api/stream/ticket` returns a short-lived ticket; `GET /api/stream?ticket=...` is an endless `audio/ogg` or `audio/aac` response, chunked, `no-store`, with no `Content-Length` and `Accept-Ranges: none`. `?format=` takes anything `/api/capabilities` lists in `streamFormats`, best first; anything else is a `400` naming what this install does encode. One encoder per format feeds every listener of it.

Three things a client must handle:

- **A reconnect needs a fresh ticket.** An endless response ends on any network blip and an `<audio>` element will not retry by itself, so reconnecting is a path you have to have anyway. A browser address bar is not a way to test this: Firefox's generated media document fetches the URL a second time.
- **A listener that connects while the player is stopped gets the container headers and then nothing.** That is correct, because there is no audio, but a media element cannot start from headers alone and will sit waiting with no error. Tell those two states apart from the *player's* state, not from the stream.
- **One device is routinely two connections**, or three across a reconnect. Count devices, never connections, anywhere you say how many people are listening.

`GET /api/stream/timeline` gives the stream's own clock and the marks in it: where each track started, its display path, and where the player was in it. It describes what a listener hears rather than what the player is doing, so it is what a progress bar or scrolling lyrics should follow; the spec carries the arithmetic. A seek marks the same way a track change does.

`GET /api/stream/listeners` is the roster: one row per device, with what it called itself, its format, how many connections it holds and how long it has been listening. Nothing in it names an address or a user agent. It also reports `playerMuted`, so a client showing a fader pinned to the bottom can say why. `DELETE /api/stream/hold` asks for the player to be audible alongside everyone, and `POST /api/stream/leave` is how a device says it stopped on purpose rather than dropped off the network.

## Pairing a device

The token is 64 hex characters, which is unpleasant to type on a phone and unreasonable on a television remote. So:

1. At the player, **Preferences → Tools → Jean → Devices → Pair a device**. A two-minute window opens and the pane counts it down.
2. On the device, in the client's settings, press **Pair**.

Four bounds make that safe and none is optional: a window somebody opened at the player, with no way to open one remotely; **one grant per press**, the first success closing the window; **private source addresses only**, meaning RFC1918, loopback and link-local and their IPv6 forms, checked *before* the window, so a caller from outside neither learns whether one is open nor spends the grant; and a readable history, since the pane names the last device paired and every pairing is logged. `Content-Type: application/json` is required so that a cross-origin caller is always preflighted. `plugins/fb2k/ARCHITECTURE.md` has the whole model, including what it deliberately does not defend against.

Pairing hands out the token this install already has rather than minting one per device, so regenerating the token still locks out every device. `POST /api/pair` accepts an optional `name` so that per-device tokens can be added later without changing clients.

## How a client finds it

On every start the component writes `<profile>/beefweb/clientconfig/foo_jean.json`, which beefweb serves at `GET /api/clientconfig/foo_jean`, **same-origin** for anything beefweb is already serving, so one request replaces a port scan:

```json
{ "name": "foo_jean", "version": "0.1.0", "apiVersion": 1,
  "port": 8881, "authRequired": true, "listening": true }
```

No component, no file, and beefweb answers `null`, so treat this as optional and light up features only when it is there. A listener that failed to start still publishes a record, with `"listening": false` and the reason.

**The token is never in that file**, and the record is a hint rather than a place to send credentials. `POST /api/clientconfig/{id}` is a real beefweb route, `changeClientConfig` defaults to on, and beefweb ships without authentication, so anyone who can reach beefweb can overwrite the record and name any port they like. A client MUST call unauthenticated `GET /api/status` on the advertised port first and require `name` to be `foo_jean` before sending the token.

## Testing

```bash
scripts/fetch-opus.sh                     # once; the suite links libopus and libogg
scripts/test.sh                           # the whole suite
scripts/test.sh '-sf=*cors_test.cpp'      # one file. -sf is source-file, and needs the glob
scripts/test.sh --sanitize=thread         # ThreadSanitizer. --sanitize= goes first, before doctest's arguments
scripts/format.sh --check                 # clang-format, without writing
scripts/lint.sh                           # clang-tidy over src/core/ and tests/
```

On Windows the same two steps are `scripts\fetch-opus.ps1` and then `scripts\test.ps1`. The `.ps1` and `.sh` fetchers are the same fetch for different shells; run whichever belongs to the machine the tests will run on.

`plugins/fb2k/CONTRIBUTING.md` rule 11 is what a machine that runs the suite needs beyond this directory.

`--sanitize=` takes `address`, `thread` or `leaks`. Each instrumented build keeps its own object directory under `bin/`, so a plain run and an instrumented one never contaminate each other. `leaks` is macOS's own tool rather than LeakSanitizer, which has no implementation on this platform, and it inspects the ordinary uninstrumented build because it refuses an ASan heap; it is a conservative scanner, so a clean run promises less than a green LeakSanitizer run would, and it exists on macOS alone.

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
