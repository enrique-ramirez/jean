# Tests

End-to-end, in a real browser, against a fake player. There are no unit tests and no jsdom: what breaks in Jean needs real layout, real pointers and a real viewport — the virtualiser renders nothing without layout, `dnd.ts` hit-tests with `elementFromPoint`, the gestures are pointer and touch streams, and half the design is a *different component* below 860px rather than a narrower one.

Pure functions — `fold()`, the volume curve, `deriveIntensity`, `groupByAlbum` — need no DOM and are worth unit tests when someone wants them.

## Running it

```sh
pnpm test                                        # everything, desktop and mobile
pnpm test:ui                                     # pick and watch interactively
pnpm test --project=desktop -g "double-clicking" # one test
```

`pnpm test` builds first (`test/e2e/build.ts`) and serves the build from the fake, because that is beefweb's arrangement: one origin answering both the app and `/api`.

Both projects — `desktop` and `mobile` (Pixel 7, touch on) — run every spec. Skip explicitly when a gesture has no equivalent on the other surface, and say why.

**The suite runs against both library sources**, since the app must behave identically whether the library comes from the media library API or from an autoplaylist:

```sh
pnpm test                          # the media library API (the default)
JEAN_NO_LIBRARY_API=1 pnpm test    # the autoplaylist fallback
```

Both are green at the same count. If a change makes one pass and the other fail, something outside `librarySource.ts` has learned which source it is talking to. Three specs are source-aware: `fake-library.spec.ts` and one describe in `library-source.spec.ts` **pin the API on** because they are about it, and `navigation.spec.ts`'s first-run block asks for `withoutLibraryPlaylist` *and* `library: { supported: false }`, because the setup screen exists only when there is no API **and** no autoplaylist.

## Touch gestures

`touchDrag` in `fixtures.ts` drives a finger through CDP rather than dispatching DOM events, because most of these tests are about *the browser's* decision on who a gesture belongs to and a dispatched `touchmove` sails past that.

Two things it does that are not optional. **Every point carries a timestamp**, twenty milliseconds apart: `useSwipe` reads anything slower than 600 ms as a scroll rather than a flick, and a gesture is one round trip per point, so on a loaded machine an unstamped drag silently stops being a flick. And **one CDP session per page, never one per drag**: detaching a session while the next is dispatching drops the moves in between, and the gesture arrives as a tap where it started.

## The fake player

`test/fake-api/` is a small in-memory foobar2000. It implements the routes the app uses, holds real playlists, and pushes SSE the way beefweb does — a full snapshot on connect, then only what changed, and **never on a timer**. Position advances in the app's own interpolation, so a test depending on the fake ticking would be testing behaviour the real player does not have.

Run it alone to develop with no player in reach:

```sh
pnpm fake                                   # API only, on :8880
BEEFWEB_URL=http://localhost:8880 pnpm dev  # in another shell

pnpm build && node test/fake-api/main.ts --serve dist   # as beefweb serves it
```

### The routes run in two places

`routes.ts` and `fooJean.ts`'s `handleAgent` have no host in them. `server.ts` and `agentServer.ts` give them a node socket for the suite; `demo/sw.ts` gives the same tables a `fetch` event. The seam is `Responder` in `http.ts` — four methods, which `ServerResponse` satisfies as it stands.

Two consequences before adding a route. **Anything reaching for a socket, a file or a `Buffer` belongs in the host files**, not the route tables; the artwork routes are the worked example and take a `(name, headers, response)` function instead of a path. And **fixtures are imported rather than read off disk**, because one of the two hosts has no filesystem.

### The fixture is captured, not invented

`library.json` and `player.json` came off a real player via `node test/fake-api/capture.ts --url http://<player-host>:8880`, so the fake replays bytes foobar2000 actually produced. Five albums, 54 tracks, chosen for the branches the UI has:

| | why it is in there |
|---|---|
| Babasónicos — *Jessico* | accented artist, for `fold()`; played throughout |
| Brand New — *Deja Entendu* | the heat range: one 0-play track among 180-play ones |
| Alice in Chains — *Jar Of Flies* | FLAC rather than MP3, and a non-square cover |
| As Tall as Lions — *Lafcadio* | never played at all — no heat, no patina, no last-played |
| Have a Nice Life — *Deathconsciousness* | two discs, so `%tracknumber%` restarts mid-album |

Tracks are stored as objects keyed by title-formatting expression, not as the positional arrays the API returns: the fake has to answer whatever column set is asked of it, and **an expression the fixture does not carry resolves to `?`**, exactly as an unsupported field does on a real player. Dropping `%lastfm_play_count%` from a fixture is how you test an install with no playback-statistics component.

The playlist ids are `p1 p7 p2 p5` — not contiguous, not in index order, which is what a real install looks like.

The cover art is real, downscaled to 320px. Nothing but the fake reads `artwork/`.

**The same tool captures the demo's library, and the two must not be confused.** `capture.ts --albums demo/albums.ts --out demo` writes into `demo/`; see `demo/CLAUDE.md`. Nothing in `demo/` is read by a test and nothing here is read by the demo. A named album the tool cannot find is fatal for the fixture and merely skipped for the demo, and a demo capture leaves `player.json` alone.

### The media library

The fake serves the beefweb 0.11+ library API — `/library/info`, `/library/items`, `/library/items/by-path`, `/artwork/library` and `/playlists/{id}/items/add-from-library` — against shapes measured on a live player. `fake-library.spec.ts` is that check; `API.md` records the shapes.

The library is **derived from the captured tracks rather than invented**: the capture's absolute `%path%` values give a deepest shared directory, which is treated as the media library folder, and what is left is the library-relative, forward-slashed path the real API returns.

- `test.use({ library: { supported: false } })` is **DeaDBeeF**: `/library/info` still answers, because that is how a client discovers it has no library, and everything else is **501**.
- `{ enabled: false }` is foobar2000 with no media library configured — supported, empty, a different problem with a different fix.
- Both send Jean back to the autoplaylist and **must not collapse into one state**.

Two things the fake **refuses** rather than approximating, because a filter that silently disagreed with the real one is worse than no filter: the player's `query` syntax, and `sort` by anything but a bare `%field%`. Both answer **400**.

Not fakeable: **`subsong` is always 0**, because every captured file is one track and a subsong needs a cue sheet or a disc image.

### What the fake gets wrong on purpose

A fake kinder than the player it stands in for makes the suite agree with itself and disagree with reality.

- **A request body over 1 MiB is refused by hanging up**, not answered with a status. The fake destroys the socket at the same threshold.
- **A set added from the library comes back in the media library's browse order** — album artist, album, track — not the order it was given, nor the file-path order `/library/items` pages in. The captured fixture cannot show this on its own, since its folders match its tags; `mediaLibrarySize` synthesises a library where they disagree.
- **`foo_jean` is a second listener on its own port, not another route.** Every call to it is cross-origin, is preceded by a CORS preflight for the `Authorization` header, and can fail by not answering at all. So `fake-api/fooJean.ts` gets its own `http.Server`, started and stopped by the worker fixture that owns the beefweb one. **The unreachable state destroys the connection rather than answering 500** — a refused socket and an error response are different events in the browser, and "installed, advertised, healthy, unreachable" must never render as "not installed". **Preflights land in `player.requests`**, so counting writes means filtering to `POST`.
- **A stream fails every way a second listener can.** `fooJean.streamBehaviour` is `short` (ends after what it has sent, for reconnect) and `quiet` (opens, sends the container header, then nothing — the case with **no error to catch**, which is what a stopped player looks like and what the stall watchdog is the only answer to). `playableFormats` names which of `streamFormats` get bytes of the declared type. `failTickets` with `ticketError` separates a 503 meaning "busy" from one meaning "not supported". `expireTickets` answers 401 at `GET /stream`.
- **The timeline carries a history and the clock starts before the fake does.** `state.streamMarks` records where recent tracks began, backdated by the position the player was at, because a listener is always *behind* the live edge. `startedAt` is a minute in the past, since the component starts with foobar2000 long before any client connects.
- **`streamPrime` decides whether this fake has a lag at all**, and the default removes it. A spec about the lag asks for `streamPrime: 6` and waits while Chromium accumulates the rest at real time. **`12 - prime`** is the arithmetic; size a margin against a loaded machine, never against the nominal figure.

**The one place the fake is deliberately kinder.** The stream serves WAV rather than Ogg Opus — there is no encoder in a Node fake — and in Chromium a non-seekable WAV does not fire `loadedmetadata` until roughly twelve **seconds of content** have arrived. Not bytes: raising the primed burst from 2 s to 15 s moved playback start from 12.7 s to 287 ms at an unchanged byte rate. That is a property of PCM in a container never meant to be streamed. So the healthy stream hands over 15 s up front and then feeds at 1x, which starts sooner than a real one would; what that could hide — a long gap between asking and hearing — is covered by `quiet` instead.

### Measuring against a real player

`test/measure-library.ts` times the media library endpoints against a real player and a real library, because the questions it answers are about server-side cost and the fake has none:

```sh
PLAYER=<player-host>:8880 node test/measure-library.ts
```

It compares the library read against the playlist read, sweeps range sizes to separate per-call cost from per-item cost, and tries the chunking strategies. Answers go in a `CLAUDE.md` or in `API.md`, never in a comment.

## Against a real player

`test/live/` is a second, much smaller suite that drives a player that is actually running foobar2000, and it replaces the fake suite rather than joining it: setting `LIVE` swaps the projects in `playwright.config.ts` for a single serial one, so `pnpm test` is untouched.

```sh
LIVE=http://<player-host>:8880/jean/ LIVE_LIBRARY_ROOT='D:\SomeFolder' pnpm test:live
```

`LIVE` is the url the app is served at, not the origin — beefweb serves its own client at the root and Jean under a `urlMappings` prefix — and the api origin is taken from it.

**It exists for rule 9 below.** These are the comparisons where that matters: the join between the `%path%` the player reports playing and the row Jean drew, a cover that has to decode rather than merely have a `src`, an update that arrives on a real SSE stream, `fold()` against tags read off real files, and the `foo_jean` discovery chain against a real component rather than a second node server.

**Nothing here may assume what is in the library.** Counts, titles, which row carries a rating and whether any artist is accented are all read off the player first and asserted against; a spec that cannot be satisfied skips itself and says why. That is why the suite is short: an assertion that survives an unknown library has to be about a relationship rather than a value.

### DeaDBeeF

beefweb supports a second player, and `test/live/deadbeef/` is how that one gets tested. It is a container because **the released beefweb plugin for DeaDBeeF is a Linux x86-64 `.so` and always has been** — no release has ever carried a Windows or macOS build — so the pairing cannot be installed on a foobar2000 machine or on a mac at all. The image downloads both the player and the plugin, so nothing binary is committed here.

```sh
docker build --platform linux/amd64 -t jean-deadbeef test/live/deadbeef
docker run -d --name jean-ddb --platform linux/amd64 -p 8890:8880 \
  -v /path/to/music:/music:ro -v "$PWD/dist:/jean:ro" jean-deadbeef
```

Then create a playlist named `#Jean Library` and add `/music` to it over the api — **DeaDBeeF has no autoplaylists**, so Jean's usual library playlist cannot keep itself in sync there and the folder-playlist fallback is the honest path for a real install.

Three things about the container are load-bearing and none of them is obvious. It runs the bundled **`nullout`** output plugin, which needs no sound device and is what leaves a playback state to assert on. It needs **an X server anyway**, because DeaDBeeF exits 1 when its GTK ui cannot open a display — started directly rather than through `xvfb-run`, whose wait-for-display loop does not return under emulation and leaves the player unlaunched with no output saying so. And it sets a **UTF-8 locale**, without which beefweb's artwork route fails `iconv` on any non-ascii path, which is most of a real library.

**`LIVE_LIBRARY_ROOT` is required and has no default.** These specs play tracks, write the play queue and can write rating tags, so the worker fixture reads the whole library first and refuses to start if one track sits outside the named folder. The check runs before any page is opened, so a wrong answer costs nothing.

## Writing a spec

`test/e2e/fixtures.ts` gives every test its own player, on its own port, and carries the helpers every spec would otherwise write for itself — `openLibrary`, `openSidebar`, `trackRow`, `scratchOf`, `playedFrom`, `trackPlayed`, `pressAndHold`, `statusBar`, `viewHeader`. Anything more than one spec needs belongs there.

```js
import { expect, requestsTo, test, trackRow } from './fixtures.ts'

test('does the thing', async ({ page, player }) => {
  await page.goto('/')
  await trackRow(page, 2).dblclick()

  // what went over the wire, read off the fake rather than the browser
  await expect.poll(() => requestsTo(player, '/player/play/').map((r) => r.path))
    .toEqual(['/api/player/play/p7/2'])

  // and what came back, via SSE
  await expect(page.locator('footer')).toContainText('Deléctrico')
})
```

`player` is the fake's state, live; `player.requests` is every request the app made. **One player per worker, reset per test**, so the suite stays parallel.

### Fixture options

| | |
|---|---|
| `librarySize` | swaps the 54 captured tracks for that many generated ones, for scroll arithmetic that only breaks past a few thousand rows |
| `mediaLibrarySize` | inflates the **media library** and the `#Jean Library` autoplaylist together, so both sources describe the same library |
| `libraryShape` | states a library outright: counts, durations, years, tags to omit, whether an artist is spelled two ways. A description rather than built tracks, because an option's top level does not survive the trip to the worker as an array (nested arrays are fine) |
| `withoutFields` | removes title-formatting expressions, so the player answers `?` as a real one does. `['%lastfm_play_count%']` is an install with no playback-statistics component, and everything built on play counts must disappear rather than break |
| `withoutPlaylists` | empties everything but Jean's own — the player a fresh install would find |
| `withoutLibraryPlaylist` | renames the playlist Jean resolves as the library, the only way to reach the first-run setup screen |
| `retagged` | patches tag values onto captured tracks, keyed by title: `{ Nutshell: { '%artist%': 'Alice in Chains feat. X' } }`. Everything else about the track stays captured |
| `settings` | merged over a default seed, so a spec names only what it cares about. **`firstRun: true`** drops the seed entirely |
| `fooJean` | installs the component in whichever state is needed: absent (the default), `{ listening: false }`, `{ reachable: false }`, `{ agentName: … }`, `{ allowedFields: [] }`, `{ failWrites: 403 }`, `canStream: false`, `pairingOpen: true`, `failPairing` with `pairingError`. `fooJeanToken` seeds the credential |
| `hasLibraryApi` | whether this run has the media library API. Ask the fixture rather than reading `process.env`: a spec that pins `library` gets the right answer |
| `motion` | reduced by default, because Playwright will not click a target whose bounding box never holds still. `'allow'` opts out. `reducedMotion` in `use` does **not** work as of Playwright 1.62 — it is accepted and silently ignored, so the fixture calls `page.emulateMedia()` |

Pairing is **single-grant in the fake as in the component**: the first success closes the window. The fake also refuses a body that is not `application/json`, because a client that stopped sending that header would pass every other assertion and fail against a real install.

### Control routes

- **`POST /__control/play`** drives the player the way the desktop would — the case Jean has to survive and cannot provoke reliably against a real one. **`/__control/append`** is the same for playlists: the desktop adding tracks while Jean holds a range of indices.
- **`POST /__control/latency`** holds writes for N milliseconds. On localhost every request settles before the next pointer event, so a control coalescing forty moves into three looks identical to one sending forty. `useCoalescedWrite` is untestable without it.
- **`POST /__control/skipGap`** spends N milliseconds reporting an empty `activeItem` on a skip, as the real player does while it opens the next file. Off by default, because the gap makes `next` asynchronous and no other spec should have to wait one out.

### Rules

1. **Parameterise over the layouts, not just the viewports.** Compact and album are not one code path with a different stylesheet: album virtualises groups rather than rows, and on a phone the cover stacks above its tracks. Loop a describe over `['compact', 'album']` and seed `jean.layout`.
2. **`test.use` goes *inside* a describe, never beside one.** At file scope it applies to the whole file however many times it is called, so a loop writing it once per layout runs every case under whichever it wrote last — green, correctly named, and covering the same thing twice.
3. **`inSequence` and `times` rather than a loop.** Playwright assertions share one page, so steps must be awaited in order. `times` is a `reduce` in `fixtures.ts`; `inSequence` is re-exported from `src/shared/lib/sequence.ts`.
4. **Drive timing-sensitive input from inside the page.** Anything racing an animation cannot be driven over the wire — three round trips land after the animation has finished, so the test passes whether the behaviour works or not. Dispatch from `page.evaluate`, one frame apart. A synthetic wheel event scrolls nothing, which is usually the point: what is under test is the listener.
5. **Wait on the player, not on the render that looks right.** `isRowOnScreen` is true as soon as an animated scroll brings a row into view, hundreds of milliseconds before it stops moving; `settle()` in `follow.spec.ts` takes two equal scroll readings first. And mutations write to the query cache before the request goes out, so the UI flips before the stream agrees. Prefer the fake's own state — `player.player.playbackMode` has no optimism in it — and **assert the property rather than the exact traffic**: "nothing it sends ever asks for a different order" survives a duplicated idempotent request where `toEqual([4])` does not.
6. **Touch is a gesture, not a narrow mouse.** Touch tests go through CDP `Input.dispatchTouchEvent` rather than dispatching DOM events, because what is under test is the browser's own decision about who the gesture belongs to: without `touch-action: none` it decides the finger is panning and stops delivering moves, and a swipe aimed at 25% lands at 74%. A dispatched `pointermove` sails past that and passes either way.
7. **Check an injection more than once.** A guard that fails on one run and passes on the next is flaky, not covered.
8. **A test that cannot fail is worse than no test.** When one covers a guard rather than a feature — "a long press plays nothing", "a desktop click does not play" — delete the guard, watch it go red, and put the guard back.
9. **Anywhere the fake supplies both sides of a comparison, it is only testing that a string equals itself.** Path joins between the stream timeline and beefweb's `%path%` are the case in point, and have to be verified against a real player.
