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

`pnpm test:e2e` builds first. `globalSetup` in `playwright.config.ts` runs `test/e2e/build.ts`, which is `vite build` alone, and serves that build from the fake, since that is beefweb's arrangement: one origin answering both the app and `/api`. There is no `webServer` block; the fake is a worker fixture and `baseURL` is set per worker to the port it landed on.

Both projects, `desktop` and `mobile` (Pixel 7, touch on), run every spec. Skip explicitly when a gesture has no equivalent on the other surface, and say why.

**The component is installed, listening and paired by default**, because it is what answers the library and a run without it has no music at all. A spec that wants a device that has never paired sets `fooJeanToken: null`; one that wants no component sets `fooJean: null`. Both are states the app has to draw, and neither is the state most of the suite is about.

## Touch gestures

`touchDrag` in `fixtures.ts` drives a finger through CDP rather than dispatching DOM events, since most of these tests are about *the browser's* decision on who a gesture belongs to and a dispatched `touchmove` sails past that.

Two things it does that are not optional. **Every point carries a timestamp**: `useSwipe` reads a slow enough gesture as a scroll rather than a flick, and a gesture is one round trip per point, so on a loaded machine an unstamped drag silently stops being a flick. And **one CDP session per page, never one per drag**: detaching a session while the next is dispatching drops the moves in between, and the gesture arrives as a tap where it started.

## The fake player

`test/fake-api/` is a small in-memory foobar2000. It implements the routes the app uses, holds real playlists, and pushes SSE the way beefweb does: a full snapshot of whatever was subscribed to on connect, then only the keys that changed, and **never on a timer**. Position advances in the app's own interpolation, so a test depending on the fake ticking would be testing behaviour the real player does not have.

Run it alone to develop with no player in reach:

```sh
pnpm fake                                   # API only, on :8880
BEEFWEB_URL=http://localhost:8880 pnpm dev  # in another shell

pnpm build && node test/fake-api/main.ts --serve dist   # as beefweb serves it
```

### The routes run in two places

`routes.ts` and `fooJean.ts`'s `handleAgent` have no host in them, and neither does `state.ts`, and there is no `node:` import in any of the three. `server.ts` and `agentServer.ts` give them a node socket for the suite; `demo/sw.ts` gives the same tables a `fetch` event. The seam is `Responder` in `http.ts`: `writeHead`, `setHeader`, `write`, `end` and `on("close")`, plus an optional readonly `writableEnded`. `ServerResponse` satisfies all of it as it stands, and the last two are what SSE and the audio pump stop on when a client leaves.

Two consequences before adding a route. **Anything reaching for a socket, a file or a `Buffer` belongs in the host files**, not the route tables; the artwork routes are the worked example and take a function instead of a path. And **fixtures are imported rather than read off disk**, since one of the two hosts has no filesystem.

### The fixture is captured, not invented

`library.json` and `player.json` came off a real player via `node test/fake-api/capture.ts --url http://<player-host>:8880`, so the fake replays bytes foobar2000 actually produced. Five albums, 54 tracks, chosen for the branches the UI has:

| | why it is in there |
|---|---|
| Babasónicos, *Jessico* | accented artist, for `fold()`; played throughout |
| Brand New, *Deja Entendu* | the heat range: one never-played track among heavily played ones |
| Alice in Chains, *Jar Of Flies* | FLAC rather than MP3, short, and a non-square cover |
| As Tall as Lions, *Lafcadio* | never played at all: no heat, no patina, no last-played |
| Have a Nice Life, *Deathconsciousness* | two discs, so `%tracknumber%` restarts mid-album |

Tracks are stored as objects keyed by title-formatting expression, not as the positional arrays the API returns: the fake has to answer whatever column set is asked of it, and **an expression the fixture does not carry resolves to `?`**, exactly as an unsupported field does on a real player. Dropping `%lastfm_play_count%` from a fixture is how you test an install with no playback-statistics component.

**`DEFAULT_PLAYLISTS()` builds six**, and the shape is deliberate. `p1 p7 p2 p5` are ordinary playlists whose ids are neither contiguous nor in index order, which is what a real install looks like; `p7` is current, and is where `openLibrary` goes. `p8` is `#Jean Library`, a playlist carrying Jean's own prefix, which nothing reads as the library and everything keeps out of the sidebar. `p9` is `Recently Added` with `isAuto` set: a visible autoplaylist with an ordinary name, so "the player fills this one itself" is covered. foobar2000 locks an autoplaylist against having rows added, so `p9` answers a copy or a fill `409`, carrying no positions, rather than the `200` an ordinary playlist answers.

**Every playlist the fake mints, here and in `addPlaylist`, seeds its structure generation and its content revision at `GENERATION_SEED`, `9204739866101318656n`, and steps them by one on every edit.** That is `plugins/fb2k/tests/playlist_route_test.cpp`'s own `kThroughADouble`, the double every value within five hundred of it rounds to. It sits in `[2^62, 2^63)`, where a double's ULP is 1024, so a thousand consecutive generations collapse to one and a client that parses either counter as a number fails on the first edit. A smaller seed would be easier to read and would also agree with that client by coincidence, since a double stays exact at that scale. Held as `bigint`, since a `number` this size cannot step by one without rounding four consecutive values onto the last.

The cover art is real and downscaled by `capture.ts`, which shells out to macOS `sips` and says so when it cannot. Nothing but the fake reads `artwork/`.

**The same tool captures the demo's library, and the two must not be confused.** `capture.ts --albums demo/albums.ts --out demo` writes into `demo/`; see `demo/CLAUDE.md`. Nothing in `demo/` is read by a test and nothing here is read by the demo. A demo capture leaves `player.json` alone; a named album the tool cannot find is skipped and logged either way. `--url` falls back to `BEEFWEB_URL` and then to localhost.

### The media library

The fake serves the beefweb 0.11+ library API: `/library/info`, `/library/items`, `/library/items/by-path`, `/artwork/library` and `/playlists/{id}/items/add-from-library`, against shapes measured on a live player. `fake-library.spec.ts` is that check; `../src/shared/api/README.md` records the shapes. **Jean reads none of it**: the library and its covers come from the component, and beefweb's own library routes are only what a fill or a queue acts through.

The library is **derived from the captured tracks rather than invented**: the capture's absolute `%path%` values give a deepest shared directory, which is treated as the media library folder, and what is left is the library-relative, forward-slashed path the real API returns.

- `test.use({ library: { supported: false } })` models an install with no library API at all: `/library/info` still answers, since that is how a client discovers it has none, and everything else is **501**.
- `{ enabled: false }` is foobar2000 with no media library configured: supported, empty, a different problem with a different fix.
- The two **must not collapse into one state**.

Two things the fake **refuses** rather than approximating, since a filter that silently disagreed with the real one is worse than no filter: the player's `query` syntax, and `sort` by anything but a bare `%field%`. Both answer **400**.

**The captured tracks are all `subsong: 0`**, since every captured file is one track and a subsong needs a cue sheet or a disc image. `libraryOfShape({ subsongsPerFile })` synthesises them where a spec needs several tracks sharing one `%path%`.

### Covers

`GET /api/artwork?track=` is the route every library cover comes through, and the fake answers it on the component's own terms: a present cover `Cache-Control: private, max-age=15552000`, a `404` `private, max-age=600`, a strong quoted `ETag` under either, and a `304` for a conditional request that matches. `GET /api/artwork/playing` and the positional fallback answer `private, no-cache` instead, on every outcome. beefweb's two artwork routes keep foobar2000's own terms, and the same file server answers all five.

### Ordering

**The fake's most load-bearing approximation.** foobar2000 orders paths with Windows' `StrCmpLogicalW`, so `compareText` in `state.ts` is an `Intl.Collator` with `numeric` on and `sensitivity: "base"`, and every sort in the fake goes through it. A spec asserting on order MUST use it too rather than writing a comparator of its own: a fake that is self-consistent and wrong in the same direction as its specs is a fake that ships an ordering bug.

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

The routes model the declaration the contract describes rather than answering from nothing. Nothing is built until an export names a column set, so a fresh fake reports `ready: false` and both generations at zero. Three options drive the paths a client has to survive:

| | |
|---|---|
| `canReadLibrary: false` | the component loaded without the feature: the three `/api/library/*` routes are a `503`, and `GET /api/state` answers `200` regardless, with a zero `library` and a populated `player`, since a player with no library is still a player |
| `libraryBuilds: n` | polls of `GET /api/state` answered before a declared set finishes building, so the export is a `202` first |
| `libraryBusy: n` | exports answered `429` before the rate limiter lets one through |
| `libraryRebuilds: n` | structure rebuilds, one performed at the next poll of `GET /api/state` each. This is the `409` and the re-export behind it |

`GET /api/state`'s `player` section reads off `state.player` and `state.positionMark`, the position and the wall-clock time it was last set: a track change, a pause, a resume, a stop or a seek re-takes the mark, and a volume-only write does not, so a client interpolating `seconds + ageSeconds` never loses time it already counted. Its `ETag` folds a player version on top of the two library generations, so driving the player alone still moves the validator. **`failState`, set through `fooJean` or through `POST /__control/state { failState: n }`, refuses the route with status `n`** until cleared with `{ failState: null }`, shaped like `failWrites` but switchable mid-test, since the case it exists for is a poll cut off partway through a spec rather than one refused from the start.

`countsPlays` is the other half and sits beside the player's own options rather than the component's, because a play count is foobar2000's business: with it on, leaving a track advances that track's `%lastfm_play_count%` and moves the library's `revision` with it, which is what a delta is made of. It is off by default, so the captured counts every other spec asserts stay where they are.

**The fake keeps a bounded revision history, so `GET /library/changes` answers a real delta.** A `since` from before the last rebuild is a `409` and one that fell out of the window is a `410`, both as the contract describes. Dictionaries are held per column and per structure generation, so a delta carries `dict.base` and only the entries appended after it, exactly as the component does.

**Ordinals in the snapshot and pages of `/library/items` come from one comparator**, since Jean resolves a library row's absolute path through beefweb while reading its rows from the component. Two orders that disagreed would make every such lookup refuse.

**gzip is real here.** The route compresses through `CompressionStream` when the request offers it, sets `Content-Encoding`, `Vary` and an `ETag` that names the coding. A browser decodes it before anything in the app sees it, so what this actually covers is the negotiation and the headers.

**`Access-Control-Expose-Headers` names `ETag` and `Retry-After` on every answer**, as the contract says the component does. Without it a browser hands script neither, and the conditional poll behind `GET /api/state` and the documented `429` backoff both fail silently against a cross-origin reader.

### What is playing, and what moves it

**The playing item is held by identity, not by row number**, so an edit to the playlist under it moves the row and the same track carries on. `removeItems`, `copyItems`, `sortItems` and a fill of the component's own scratch all go through that. An edit to a playlist that is not playing moves nothing at all, and one that leaves the playing row where it was moves no validator either, so the next poll is a `304`. Where the playing item is removed outright, `playingLocation` goes `null` and `GET /api/state` still names the track, which is what the component publishes once `get_playing_item_location` stops answering for it.

**`player.announceSong({ title, artist })` is a radio station announcing its current song.** The name moves and the path does not. Without that, a status bar names a stream once and then lies for the rest of the hour. A field left out still reads off the playlist entry, an empty one crosses the wire as `null`, and the next track clears the announcement. One announcement replaces the last outright rather than merging onto it: the component holds no memory of a previous field, so a second announcement that leaves the artist unset does not keep the one named before.

**`player.answersTrackColumns = false` takes the name away from beefweb** with the rest of the subscription live. `activeItem.columns` is the only place beefweb can name a track from, so a spec that empties it leaves the poll as the sole source.

**There is one play queue and both servers act on it**, since the player has only one. An entry is a track with the playlist row it was queued from, and a track queued by handle has no row at all: `player.queueInsert([{ playlistId: null, track }])` is the desktop queueing one, which beefweb's read and its subscription can only report as `-1`. `player.queueRevision` moves when the contents, the order or a queued row's position moves, and never otherwise, and it carries the player's own version with it so `GET /api/state`'s validator moves too.

### What the fake gets wrong on purpose

A fake kinder than the player it stands in for makes the suite agree with itself and disagree with reality.

- **A request body over 1 MiB is refused by hanging up**, not answered with a status. The fake destroys the socket at the same threshold, in both hosts. That cap is beefweb's alone; `agentServer.ts` has none.
- **A set added from the library comes back in the media library's browse order**, meaning album artist, album and track, not the order it was given, nor the file-path order `/library/items` pages in. The captured fixture cannot show this on its own, since its folders match its tags; `mediaLibrarySize` synthesises a library where they disagree.
- **`POST /api/library/refresh` has no route.** A rate limiter is one of the things a kinder fake would get wrong, and nothing in Jean asks for a refresh yet.
- **A queue entry with no position is skipped rather than played.** A real player plays one. The fake's own playback is addressed by a playlist and a row and has nowhere to play a bare handle from, so nothing asserting what reaches the head may lean on it.
- **`foo_jean` is a second listener on its own port, not another route.** Every call to it is cross-origin, is preceded by a CORS preflight for the `Authorization` header, and can fail by not answering at all. So `fake-api/fooJean.ts` gets its own `http.Server`, started and stopped by the worker fixture that owns the beefweb one. **The unreachable state destroys the connection rather than answering 500.** A refused socket and an error response are different events in the browser, and "installed, advertised, healthy, unreachable" must never render as "not installed". **Preflights land in `player.requests`**, so counting writes means filtering to `POST`. **`Access-Control-Allow-Origin` reflects the request's `Origin`, checked against its own `Host`, rather than a wildcard.** That is the component's own choice, reproduced here rather than approximated with `*`.
- **A queue body carrying a field no schema declares is refused, as in the component.** `POST /queue` and `POST /queue/move` all answer `400` with an empty `detail`, matching `declaresOnly` in `core/api.cpp`; a fake that stayed permissive here would pass a request built from a stale type and fail against a real install.
- **Pairing is single-grant, as in the component**: the first success closes the window. The fake also answers **415** to a body that is not `application/json`, since a client that stopped sending that header would pass every other assertion and fail against a real install. Tickets are **not** single-use, for the same reason the component's are not.
- **A stream fails every way a second listener can.** `streamBehaviour` is `short` (ends after what it has sent, for reconnect) and `quiet` (opens, sends the container header, then nothing: the case with **no error to catch**, which is what a stopped player looks like and what the stall watchdog is the only answer to). `playableFormats` names which of `streamFormats` get bytes of the declared type. `failTickets` with `ticketError` separates a 503 meaning "busy" from one meaning "not supported". `expireTickets` answers 401 at `GET /stream`.
- **The timeline carries a history and the clock starts before the fake does.** `state.streamMarks` records where recent tracks began, backdated by the position the player was at, since a listener is always *behind* the live edge. `startedAt` is a minute in the past, since the component starts with foobar2000 long before any client connects.
- **`streamPrime` decides whether this fake has a lag at all**, and the default removes it. A spec about the lag asks for a smaller prime and waits while Chromium accumulates the rest at real time. **`12 - prime`** is the arithmetic; size a margin against a loaded machine, never against the nominal figure.

**One place the fake is deliberately kinder.** The stream serves WAV rather than Ogg Opus, since there is no encoder in a Node fake, and in Chromium a non-seekable WAV does not fire `loadedmetadata` until a substantial amount of *content* has arrived. Not bytes: the same byte rate with a longer primed burst starts playing far sooner. That is a property of PCM in a container never meant to be streamed. So the healthy stream hands over a burst up front and then feeds at 1x, which starts sooner than a real one would; what that could hide, a long gap between asking and hearing, is covered by `quiet` instead.

**Two places it is poorer than the component, and both are about the playing cover.** The fake resolves a sleeve by matching the playing path against the captured albums, so a track it has never seen answers `404`; the component reads the file through foobar2000's own now-playing loader, and an off-library track with embedded art does get a cover. And the fake has no loader, so it resolves a new cover in the same tick: the component clears the held picture on a track change and answers `404` until the core pushes the next one, which is a gap no spec here can see. Modelling that second one would put a timing race into the assertion that a track change within an album costs no request at all, since every row of it addresses the same cover and the browser already holds it.

### Three gaps against the contract

These are not on purpose and are not fixed. `contract/` found them. `POST` and `DELETE /api/autoplaylists/{id}` have no route here at all, so they fall to the catch-all and answer `error` where the contract publishes a `detail` beside it; the `503` from `POST /api/autoplaylists` has the same gap; and `GET /api/capabilities` omits `streamFormats` when `canStream` is false, which the contract requires either way.

Reproducing them takes more than pointing the suite at a default fake. Nothing serves this side on a port of its own: `main.ts` starts the beefweb server, and the agent gets a `listen` only inside the Playwright worker fixture, so no command puts `CONTRACT_URL` in front of it. The defaults then hide two of the three, since `maxAutoPlaylists` is `0`, so the create refuses and the update and the delete are skipped rather than driven, and `canStream` is `true`.

### Measuring against a real player

`test/measure-library.ts` times the media library endpoints against a real player and a real library, since the questions it answers are about server-side cost and the fake has none:

```sh
PLAYER=<player-host>:8880 node test/measure-library.ts
```

It compares the library read against the playlist read, sweeps range sizes to separate per-call cost from per-item cost, and tries the chunking strategies. **Record the constraint an answer establishes, never the number**, and put it in a `CLAUDE.md` or in `../src/shared/api/README.md`.

## Against a real player

`test/live/` is a second, much smaller suite that drives a player actually running foobar2000, and it replaces the fake suite rather than joining it: setting `LIVE` swaps the projects in `playwright.config.ts` for a single serial one, so `pnpm test` is untouched.

```sh
LIVE=http://<player-host>:8880/jean/ LIVE_LIBRARY_ROOT='C:\Music' pnpm test:live
```

`LIVE` is the url the app is served at, not the origin, because beefweb serves its own client at the root and Jean under a `urlMappings` prefix, and the api origin is taken from it.

**It exists for rule 10 below.** These are the comparisons where that matters: the join between the `%path%` the player reports playing and the row Jean drew, a cover that has to decode rather than merely have a `src`, an update that arrives on a real SSE stream, `fold()` against tags read off real files, and the `foo_jean` discovery chain against a real component rather than a second node server.

**Nothing here may assume what is in the library.** Counts, titles, which row carries a rating and whether any artist is accented are all read off the player first and asserted against; a spec that cannot be satisfied skips itself and says why. That is why the suite is short: an assertion that survives an unknown library has to be about a relationship rather than a value.

**`LIVE_LIBRARY_ROOT` is required and has no default.** These specs play tracks, write the play queue and can write rating tags, so the worker fixture reads the whole library first and refuses to start if one track sits outside the named folder. The check runs before any page is opened, so a wrong answer costs nothing.

## Writing a spec

Two rules outrank the rest.

> **A test asserts what a *user* can see.** Not internal state, not a class name used as logic, not a call count standing in for a visible fact. Where the assertion has to be about traffic, it is about traffic the user's action caused and the property that traffic must have, never the exact sequence a particular implementation happened to send.

> **An assertion about a request happening, or not happening, must prove the request log came to *rest*.** `expect.poll(...).toBe(n)` on a growing counter returns on the first sample that matches and proves only that the number was passed through. A "nothing was sent" read written straight is unfalsifiable in the other direction: it passes before the request is made. **`expectSettlesAt` in `fixtures.ts` is the helper for both.** It polls the value to what you expect, then waits for the whole request log to stop moving, then re-reads and asserts once more without retrying.

`test/e2e/fixtures.ts` gives every test its own player, on its own port, and carries the helpers every spec would otherwise write for itself. Anything more than one spec needs belongs there.

| | |
|---|---|
| Finding things | `trackRow`, `rowByTitle`, `statusBar`, `withNoListOnScreen`, `viewHeader`, `globalControls`, `sidebar`, `openSidebar`, `closeSidebar`, `openLibrary`, `openNowPlaying`, `nowPlayingScreen`, `listenHere`, `settingsDialog`, `openSettings`, `expectPlayingFrom` |
| Reading the player | `requestsTo`, `expectSettlesAt`, `scratchOf`, `playedFrom`, `trackPlayed` |
| Gestures | `touchDrag`, `dragTo`, `pressAndHold` |
| Scrolling | `isRowOnScreen`, `scrollUntilMounted`, `scrollTop`, `scrollTo` |
| Steps | `inSequence`, `times` |
| Constants | `FOO_JEAN_TOKEN` |

A file that is not `*.spec.ts` is not collected, which is how `fixtures.ts` and `build.ts` sit in the same folder. `nowPlaying.ts` is the same thing one level down: the lyric fixtures and the panel helpers four now-playing specs share, which are too specific to be everybody's.

```js
import { expect, requestsTo, test, trackRow } from './fixtures.ts'

test('does the thing', async ({ page, player }) => {
  await page.goto('/')
  await trackRow(page, 2).dblclick()

  // what went over the wire, read off the fake rather than the browser
  await expect.poll(() => requestsTo(player, '/items/2/play').map((r) => r.path))
    .toHaveLength(1)

  // and what came back, via SSE
  await expect(page.locator('footer')).toContainText('Deléctrico')
})
```

`player` is the fake's state, live; `player.requests` is every request the app made. **One player per worker, reset per test**, so the suite stays parallel.

A comment in a spec is allowed more room than one in `src/`. A test is documentation, and a sentence saying *why* this case matters, what broke and what a reader would otherwise assume, earns its place. Narrating what the next line does still does not.

### Fixture options

| | |
|---|---|
| `library` | `Partial<LibraryInfo>`. Pins whether the fake claims beefweb's own media library API and whether it is enabled. Jean never reads the library through it; `fake-library.spec.ts` is what that option is for |
| `librarySize` | swaps the 54 captured tracks for that many generated ones, for scroll arithmetic that only breaks past a few thousand rows |
| `mediaLibrarySize` | swaps the media library, which is what the component publishes, for that many generated tracks |
| `libraryShape` | states a library outright: counts, durations, years, tags to omit, whether an artist is spelled two ways, how many subsongs share a file. A description rather than built tracks, since an option's top level does not survive the trip to the worker as an array (nested arrays are fine) |
| `withoutFields` | removes title-formatting expressions, so the player answers `?` as a real one does. `['%lastfm_play_count%']` is an install with no playback-statistics component, and everything built on play counts must disappear rather than break |
| `withoutPlaylists` | empties the playlist list entirely: the player a fresh install would find |
| `retagged` | patches tag values onto captured tracks, keyed by title: `{ Nutshell: { '%artist%': 'Alice in Chains feat. X' } }`. Everything else about the track stays captured, and the patch reaches the media library as well as the playlists |
| `embeddedArt` | gives a track a cover of its own, keyed by title: `{ 'No Excuses': 'deja-entendu.jpg' }` names a file in `fake-api/artwork/`. That track's own address answers it and the rest of the album answers the album's, which is what a file carrying the wrong sleeve looks like to `GET /api/artwork` |
| `playlistsFromRow` | seeds a playlist from that row on and drops the ones before it, keyed by beefweb id: `{ p1: 1 }` is a view that begins partway into an album |
| `playerState` | seeds the player: what is playing, the volume, the playback mode |
| `settings` | merged over a default seed, so a spec names only what it cares about |
| `firstRun` | drops the settings seed entirely, which is what makes the first-run affordances appear |
| `fooJean` | puts the component in whichever state is needed. `{}` is installed, listening and serving, which is the default; `null` is not installed. Then `{ listening: false }`, `{ reachable: false }`, `{ agentName: … }`, `{ allowedFields: [] }`, `{ failWrites: 403 }`, `{ failState: 503 }`, `{ failQueue: 500 }`, `{ knowsPlayingLocation: false }`, `{ annotatesEveryPlaylist: false }`, `canStream`, `streamFormats`, `playableFormats`, `streamBehaviour`, `streamPrime`, `failTickets` with `ticketError`, `expireTickets`, `otherListeners`, `canMuteWhileStreaming`, `maxAutoPlaylists`, `autoPlaylists`, `libraryEnabled`, `failCreate`, `pairingOpen`, `failPairing` with `pairingError` |
| `fooJeanToken` | seeds the credential. `FOO_JEAN_TOKEN` by default; `null` is a device that has never paired |
| `motion` | reduced by default, since Playwright will not click a target whose bounding box never holds still. `'allow'` opts out. `reducedMotion` in `use` does **not** work. It is accepted and silently ignored, so the fixture calls `page.emulateMedia()` |

### Control routes

- **`POST /__control/play`** drives the player the way the desktop would: the case Jean has to survive and cannot provoke reliably against a real one. **`/__control/append`** is the same for playlists: the desktop adding tracks while Jean holds a range of indices.
- **`POST /__control/latency`** holds writes for N milliseconds, and `GET /api/playlists` and the six playlist writes on `foo_jean`'s side besides, since a slow join is what `useAutoPlaylists.ts` has to be caught catching up with and an optimistic playlist edit is indistinguishable from a fast one without it. On localhost every request settles before the next pointer event, so a control coalescing forty moves into three looks identical to one sending forty. `useCoalescedWrite` is untestable without it.
- **`POST /__control/writePlaylists { canWrite }`** flips `foo_jean`'s `canWritePlaylists` mid-test, the one way a spec can put a refusal in front of a control still drawn: the component answers its capabilities once, at discovery, so an install with the setting off from the start draws no playlist-editing control at all.
- **`POST /__control/skipGap`** spends N milliseconds reporting an empty `activeItem` on a skip, the way beefweb does while the player opens the next file; the real player's own state carries no such gap. Off by default, since the gap makes `next` asynchronous and no other spec should have to wait one out.
- **`POST /__control/dropStream`** hangs up on every open update stream and answers how many it dropped: a wifi hiccup, a proxy timing out, a phone coming out of a pocket.
- **`GET /__control/state`** returns the player, the playlists, the queue and the request log in one read, for a spec driving the fake from outside the fixture. **`POST /__control/state { failState: n }`** switches `GET /api/state`'s refusal on mid-test and `{ failState: null }` turns it back off, the one thing `failWrites` cannot do: a spec cuts the poll off, drives the player through the routes above while it is blind, then lets it back and reads the next tick.
- **`POST /__control/lockPlaylist { id, locked }`** locks a beefweb id against having rows added, or releases it, the way some other component locking a playlist would: the copy and the fill routes both consult it beside `isAuto`, and both answer `409` for as long as it holds.
- **`POST /__control/failPlaylistWrites { status }`** refuses every playlist mutation with that status, the same pattern `failState` uses for `GET /api/state`: a write that failed at the player rather than one it refused. Leaving `status` out turns the refusal back off.
- **`POST /__control/requests`** empties the request log.

### Rules

1. **Parameterise over the layouts, not just the viewports.** List and album are not one code path with a different stylesheet: album virtualises groups rather than rows, and on a phone the cover stacks above its tracks. Loop a describe over both and seed `jean.layout`.
2. **`test.use` goes *inside* a describe, never beside one.** At file scope it applies to the whole file however many times it is called, so a loop writing it once per layout runs every case under whichever it wrote last: green, correctly named, and covering the same thing twice.
3. **`inSequence` and `times` rather than a loop.** Playwright assertions share one page, so steps must be awaited in order. Both live in `fixtures.ts`; `inSequence` is the `reduce`, and `times` is built on it.
4. **Drive timing-sensitive input from inside the page.** Anything racing an animation cannot be driven over the wire, because three round trips land after the animation has finished, so the test passes whether the behaviour works or not. Dispatch from `page.evaluate`, one frame apart. A synthetic wheel event scrolls nothing, which is usually the point: what is under test is the listener.
5. **Wait on the player, not on the render that looks right.** `isRowOnScreen` is true as soon as an animated scroll brings a row into view, long before it stops moving. And mutations write to the query cache before the request goes out, so the UI flips before the stream agrees. Prefer the fake's own state, where `player.player.playbackMode` has no optimism in it, and **assert the property rather than the exact traffic**: "nothing it sends ever asks for a different order" survives a duplicated idempotent request where `toEqual([4])` does not.

   **Settle by watching, never by sleeping.** Where the thing to wait on is a scroll offset rather than a request, the local `settle()` helpers walk it frame by frame from inside the page and return once it has held still; `artwork.spec.ts` waits for the offset *and* the request log to stop moving together. A fixed `waitForTimeout` followed by a hard assertion fails a slow machine instead of waiting for it, and is the slowest thing in whatever file it is in. Use `waitForTimeout` only to cross a threshold on purpose: past a hold, past a debounce, or to let a window elapse and prove nothing happened.

   Where the end state is what matters, prefer a retrying assertion over settle-then-assert. `expectCentredOrClamped` polls a sentence describing what it saw, so a failure reports the offset rather than a boolean.
6. **A case that means to watch which address a cover is asked for has to own the page.** A cover is held for 180 days, and `artworkHandles` holds a blob per identity for the tab's life, so any view that draws tracks pre-warms both, and a later ask at the same identity is answered inside the browser rather than reaching the player. `withNoListOnScreen` in `fixtures.ts` is the page that draws none: the search route before anything has been searched for. It waits on the status bar rather than on the empty list, since no rows is true of a page that has not rendered yet.
7. **Touch is a gesture, not a narrow mouse.** Touch tests go through CDP `Input.dispatchTouchEvent` rather than dispatching DOM events, since what is under test is the browser's own decision about who the gesture belongs to: without `touch-action: none` it decides the finger is panning and stops delivering moves, and a swipe aimed at one place lands at another. A dispatched `pointermove` sails past that and passes either way.
8. **Check an injection more than once.** A guard that fails on one run and passes on the next is flaky, not covered.
9. **A test that cannot fail is worse than no test.** When one covers a guard rather than a feature, such as "a long press plays nothing" or "a desktop click does not play", delete the guard, watch it go red, and put the guard back.
10. **Anywhere the fake supplies both sides of a comparison, it is only testing that a string equals itself.** Path joins between the stream timeline and the poll's own `player.path` are the case in point, and have to be verified against a real player.
11. **Assert what a value settles at, never what it passed through.** `expectSettlesAt` is that, and the top of this section is why.
12. **A keyboard shortcut gated by `useKeymap`'s `enabled` waits for nothing on its own.** `locator.click()` waits for the button sharing that condition to become actionable; `page.keyboard.press()` fires immediately, and a keystroke sent before the gate opens is not queued for when it does. Wait on whatever draws the gate visibly, usually the same button, before pressing the key.
