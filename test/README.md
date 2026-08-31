# Tests

End-to-end, in a real browser, against a fake player. There are no unit tests
and no jsdom.

That is a deliberate choice rather than a stage we have not reached yet. The
things that break in Jean are the things jsdom cannot see: the virtualiser needs
real layout to render anything at all, `dnd.js` hit-tests with
`elementFromPoint`, `useSortableList` and `useLongPress` are pointer gestures,
`useVisualViewport` follows a keyboard that only exists on a device, and half
the design is a *different component* below 860px rather than a narrower one. A
suite that mocked all of that would go green while the app was broken, which is
worse than having none.

Pure functions -- `fold()`, the volume curve, `deriveIntensity`, `groupByAlbum`
-- are the exception and are worth unit tests when someone wants them. They need
no DOM, so they need no harness either.

```sh
pnpm test          # everything, desktop and mobile
pnpm test:ui       # pick and watch tests interactively
pnpm test --project=desktop -g "double-clicking"
```

`pnpm test` builds first (`test/e2e/build.js`) and serves the build from the
fake, because that is beefweb's own arrangement: one origin answering both the
app and `/api`. Running the dev server behind a proxy instead would test a
setup that exists only on the machine it was written on.

## The fake player

`test/fake-api/` is a small in-memory foobar2000. It implements the routes the
app uses, holds real playlists, and pushes SSE the way beefweb does -- a full
snapshot on connect, then only what changed, and **never on a timer**.

It is named for the API shape rather than for beefweb, deliberately. The plugin
is the swappable part; the request and response shapes are what would survive
swapping it, and those are what this is a copy of. Comments inside still name
beefweb wherever its real behaviour is the reason for something -- the `?` an
unresolved column returns, the stream that never ticks, the static server with
no SPA fallback. Those are the notes you would want in front of you if the
provider ever did change.
Position advances in the app's own interpolation, so a test that depended on the
fake ticking would be testing behaviour the real player does not have.

Run it on its own to develop with no foobar2000 in reach:

```sh
pnpm fake                                   # API only, on :8880
BEEFWEB_URL=http://localhost:8880 pnpm dev  # in another shell

pnpm build && node test/fake-api/main.js --serve dist   # as beefweb serves it
```

### The fixture is captured, not invented

`library.json` and `player.json` came off a real player via
`node test/fake-api/capture.mjs --url http://your-player:8880`, so the fake
replays bytes foobar2000 actually produced. Five albums, 54 tracks, chosen for
the branches the UI has rather than to be a representative library:

| | why it is in there |
|---|---|
| Babasónicos — *Jessico* | accented artist, for `fold()`; played throughout |
| Brand New — *Deja Entendu* | the heat range: one 0-play track among 180-play ones |
| Alice in Chains — *Jar Of Flies* | FLAC rather than MP3, and a non-square cover |
| As Tall as Lions — *Lafcadio* | never played at all — no heat, no patina, no last-played |
| Have a Nice Life — *Deathconsciousness* | two discs, so `%tracknumber%` restarts mid-album |

Tracks are stored as objects keyed by title-formatting expression, not as the
positional arrays the API returns. The fake has to answer whatever column set is
asked of it -- two for the status bar, thirteen for the track list -- and it
preserves the distinction the whole capability-detection mechanism rests on: an
expression the fixture does not carry resolves to `?`, exactly as an unsupported
field does on a real player. Dropping `%lastfm_play_count%` from a fixture is
how you test an install with no playback-statistics component.

The playlist ids are `p1 p7 p2 p5` -- not contiguous, not in index order. That is
what the real install looks like, and anything that quietly assumes otherwise
should fail here rather than on someone's machine.

The cover art is real, downscaled to 320px. If shipping five album covers in a
public repo is a problem, replace the files in `artwork/`; nothing reads them
but the fake.

## Writing a test

`test/e2e/fixtures.js` gives every test its own player, on its own port:

```js
import { expect, requestsTo, test, trackRow } from './fixtures.js'

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

- **`player`** is the fake's state, live. `player.requests` is every request the
  app made, which is how you assert that a drag sent one `items/copy` and not
  forty, or that a coalesced write sent the last value rather than every value.
- **One player per worker, reset per test**, so the suite stays parallel without
  tests seeing each other's playlists.
- **`POST /__control/play`** drives the player the way the desktop would --
  the case Jean has to survive and which cannot be provoked reliably against a
  real one.
- **`librarySize`** swaps the 54 captured tracks for that many generated ones.
  `test.use({ librarySize: 30441 })` gets a library that loads in chunks rather
  than one response, over a list 1.4 million pixels tall. Scroll arithmetic that
  breaks past a few thousand rows has nowhere else to show up.
- **`withoutFields`** removes title-formatting expressions from the fixture, so
  the player answers `?` for them exactly as a real one does for a field no
  component provides. `test.use({ withoutFields: ['%lastfm_play_count%'] })` is
  foobar2000 with no playback-statistics component, and everything built on play
  counts should disappear rather than break. This is the promise nothing else
  can check: a bare install must get a complete app, never a dead control.
- **`settings`** seeds localStorage. It defaults to marking the play-count
  shading as already introduced, since that popover otherwise opens over the
  toolbar in every test that never asked about it. Override it with
  `test.use({ settings: {} })` to test first-run behaviour.
- **Motion is reduced by default.** The play/pause toggle animates for as long
  as something is playing, and Playwright will not click a target whose bounding
  box never holds still. `test.use({ motion: 'allow' })` opts out.
  Note that `reducedMotion` in `use` does *not* work as of Playwright 1.62 --
  it is accepted and silently ignored, which is why the fixture calls
  `page.emulateMedia()` instead.

**Parameterise over the layouts, not just the viewports.** Compact and album are
not one code path with a different stylesheet: album virtualises groups rather
than rows, so the index the virtualiser is given is not the index being scrolled
to, and on a phone the cover stacks above its tracks instead of beside them.
Looping a describe over `['compact', 'album']` and seeding `jean.layout` costs
one line and doubles into four cases, since both projects run everything.

Both projects -- `desktop` and `mobile` (Pixel 7, touch on) -- run every spec.
Skip explicitly when a gesture has no equivalent on the other surface, and say
why.

**Drive timing-sensitive input from inside the page.** Anything racing an
animation -- interrupting a 240ms scroll, say -- cannot be driven over the wire:
`keyboard.press` then `waitForTimeout(80)` then `mouse.wheel` is three round
trips, and under parallel workers they land after the animation has already
finished, so the test passes whether the behaviour works or not. That is worse
than a test that cannot fail, because it *does* fail correctly when run alone
and then passes in a full run. Dispatch the events from `page.evaluate` instead,
one frame apart. A synthetic wheel event scrolls nothing, which is usually the
point: what is under test is the listener, not the scrolling.

**Wait on the player, not on the render that looks right.** Four separate flakes
this session were the same mistake: waiting for a signal that goes true *before*
the app has settled, then measuring.

It has two faces. One is transitions -- `isRowOnScreen` is true as soon as an
animated scroll brings the row into view, which is several hundred milliseconds
before it stops moving, so anything that then measures the position or scrolls
away is fighting the animation still in flight. That is what `settle()` in
`follow.spec.js` is for: two equal scroll readings, and only then measure.

The other is optimistic state. Mutations write to the query cache before the
request goes out, so the UI flips immediately -- and if a second request is in
flight concurrently, the stream can still be describing the state before both of
them. The status bar's shuffle toggle genuinely flickers unpressed for a beat
and settles pressed. Harmless to a person, a coin flip to press a second button
against.

So prefer the fake's own state as the thing you wait on -- `player.player.playbackMode`
is what the player really thinks, with no optimism in it -- and assert the
property rather than the exact traffic. "Nothing it sends ever asks for a
different order" survives a duplicated idempotent request; `toEqual([4])` does
not, and the difference between those two is not a bug.

These fail once in five full runs and pass every time in isolation, which is the
worst way for a test to be wrong: you debug it alone, it passes, and you move on.

**Check an injection more than once.** A guard that fails on one run and passes
on the next is not covered, it is flaky, and running the suite three times under
the injection is what tells the two apart.

A test that cannot fail is worse than no test. When one covers a guard rather
than a feature -- "a long press plays nothing", "a desktop click does not
play" -- delete the guard, watch it go red, and put the guard back. Both of
those were vacuous when first written: one never dispatched the `pointerup`
that produces the click it claimed to be about.
