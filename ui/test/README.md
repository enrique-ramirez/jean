# Tests

Two suites, and the split is not about speed. **`test/e2e/` is the suite**: end-to-end, in a real browser, against a fake player, since what breaks in Jean needs real layout, real pointers and a real viewport: the virtualiser renders nothing without layout, `dnd.ts` hit-tests with `elementFromPoint`, the gestures are pointer and touch streams, and half the design is a *different component* on a phone rather than a narrower one.

**`test/unit/` is for logic with no user-visible surface of its own**, under `node --test` in milliseconds. A unit test goes there only where the user cannot see the thing being asserted: the shape of the play-count curve, the order `refsOfShelf` sorts refs into, the escape inside a foobar2000 query, the keymap's layout rule, which Playwright cannot reach at all, since Chromium synthesises US QWERTY codes. **Where the user can see it, the e2e stays**, and may keep a unit test beside it for an edge the browser cannot reach. A user searching for "Heavy Metal" cares that they get Heavy Metal; that `genreQuery` composed a particular string is not the test.

## Running it

```sh
pnpm test                                              # unit, then e2e on desktop and mobile
pnpm test:unit                                         # node --test over test/unit/
pnpm test:e2e                                          # playwright only
pnpm test:ui                                           # pick and watch interactively
pnpm test:e2e --project=desktop -g "double-clicking"   # one test
```

`test/alias.ts` is loaded through `--import` before the unit tests, as a `node:module` resolve hook. It teaches node three things about `src/` that it does not know: `@/` is Vite's alias, imports there carry no extension, and the values Vite substitutes through `define` are globals here rather than constants folded into a bundle. Node's own type stripping does the rest, so there is no bundler and **no jsdom** anywhere in this repo.

`locales.test.ts` checks every translation in `public/locales/` against the English catalogue: unknown keys, plural forms, and fields the English does not carry. Nothing in a browser can see any of that: a wrong key falls back to English silently and a wrong field renders as `{prot}` on a screen nobody has opened.

`pnpm test:e2e` builds first. `globalSetup` in `playwright.config.ts` runs `test/e2e/build.ts`, which is `vite build` alone, and serves that build from the fake, since that is the component's own arrangement: one origin answering both the app and `/api`. `JEAN_DIST=/some/dir pnpm test:e2e` builds and serves from that directory instead, so a second run, or a `pnpm build`, cannot rewrite the files the first is serving. There is no `webServer` block; the fake is a worker fixture and `baseURL` is set per worker to the port it landed on.

Both projects, `desktop` and `mobile` (Pixel 7, touch on), run every spec. Skip explicitly when a gesture has no equivalent on the other surface, and say why.

`pnpm test:iphone` runs the `@iphone`-tagged subset under real WebKit (`iphone` project, opt-in and absent from every other run). It exists for what Chromium's touch emulation cannot stand in for: WebKit's own gesture and audio policy.

**The component is installed and serving by default**, because it is what answers the library and a run without it has no music at all. A spec that wants no component sets `fooJean: { reachable: false }`, the one state most of the suite is not about.

## Profiling

`pnpm perf` measures seven costs of a large library, named B1 to B7: the cold load to the first rows of All Music (B1), a play-count delta (B2), a keystroke in search (B3), opening an album, an artist or a genre (B4), the JavaScript heap once idle (B5), a reload (B6) and one album added (B7). It writes one JSON report to `_tmp/035-perf/report-<timestamp>.json`. It drives the `playwright` browsers directly rather than the test runner, so it reads no project from `playwright.config.ts`.

```sh
pnpm perf --tracks 37000                       # a fake of that size, on a free port, in a process of its own
pnpm perf --tracks 37000,400000 --runs 5       # several sizes, one fake each
pnpm perf --tracks 37000 --projects desktop    # desktop, mobile, iphone and firefox are the projects
pnpm perf --url https://player.example         # a player already serving Jean
pnpm perf --tracks 37000 --trace               # also a Chromium timeline of B2 and B3 from the first run
```

The page is built once into `_tmp/035-perf/dist` and served by the fake beside its API, as the component serves it. The fake runs without its export ceiling, and every size says whether its export is over the component's (`aboveCeiling`), since a number taken there is not one the component could serve. Against a player, B2 and B7 are unavailable: they need the fake's `/__control/` routes.

The report is rewritten after every cell, so a run that is killed keeps what it measured. A cell not finished in its bound (two minutes for a load, one for the rest) is recorded as `{ over, reason }`, the reason carrying what the page showed. If the page then stops answering, the cells left in that run are recorded the same way and the next run starts in a fresh browser.

Each project runs its cells `--runs` times (three by default) in a fresh browser context and reports `{ runs, median, spread }`, the spread being the largest run minus the smallest. `mobile` is Pixel 7 emulation under Chromium's 4x CPU throttle. `iphone` is Playwright's WebKit with the iPhone 15 descriptor and cannot be throttled; `firefox` is the desktop descriptor.

- **B2 and B3's tasks** are the longest gap between two turns of a zero-delay timer, the one measure every engine has. Chromium's `longtask` observer is reported beside it as `longestLongTask`; it reports nothing under 50 ms, and Firefox and WebKit have none.
- **B5** is `Runtime.getHeapUsage` after a forced collection, which is Chromium's alone and does not count the memory behind typed arrays.
- **B7** starts at the control request, so it includes the player's own settle, and its bytes are every response finished until the list shows the album, state polls included.
- **The export block** holds the plain and gzipped bytes of the export for the columns Jean declares, each column's bytes and share of the plain total, and `decodeMs`, `decodeJlib` in Node over those bytes.
- **`scroll`** holds the tallest element each browser honours and the last row of a 46 px list that gives, found by bisection on the `scrollHeight` of a plain overflow element, and the track list itself scrolled to its end, with the last row it rendered against its `aria-rowcount`.

## Touch gestures

`touchDrag` in `gestures.ts` drives a finger through CDP rather than dispatching DOM events, since most of these tests are about *the browser's* decision on who a gesture belongs to and a dispatched `touchmove` sails past that.

Two things it does that are not optional. **Every point carries a timestamp**: `useSwipe` reads a slow enough gesture as a scroll rather than a flick, and a gesture is one round trip per point, so on a loaded machine an unstamped drag silently stops being a flick. And **one CDP session per page, never one per drag**: detaching a session while the next is dispatching drops the moves in between, and the gesture arrives as a tap where it started.

## The fake player

`test/fake-api/` is a small in-memory foobar2000. It implements the routes the app uses and holds real playlists. Position advances in the app's own interpolation, so a test depending on the fake ticking would be testing behaviour the real player does not have.

Run it alone to develop with no player in reach:

```sh
pnpm fake                                    # the component's API, on :8881
pnpm fake --tracks 1000000 --no-ceiling      # a generated library of that size, past the component's export ceiling
FOO_JEAN_URL=http://localhost:8881 pnpm dev  # in another shell

pnpm build && node test/fake-api/main.ts --serve dist   # page and API together, as the component serves them
```

### The routes run in two places

Everything under `fake-api/` that `handleFooJean` and `routes.ts` reach, `fooJean/` and `state.ts` included, has no host in it and no `node:` import; only `server.ts` and `capture.ts` import from `node:`. `server.ts` gives them a node socket for the suite; `demo/sw.ts` gives the same tables a `fetch` event. The seam is `Responder` in `http.ts`: `writeHead`, `setHeader`, `write`, `end` and `on("close")`, plus an optional readonly `writableEnded`. `ServerResponse` satisfies all of it as it stands, and the last two are what the audio pump stops on when a client leaves.

Two consequences before adding a route. **Anything reaching for a socket, a file or a `Buffer` belongs in the host files**, not the route tables; the artwork routes are the worked example and take a function instead of a path. And **fixtures are imported rather than read off disk**, since one of the two hosts has no filesystem.

### The fixture is captured, not invented

`library.json` and `player.json` came off a real player via `node test/fake-api/capture.ts --url http://<player-host>:8881`, the origin `foo_jean` serves from, so the fake replays bytes foobar2000 actually produced. Five albums, 54 tracks, chosen for the branches the UI has:

| | why it is in there |
|---|---|
| Babasónicos, *Jessico* | accented artist, for `fold()`; played throughout |
| Brand New, *Deja Entendu* | the heat range: one never-played track among heavily played ones |
| Alice in Chains, *Jar Of Flies* | FLAC rather than MP3, short, and a non-square cover |
| As Tall as Lions, *Lafcadio* | never played at all: no heat, no patina, no last-played |
| Have a Nice Life, *Deathconsciousness* | two discs, so `%tracknumber%` restarts mid-album |

Tracks are stored as objects keyed by title-formatting expression, not as the positional arrays the API returns: the fake has to answer whatever column set is asked of it, and **an expression the fixture does not carry resolves to `?`**, exactly as an unsupported field does on a real player. The exceptions are `$meta(x)`, which answers empty for a missing field, and two-argument `$if2`, both evaluated after the literal lookups miss. A written tag is kept under both `%field%` and `$meta(field)`, as foobar2000 answers either spelling from the one tag. Dropping `%lastfm_play_count%` from a fixture is how a spec covers an install with no playback-statistics component.

**`DEFAULT_PLAYLISTS()` builds six**, and the shape is deliberate. `p1 p7 p2 p5` are ordinary playlists. Those are the fake's own keys, which specs and control routes name a playlist by, and they are neither contiguous nor in index order so nothing can read a position off one; every `foo_jean` route addresses a playlist by its `guid`. `p7` is current, and is where `openLibrary` goes. `p8` is `#Jean Library`, a playlist carrying Jean's own prefix, which nothing reads as the library and everything keeps out of the sidebar. `p9` is `Recently Added` with `isAuto` set: a visible autoplaylist with an ordinary name, so "the player fills this one itself" is covered. foobar2000 locks an autoplaylist against having rows added, so `p9` answers a copy or a fill `409`, carrying no positions, rather than the `200` an ordinary playlist answers.

**Every playlist the fake mints, here and in `addPlaylist`, seeds its structure generation and its content revision at `GENERATION_SEED`, `9204739866101318656n`, and steps them by one on every edit.** That is `plugins/fb2k/tests/playlist_route_test.cpp`'s own `kThroughADouble`, the double every value within five hundred of it rounds to. It sits in `[2^62, 2^63)`, where a double's ULP is 1024, so a thousand consecutive generations collapse to one and a client that parses either counter as a number fails on the first edit. A smaller seed would be easier to read and would also agree with that client by coincidence, since a double stays exact at that scale. Held as `bigint`, since a `number` this size cannot step by one without rounding four consecutive values onto the last.

The cover art is real and downscaled by `capture.ts`, which shells out to macOS `sips` and says so when it cannot. Nothing but the fake reads `artwork/`.

**The same tool captures the demo's library, and the two must not be confused.** `capture.ts --albums demo/albums.ts --out demo` writes into `demo/`. Nothing in `demo/` is read by a test and nothing here is read by the demo. A demo capture leaves `player.json` alone; a named album the tool cannot find is skipped and logged either way. `--url` falls back to `CAPTURE_URL` and then to `http://localhost:8881`.

### The media library

The library is **derived from the captured tracks rather than invented**: the capture's absolute `%path%` values give a deepest shared directory, which is treated as the media library folder, and what is left is the library-relative, forward-slashed path the component's own API returns.

**The captured tracks are all `subsong: 0`**, since every captured file is one track and a subsong needs a cue sheet or a disc image. `libraryOfShape({ subsongsPerFile })` synthesises them where a spec needs several tracks sharing one `%path%`, numbered from 1 the way foobar2000 numbers a cue sheet's, so a file it splits has no subsong 0 at all. Wherever a route takes a subsong it is matched by value rather than read as a position, as the component matches it, and an address that leaves `subsong` out asks for 0.

### Covers

`GET /api/artwork?track=` is the route every library cover comes through, and the fake answers it on the component's own terms: a present cover `Cache-Control: private, max-age=604800, stale-while-revalidate=15552000`, a `404` `private, max-age=600`, a strong quoted `ETag` under either, and a `304` for a conditional request that matches. `GET /api/artwork/playing` and the positional fallback answer `private, no-cache` instead, on every outcome, and the same file server answers all three.

### Ordering

**The fake's most load-bearing approximation.** foobar2000 orders paths with Windows' `StrCmpLogicalW`, so `compareText` in `fake-api/playerOrder.ts` reproduces its word sort, and every sort in the fake goes through it, on paths written with `\` as the player writes them (`pathKey`). `test/unit/playerOrder.test.ts` holds it to a table captured from a player. A spec asserting on order MUST use it too rather than writing a comparator of its own: a fake that is self-consistent and wrong in the same direction as its specs is a fake that ships an ordering bug.

### The library as `foo_jean` serves it

`fake-api/jlib.ts` encodes the binary snapshot and `../src/shared/api/jlib.ts` reads it back, so the two are pinned against each other by `unit/jlib.test.ts` and by the bytes in `unit/fixtures/library.jlib`. An encoder and a decoder written together agree with each other and can still disagree with the component, so `unit/fixtures/delta.jlib` is a delta a real player produced and the patch path is tested against it as well. Regenerate the snapshot fixture with the fake's own encoder when the format changes, and never by hand:

```sh
node --import ./test/alias.ts --input-type=module -e '
import { writeFileSync } from "node:fs";
import { createState } from "./test/fake-api/state.ts";
import { TRACK_EXPRESSIONS } from "./src/domain/track/fields.ts";
const state = createState();
state.libraryFeed.columns = [...TRACK_EXPRESSIONS];
writeFileSync("test/unit/fixtures/library.jlib", state.libraryExport());
'
```

An export taken off a real player is far too large to commit, so the test that reads one skips unless it is pointed at a file:

```sh
JEAN_LIBRARY_EXPORT=/path/to/export.jlib pnpm test:unit
```

The routes model the declaration the contract describes rather than answering from nothing. Nothing is built until an export names a column set, so a fresh fake reports `ready: false` and both generations at zero. Nine options drive the paths a client has to survive:

| | |
|---|---|
| `canReadLibrary: false` | the component loaded without the feature: the three `/api/library/*` routes are a `503`, and `GET /api/state` answers `200` regardless, with a zero `library` and a populated `player`, since a player with no library is still a player |
| `libraryReady: false` | no export ever finishes, so no snapshot is held for as long as the spec runs and a library address resolves against nothing. The window a freshly started player sits in until something has asked for an export |
| `libraryBuilds: n` | polls of `GET /api/state` answered before a declared set finishes building, so the export is a `202` first |
| `libraryBusy: n` | exports answered `429` before the rate limiter lets one through |
| `libraryRebuilds: n` | structure rebuilds, one performed at the next poll of `GET /api/state` each. This is the `409` and the re-export behind it |
| `librarySlice: n` | slices `formatting` into steps of `n` tracks: while `libraryBuilds` still counts a build down, each `GET /api/state` walks `build` one step further, `listing` then `ordering` then a `formatted` at every slice boundary but the last, which is the build finishing rather than a report of its own. Unset takes the whole library, so a build of one slice or fewer never reports a `formatted` above `0` |
| `libraryHalted: true` | `foo_jean`'s library worker has stopped for good: `GET /api/state` answers `library.halted`, `build` goes `null`, no build starts or finishes, and an export naming a set the snapshot does not hold answers `202` carrying the halt. Assignable mid-test, or through `POST /__control/libraryHalted { halted }` |
| `libraryCeiling: n \| null` | the largest export or delta in plain bytes the library routes send; one over it is a `413` in the component's words. Defaults to the component's `kMaxLibraryBytes`, and `null` lifts it |
| `failLibraryExport: { status, times }` | refuses that many `GET /api/library/export` requests with `status`, then answers normally |

**`GET /api/track/library` answers one track's declared columns**, addressed the way a cover is, by library-relative path and subsong, or by an `ordinal` and the `structure` it was read at, the pair `POST /api/tags` takes. Both forms at once, neither, or half the pair is a `400`, a `structure` the library has moved past a `409`, and an ordinal past the end a `404`. It is the read a client goes back with when a write's own answer never arrived, so two options reach it and no other traffic: `failLibraryTrack` refuses it with a status, and `hangLibraryTrack` holds it open and never answers, not even late. `twoRootsHold` names a library-relative path that two media library roots both hold, and this route and the tag write both answer `409` for it rather than choosing one of the two tracks.

**`GET /api/track/playing` answers the same way, addressed by nothing**: the declared columns evaluated against whatever is playing, beside its own `path` and `subsong`. It sits outside `handleLibrary`, so it answers whether or not the media library is available. `failPlayingTrack` and `hangPlayingTrack` shadow the library route's own two knobs, `playingTrackAnswersPath` swaps the `path` the route answers for another, leaving `subsong` and `columns` alone, for a spec proving a client catches an answer the next track has already overtaken, and `playingTrackAnswersSubsong` does the same for `subsong`, leaving `path` alone, for the next track in the same file. All four hold for every read unless `playingTrackKnobsFor` says how many: set to `n`, they apply to the first `n` reads and the route answers normally after, which is a first read failing and a second one landing.

`GET /api/state`'s `player` section reads off `state.player` and `state.positionMark`, the position and the wall-clock time it was last set: a track change, a pause, a resume, a stop or a seek re-takes the mark, and a volume-only write does not, so a client interpolating `seconds + ageSeconds` never loses time it already counted. Its `ETag` folds a player version and `configGeneration` on top of the two library generations, so driving the player, or flipping a switch a control route governs, still moves the validator. **`failState`, set through `fooJean` or through `POST /__control/state { failState: n }`, refuses the route with status `n`**, `429` and nothing else, since `foo_jean` answers this route from its own store, until cleared with `{ failState: null }`, shaped like `failWrites` but switchable mid-test, since the case it exists for is a poll cut off partway through a spec rather than one refused from the start.

`countsPlays` is the other half and sits beside the player's own options rather than the component's, because a play count is foobar2000's business: with it on, leaving a track advances that track's `%lastfm_play_count%` and moves the library's `revision` with it, which is what a delta is made of. It is off by default, so the captured counts every other spec asserts stay where they are.

**The fake keeps a bounded revision history, so `GET /library/changes` answers a real delta.** A `since` from before the last rebuild is a `409` and one that fell out of the window is a `410`, both as the contract describes. Dictionaries are held per column and per structure generation, so a delta carries `dict.base` and only the entries appended after it, exactly as the component does.

**gzip is real here.** The route compresses through `CompressionStream` when the request offers it, sets `Content-Encoding`, `Vary` and an `ETag` that names the coding. A browser decodes it before anything in the app sees it, so what this actually covers is the negotiation and the headers.

### What is playing, and what moves it

**The playing item is held by identity, not by row number**, so an edit to the playlist under it moves the row and the same track carries on. `removeItems`, `copyItems`, `sortItems` and a fill of the component's own scratch all go through that. An edit to a playlist that is not playing moves nothing at all, and one that leaves the playing row where it was moves no validator either, so the next poll is a `304`. Where the playing item is removed outright, `playingLocation` goes `null` and `GET /api/state` still names the track, which is what the component publishes once `get_playing_item_location` stops answering for it.

**`player.announceSong({ title, artist })` is a radio station announcing its current song.** The name moves and the path does not. Without that, a status bar names a stream once and then lies for the rest of the hour. A field left out still reads off the playlist entry, an empty one crosses the wire as `null`, and the next track clears the announcement. One announcement replaces the last outright rather than merging onto it: the component holds no memory of a previous field, so a second announcement that leaves the artist unset does not keep the one named before.

**There is one play queue**, since the player has only one. An entry is a track with the playlist row it was queued from, and a track queued by handle has no row at all: `player.queueInsert([{ playlistId: null, track }])` is the desktop queueing one, which the component's read can only report as `-1`. `player.queueRevision` moves when the contents, the order or a queued row's position moves, and never otherwise, and it carries the player's own version with it so `GET /api/state`'s validator moves too.

**Playback and volume are driven and read through the one host.** `fooJean.ts`'s `handleFooJean` answers `POST /api/playback/play-pause`, `/pause`, `/resume`, `/next`, `/previous`, `/stop`, `/seek` and `/mode`, plus `POST /api/volume`, by calling the same state methods a desktop press would: `playPause`, `pause`, `resume`, `next`, `previous`, `stop`, `patchPlayer` and `nudgeVolume`; `GET /api/state` reads `state.player` back.

### What the fake gets wrong on purpose

A fake kinder than the player it stands in for makes the suite agree with itself and disagree with reality.

- **`POST /api/library/refresh` has a route, and nothing in Jean calls it.** The fake answers it, rate limit included, so a caller added later meets a fake that already behaves.
- **A queue entry with no position is skipped rather than played.** A real player plays one. The fake's own playback is addressed by a playlist and a row and has nowhere to play a bare handle from, so nothing asserting what reaches the head may lean on it.
- **The unreachable state destroys the connection rather than answering 500.** A refused socket and an error response are different events in the browser.
- **A queue body carrying a field no schema declares is refused, as in the component.** `POST /queue` and `POST /queue/move` both answer `400` with an empty `detail`, matching `declaresOnly` in `core/json.h`; a fake that stayed permissive here would pass a request built from a stale type and fail against a real install.
- **The fake answers `415` to a body that is not `application/json`, as the component does**, since a client that stopped sending that header would pass every other assertion and fail against a real install. Tickets are **not** single-use, for the same reason the component's are not.
- **A stream fails every way a second listener can.** `streamBehaviour` is `short` (ends after what it has sent, for reconnect) and `quiet` (opens, sends the container header, then nothing: the case with **no error to catch**, which is what a stopped player looks like and what the stall watchdog is the only answer to). `playableFormats` names which of `streamFormats` get bytes of the declared type. `failTickets` with `ticketError` separates a 503 meaning "busy" from one meaning "not supported". `expireTickets` answers 401 at `GET /stream`.
- **The timeline carries a history and the clock starts before the fake does.** `state.streamMarks` records where recent tracks began, backdated by the position the player was at, since a listener is always *behind* the live edge. `startedAt` is a minute in the past, since the component starts with foobar2000 long before any client connects.
- **A detached session keeps no grace and no linger**, so a connection that closes without a leave leaves its device a member until a leave or `endSession`. The leave it models is the component's: one sent once the device holds no connection there ends the session at once if nobody else keeps it, and one sent while the device still holds a connection is held until that device's last connection closes, which then does the same, unless the device connected again in between. The fake ends a session left that way as the connection closes; the component ends it at its next sweep.
- **A session reports all five playback orders and plays one.** `next` and `previous` walk its rows in order and wrap, so a spec asserting a shuffle in a session sees row order. Its position does not advance by itself, as the player's does not, so a spec reads it back where a seek or a start left it.
- **`streamPrime` decides whether this fake has a lag at all**, and the default removes it. A spec about the lag asks for a smaller prime and waits while Chromium accumulates the rest at real time. **`12 - prime`** is the arithmetic; size a margin against a loaded machine, never against the nominal figure.

**One place the fake is deliberately kinder.** `opus` is served as WAV rather than Ogg Opus, since there is no Opus encoder in a Node fake, while `aac` is real ADTS, a short encoded tone in `fake-api/aacTone.ts` looped against the clock. WebKit refuses an endless WAV outright, so a spec that needs sound in the `iphone` project asks for `aac`. In Chromium, a non-seekable WAV does not fire `loadedmetadata` until a substantial amount of *content* has arrived. Not bytes: the same byte rate with a longer primed burst starts playing far sooner. That is a property of PCM in a container never meant to be streamed. So the healthy stream hands over a burst up front and then feeds at 1x, which starts sooner than a real one would; what that could hide, a long gap between asking and hearing, is covered by `quiet` instead.

**Two places it is poorer than the component, and both are about the playing cover.** The fake resolves a sleeve by matching the playing path against the captured albums, so a track it has never seen answers `404`; the component reads the file through foobar2000's own now-playing loader, and an off-library track with embedded art does get a cover. And the fake has no loader, so it resolves a new cover in the same tick: the component clears the held picture on a track change and answers `404` until the core pushes the next one, which is a gap no spec here can see. Modelling that second one would put a timing race into the assertion that a track change within an album costs no request at all, since every row of it addresses the same cover and the browser already holds it.

## Against a real player

`test/live/` is a second, much smaller suite that drives a player actually running foobar2000, and it replaces the fake suite rather than joining it: setting `LIVE` swaps the projects in `playwright.config.ts` for a single serial one, so `pnpm test` is untouched.

**Neither Node nor the Chromium Playwright drives can reach the LAN from a Mac.** macOS grants local network access per application, and grants it to `curl` and `ssh` but not to either of those, which fail a LAN address with `EHOSTUNREACH`. The route is an SSH forward from the Mac to the player's own loopback, never to the player's LAN address:

```sh
ssh -L <port>:127.0.0.1:<port> <player-host>
LIVE=http://localhost:<port>/ LIVE_LIBRARY_ROOT=<root> pnpm test:live
```

Forward to `127.0.0.1` rather than `localhost`: `foo_jean` listens on IPv4, and `localhost` on Windows resolves to `::1` first. What lands on the player is `localhost:<port>` arriving on its own loopback, which its source-address and `Host` rules admit.

`LIVE` is the origin `foo_jean` serves from. Jean loads from its root and calls the API on the same origin, so nothing else needs naming.

**Two invocations, not one.** The first runs every spec with the component's switches on. The second turns `writePlaylists` and `changeOutput` off in the component's own `config.json`, the player owner's file, which the suite never writes, and runs only the two specs each switch governs:

```sh
LIVE=http://localhost:<port>/ LIVE_LIBRARY_ROOT=<root> pnpm test:live c32.spec.ts outputs.spec.ts
```

Each spec's other half skips itself and says why: a spec asserting that a write is refused has nothing to assert while its switch is on, and one asserting that a write lands has nothing to assert while it is off.

A spec that plays anything refuses to start unless the player is already muted, and one that reads the level or the output as the owner left it refuses unless the player is stopped too.

**It exists for rule 11 below.** These are the comparisons where that matters: the join between the `%path%` the player reports playing and the row Jean drew, a cover that has to decode rather than merely have a `src`, `fold()` against tags read off real files, and `foo_jean` itself rather than the fake standing in for it.

**Nothing here may assume what is in the library.** Counts, titles, which row carries a rating and whether any artist is accented are all read off the player first and asserted against; a spec that cannot be satisfied skips itself and says why. That is why the suite is short: an assertion that survives an unknown library has to be about a relationship rather than a value.

**`LIVE_LIBRARY_ROOT` is required and has no default, and it names a folder on a throwaway install holding nothing but disposable copies.** These specs play tracks, write the play queue and can write rating tags, so the `install` fixture, which every spec gets, reads the whole library through `GET /api/library/export` first and refuses to start if one track sits outside the named folder. The check runs before any page is opened, so a wrong answer costs nothing. Every tag write the suite makes goes through the one helper that refuses a target outside the root before sending anything, which makes the root the only place a write can land. Whether that root is disposable is the runner's to know: the code has no way to tell a throwaway install from any other.

`details-read.spec.ts` also needs a playlist titled `#foo_jean test`, which `plugins/fb2k/scripts/test-fixtures.ps1` builds: library rows, a file the media library does not hold, and a stream URL. Its `-Dest` must sit under `LIVE_LIBRARY_ROOT`, with the `one` and `two` folders it writes added to the player's media library, since `c26.spec.ts` rates a row the library holds; the script's own default destination sits beside the player instead, outside anything the library watches. `c26.spec.ts` writes its rating to a row of the same playlist and puts back whatever rating that row held, whether the run passed or failed.

**A run that ends with a playlist added, removed or renamed, a playlist's rows changed, or any track's rating moved from where it started, fails.** `reset()` stops playback and puts back the play queue the run found, and refuses to start a run whose queue holds an entry it could not queue again; the output device stays each spec's own to put back.

## Writing a spec

Two rules outrank the rest.

> **A test asserts what a *user* can see.** Not internal state, not a class name used as logic, not a call count standing in for a visible fact. Where the assertion has to be about traffic, it is about traffic the user's action caused and the property that traffic must have, never the exact sequence a particular implementation happened to send.

> **An assertion about a request happening, or not happening, must prove the request log came to *rest*.** `expect.poll(...).toBe(n)` on a growing counter returns on the first sample that matches and proves only that the number was passed through. A "nothing was sent" read written straight is unfalsifiable in the other direction: it passes before the request is made. **`expectSettlesAt` in `fixtures.ts` is the helper for both.** It polls the value to the expected one, then waits for the whole request log to stop moving, then re-reads and asserts once more without retrying.

`test/e2e/fixtures.ts` gives every test its own player, on its own port, and carries the helpers every spec would otherwise write for itself. Anything more than one spec needs belongs there.

| | |
|---|---|
| Finding things | `trackRow`, `rowByTitle`, `statusBar`, `withNoListOnScreen`, `viewHeader`, `globalControls`, `sidebar`, `openSidebar`, `closeSidebar`, `openLibrary`, `openNowPlaying`, `nowPlayingScreen`, `listenHere`, `settingsDialog`, `openSettings`, `expectPlayingFrom`, `toastRegion`, `playFirstRow`, `playingAtThePlayer` |
| Reading the player | `requestsTo`, `routeOf`, `askOf`, `ticksTaken`, `tagWrites`, `volumesSent`, `expectSettlesAt`, `scratchOf`, `playedFrom`, `trackPlayed`, `fieldOf`, `titleOf`, `titleOfPlaylist`, `watchWhatIsSaid` |
| Playback control off | `REASON`, `REFUSED_ROUTES`, `refusedAsks`, `expectNothingRefusedSent`, `expectDisabledWithReason` |
| Gestures, in `gestures.ts` | `touchDrag`, `dragTo`, `dragFrom`, `pressAndHold`, `restingBox` |
| Scrolling, in `scrolling.ts` | `isRowOnScreen`, `scrollUntilMounted`, `scrollTop`, `scrollTo` |
| Steps | `inSequence`, `times`, `runClockFor` |

A file that is not `*.spec.ts` is not collected, which is how `fixtures.ts` and `build.ts` sit in the same folder. `nowPlaying.ts` is the same thing one level down: the lyric fixtures, the panel helpers and the discard-prompt helpers the now-playing and lyric specs share, which are too specific to be everybody's. `queue.ts` is the queue panel, its button and its rows, `menus.ts` is a row's menu, `sessions.ts` is the install that offers sessions, the picker's rows and buttons, the scene a session spec sets and the strict-mode watch that `sessions.spec.ts`, `session-picker.spec.ts`, `session-reports.spec.ts`, `sharing.spec.ts` and `media-session.spec.ts` share, and `listening.ts` is listening on this device, a stream and its ticket and the player's row, that `listen.spec.ts`, `listen-picker.spec.ts` and `unheard-player.spec.ts` share. The two pickers differ by what they put in the "Playing on" panel: `listen-picker.spec.ts` is the panel as a way to hear the player here, and `session-picker.spec.ts` is the panel as a way to start and leave a session of one's own. `pickerOpener` in `fixtures.ts` is the status bar's button that opens either.

```js
import { expect, requestsTo, test, trackRow } from './fixtures.ts'

test('does the thing', async ({ page, player }) => {
  await page.goto('/')
  await trackRow(page, 2).dblclick()

  // what went over the wire, read off the fake rather than the browser
  await expect.poll(() => requestsTo(player, '/items/2/play').map((r) => r.path))
    .toHaveLength(1)

  // and what the next poll drew
  await expect(page.locator('footer')).toContainText('Deléctrico')
})
```

`player` is the fake's state, live; `player.requests` is every request the app made. **One player per worker, reset per test**, so the suite stays parallel.

A comment in a spec is allowed more room than one in `src/`. A test is documentation, and a sentence saying *why* this case matters, what broke and what a reader would otherwise assume, earns its place. Narrating what the next line does still does not.

### Fixture options

| | |
|---|---|
| `librarySize` | swaps the 54 captured tracks for that many generated ones, for scroll arithmetic that only breaks past a few thousand rows |
| `mediaLibrarySize` | swaps the media library, which is what the component publishes, for that many generated tracks |
| `libraryShape` | states a library outright: counts, durations, years, tags to omit, whether an artist is spelled two ways, how many subsongs share a file. A description rather than built tracks, since an option's top level does not survive the trip to the worker as an array (nested arrays are fine) |
| `withoutFields` | removes title-formatting expressions, so the player answers `?` as a real one does. `['%lastfm_play_count%']` is an install with no playback-statistics component, and everything built on play counts must disappear rather than break |
| `withoutPlaylists` | empties the playlist list entirely: the player a fresh install would find |
| `retagged` | patches tag values onto captured tracks, keyed by title: `{ Nutshell: { '%artist%': 'Alice in Chains feat. X' } }`. Everything else about the track stays captured, and the patch reaches the media library as well as the playlists |
| `embeddedArt` | gives a track a cover of its own, keyed by title: `{ 'No Excuses': 'deja-entendu.jpg' }` names a file in `fake-api/artwork/`. That track's own address answers it and the rest of the album answers the album's, which is what a file carrying the wrong sleeve looks like to `GET /api/artwork` |
| `playlistsFromRow` | seeds a playlist from that row on and drops the ones before it, keyed by the fake's own playlist key: `{ p1: 1 }` is a view that begins partway into an album |
| `playerState` | seeds the player: what is playing, the volume, the playback mode |
| `settings` | merged over a default seed, so a spec names only what it cares about |
| `firstRun` | drops the settings seed entirely, which is what makes the first-run affordances appear |
| `fooJean` | puts the component in whichever state is needed. `{}` is installed and serving, which is the default. Then `{ reachable: false }` for no component, `{ allowedFields: [] }`, `{ failWrites: 403 }`, `{ failWrites: 504, writesLandAnyway: true }` for a write the player took and could not answer for, `{ storesRatingAs: '2' }` for a player that keeps ratings on a scale of its own, `{ twoRootsHold: path }` for an address two media library roots both hold, `{ failLibraryTrack: 404 }` and `{ hangLibraryTrack: true }` for the read a timed-out write goes back with, `{ failPlayingTrack: 500 }` and `{ hangPlayingTrack: true }` shaped the same way for the playing-track read, `{ failLibraryTrack: 429 }` and `{ failPlayingTrack: 429 }` send a `Retry-After` the way every other `429` in the fake does, `{ playingTrackAnswersPath: path }` for an answer the next track has already overtaken, `{ playingTrackAnswersSubsong: n }` for one overtaken by the next track in the same file, `{ failPlayingTrack: 500, playingTrackKnobsFor: 1 }` for any of those four on the first read only, `{ failState: 429 }`, `{ failQueue: 500 }`, `{ knowsPlayingLocation: false }`, `{ annotatesEveryPlaylist: false }`, `canStream`, `streamFormats`, `playableFormats`, `streamBehaviour`, `streamPrime`, `{ markDelayMs: n }` for a mark landing n ms after the change or seek that laid it, so `timelineRevision` and `/api/state`'s own `ETag` move only once it lands, `failTickets` with `ticketError`, `expireTickets`, `otherListeners`, `canMuteWhileStreaming`, `{ maxSessions: n, canCreateSessions: true }` for an install that offers detached sessions, where the defaults are `0` and `false`, and `canCreateSessions` reads false while `canStream` does, `{ strictSessions: true }`, off by default, for a session-scoped route naming no session answering `500` with its path in the body, which a spec switches on once its page is in a detached session, `canControlPlayback`, `canChangeOutput`, `outputDevices` and `activeOutput` for the device list and which one the player is set to, `{ activeOutput: NULL_OUTPUT_DEVICE.id }` for a player on foobar2000's Null Output, which `GET /api/state` answers `outputSilent: true` for, where any other device answers `false` and `{ activeOutput: null }` answers `null`, one entry in `outputDevices` for a machine with only one output where the picker must not be drawn at all, `{ outputSwitchRefusal: 409 }` for a device unplugged between the list landing and the switch arriving and `{ outputSwitchRefusal: 500 }` for the player refusing the write outright, `maxAutoPlaylists`, `autoPlaylists`, `libraryEnabled`, `failCreate`, `{ failRowEdit: 500 }` for a move or a sort the player refuses after every check has passed, leaving the rows where they were, and `{ failRowEdit: 429 }` sending a `Retry-After`, `autoPlaylistSpecs` for the specification of autoplaylists Jean made, keyed by the fake's own playlist key, so one named only in `autoPlaylists` is one made elsewhere and carries `managed: null`, and one with `forceSort` refuses a move and a sort on its own, `{ dropState: true }` for a poll the network drops, the way a phone leaving the wifi's reach loses one, `{ hangState: true }` for a poll the network never answers, since the component answers it from its own store and never holds it, `{ hangCapabilities: true }` for a discovery the network has not answered yet, which stays *checking* until the spec assigns `player.fooJean.hangCapabilities = false` and every request held is answered with what the install offers by then, `{ mainThreadStalled: true }` for foobar2000's main thread no longer running what the component posts to it, which `GET /api/state` goes on answering and reports under `mainThread`, moving its `ETag` as the stall starts and again as it ends, and which leaves every other route answering as usual, `{ failArtwork: 503 }`, `{ failPlayingArtwork: 429 }` and `{ failRowArtwork: 504 }` for one artwork route each, each accepting only the refusals its own route can answer and throwing on any other, even when assigned mid-test, and `{ hangArtwork: true }` for `GET /api/artwork` alone, the one of the three read from disk with no timeout, `{ routeLatency: { 'GET /api/state': { ms, jitterMs } } }` for answers built when a request arrives and delivered late, keyed by method and path prefix, `rateLimits` to resize `foo_jean`'s token buckets, which the fixture turns on at `COMPONENT_RATE_LIMITS` and fails any test answered an unasked `429` by, and `{ expectRateLimited: ['statePolls'] }` for the buckets a test means to be refused by |
| `motion` | reduced by default, since Playwright will not click a target whose bounding box never holds still. `'allow'` opts out. `reducedMotion` in `use` does **not** work. It is accepted and silently ignored, so the fixture calls `page.emulateMedia()` |

### Control routes

- **`POST /__control/play`** drives the player the way the desktop would (with `{ ordinal }` and no `playlistId` it counts one play of the library track at that ordinal, whether or not `countsPlays` is on, and answers `404` when the library does not declare a play count or holds no such ordinal): the case Jean has to survive and cannot provoke reliably against a real one. **`/__control/append`** is the same for playlists: the desktop adding tracks while Jean holds a range of indices. **`/__control/removeItems`**, `{ playlistId, items }`, is the same for removing them.
- **`POST /__control/latency`** holds writes for N milliseconds, and `GET /api/playlists` and the eight playlist writes on `foo_jean`'s side besides, since a slow join is what `useAutoPlaylists.ts` has to be caught catching up with and an optimistic playlist edit is indistinguishable from a fast one without it. On localhost every request settles before the next pointer event, so a control coalescing forty moves into three looks identical to one sending forty. `useCoalescedWrite` is untestable without it.
- **`POST /__control/latency { route, ms, jitterMs }`** holds back one route's answers rather than every write, the way `routeLatency` does, and `ms: 0` takes it off again.
- **`POST /__control/writePlaylists { canWrite }`** flips `foo_jean`'s `canWritePlaylists` mid-test, the one way a spec can put a refusal in front of a control still drawn: the component answers its capabilities once, at discovery, so an install with the setting off from the start draws no playlist-editing control at all.
- **`POST /__control/controlPlayback { canControl }`** flips `canControlPlayback` mid-test the same way: while it is off, every playback command, seek, playback mode, volume, playing a row, every queue write and both scratch routes answer the component's own `403` unless the request names a detached session, which the switch does not govern, and reading the queue and the state still answers. Either flip moves `GET /api/state`'s `configGeneration`, but only when the value actually changes.
- **`POST /__control/changeOutput { canChange }`** flips `canChangeOutput` mid-test the same way: while it is off, `POST /api/outputs/active` answers `403` and `GET /api/outputs` is unaffected. Moves `configGeneration` the same way the two above do.
- **`POST /__control/activeOutput { deviceId }`** moves the active output device the way a switch made at the player would, with no other side effect: `configGeneration` does not move, since nothing in `config.json` changed. `deviceId` may name a device `GET /api/outputs` no longer lists, which is what an unplugged one looks like.
- **`POST /__control/library { add, remove }`** adds new files beside the first track and removes tracks from the end of the library's order, as a change at the player would. Both in one call are one rebuild: `structure` moves on the poll of `GET /api/state` that finishes it, which a halted worker never does, and the track count moves with it.
- **`POST /__control/libraryHalted { halted }`** halts the library worker mid-test, the way `foo_jean` does after its worker keeps failing, and `{ halted: false }` takes it back, which the component never does.
- **`POST /__control/skipDelay`** holds a skip for N milliseconds before the next track starts, the time foobar2000 takes to open the next file, while `GET /api/state` goes on naming the outgoing track. Off by default, since the delay makes `next` asynchronous and no other spec should have to wait one out.
- **`GET /__control/state`** returns the player, the playlists, the queue and the request log in one read, for a spec driving the fake from outside the fixture. **`POST /__control/state { failState: n }`** switches `GET /api/state`'s refusal on mid-test and `{ failState: null }` turns it back off, the one thing `failWrites` cannot do: a spec cuts the poll off, drives the player through the routes above while it is blind, then lets it back and reads the next tick.
- **`POST /__control/state { dropState: true }`** drops the poll's connection unanswered, and **`{ hangState: true }`** holds the poll open and never answers it, each the network losing an answer rather than the component withholding one. A post without a field lets the poll back from that failure.
- **`POST /__control/lockPlaylist { id, locked }`** locks a playlist, by the fake's own key, against having rows added, removed, moved or sorted, or releases it, the way some other component locking a playlist would: the copy, fill, remove, move and sort routes all consult it, and answer `409` for as long as it holds. The copy, the fill and the remove also consult `isAuto`.
- **`POST /__control/failPlaylistWrites { status }`** refuses every playlist mutation with that status, the same pattern `failState` uses for `GET /api/state`: a write that failed at the player rather than one it refused. Leaving `status` out turns the refusal back off.
- **`POST /__control/reachable { reachable }`** destroys every `/api/` connection rather than answering one, the way a closed foobar2000 or a player off the network looks to a browser, and admits them again once set back to `true`.

### Rules

1. **Parameterise over the layouts, not just the viewports.** List and album are not one code path with a different stylesheet: album virtualises groups rather than rows, and on a phone the cover stacks above its tracks. Loop a describe over both and seed `jean.layout`.
2. **`test.use` goes *inside* a describe, never beside one.** At file scope it applies to the whole file however many times it is called, so a loop writing it once per layout runs every case under whichever it wrote last: green, correctly named, and covering the same thing twice.
3. **`inSequence` and `times` rather than a loop.** Playwright assertions share one page, so steps must be awaited in order. Both live in `fixtures.ts`; `inSequence` is the `reduce`, and `times` is built on it.
4. **Drive timing-sensitive input from inside the page.** Anything racing an animation cannot be driven over the wire, because three round trips land after the animation has finished, so the test passes whether the behaviour works or not. Dispatch from `page.evaluate`, one frame apart. A synthetic wheel event scrolls nothing, which is usually the point: what is under test is the listener.
5. **Wait on the player, not on the render that looks right.** `isRowOnScreen` is true as soon as an animated scroll brings a row into view, long before it stops moving. And mutations write to the query cache before the request goes out, so the UI flips before the stream agrees. Prefer the fake's own state, where `player.player.playbackMode` has no optimism in it, and **assert the property rather than the exact traffic**: "nothing it sends ever asks for a different order" survives a duplicated idempotent request where `toEqual([4])` does not.

   **Settle by watching, never by sleeping.** Where the thing to wait on is a scroll offset rather than a request, the local `settle()` helpers walk it frame by frame from inside the page and return once it has held still; `artwork.spec.ts` waits for the offset *and* the request log to stop moving together. A fixed `waitForTimeout` followed by a hard assertion fails a slow machine instead of waiting for it, and is the slowest thing in whatever file it is in. Use `waitForTimeout` only to cross a threshold on purpose: past a hold, past a debounce, or to let a window elapse and prove nothing happened.

   Where the end state is what matters, prefer a retrying assertion over settle-then-assert. `expectCentredOrClamped` polls a sentence describing what it saw, so a failure reports the offset rather than a boolean.
6. **A case that means to watch which address a cover is asked for has to own the page.** A cover is fresh for a week, and `artworkHandles` holds a blob per identity for the tab's life, so any view that draws tracks pre-warms both, and a later ask at the same identity is answered inside the browser rather than reaching the player. `withNoListOnScreen` in `fixtures.ts` is the page that draws none: the search route before anything has been searched for. It waits on the status bar rather than on the empty list, since no rows is true of a page that has not rendered yet.
7. **Touch is a gesture, not a narrow mouse.** Drive it through `touchDrag`, for the reason *Touch gestures* gives. A dispatched `pointermove` passes whether the gesture works or not.
8. **Check an injection more than once.** A guard that fails on one run and passes on the next is flaky, not covered.
9. **A test that cannot fail is worse than no test.** When one covers a guard rather than a feature, such as "a long press plays nothing" or "a desktop click does not play", delete the guard, watch it go red, and put the guard back.
10. **A source file with a NUL byte in it is binary to `grep`, which matches nothing in it and exits non-zero.** A check built on `grep` reports success on a file it never read, so `.claude/hooks/check-style.sh` passes every line of one. `file` naming a `.ts` as `data` is the tell, and a separator written as the byte rather than as `\u0000` is how it gets in.
11. **Anywhere the fake supplies both sides of a comparison, it is only testing that a string equals itself.** Path joins between the stream timeline and the poll's own `player.path` are the case in point, and have to be verified against a real player.
12. **Assert what a value settles at, never what it passed through.** `expectSettlesAt` is that, and the top of this section is why.
13. **A keyboard shortcut gated by `useKeymap`'s `enabled` waits for nothing on its own.** `locator.click()` waits for the button sharing that condition to become actionable; `page.keyboard.press()` fires immediately, and a keystroke sent before the gate opens is not queued for when it does. Wait on whatever draws the gate visibly, usually the same button, before pressing the key.
14. **A fake clock advances honestly only in small steps.** `page.clock.runFor` fires every timer due in one sweep, so a real response the fake player answers between two of them lands out of order against a jump; step forward a few hundred milliseconds at a time, which is `runClockFor`, so each timer fires at the moment it was set for and a response arriving mid-window is handled before the next one comes due. Pause it rather than leaving it running while a retrying assertion polls, or every poll nudges the very budget under test. And a response the fake answers after the last step is not drawn until the clock steps again, so after an advance that is meant to produce a read, wait for the read and step once more before asserting on what it draws.
15. **Playwright cannot say whether a stream closed before the leave that followed it.** It reports an aborted fetch's `requestfailed` after the request events that come next, so a list built from both events reads the leave first whatever the page did. That order is held by the unit tests of `sessionOperations`.
