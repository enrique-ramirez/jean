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

`test/fake-beefweb/` is a small in-memory foobar2000. It implements the routes
the app uses, holds real playlists, and pushes SSE the way beefweb does -- a
full snapshot on connect, then only what changed, and **never on a timer**.
Position advances in the app's own interpolation, so a test that depended on the
fake ticking would be testing behaviour the real player does not have.

Run it on its own to develop with no foobar2000 in reach:

```sh
pnpm fake                                   # API only, on :8880
BEEFWEB_URL=http://localhost:8880 pnpm dev  # in another shell

pnpm build && node test/fake-beefweb/main.js --serve dist   # as beefweb serves it
```

### The fixture is captured, not invented

`library.json` and `player.json` came off a real player via
`node test/fake-beefweb/capture.mjs --url http://your-player:8880`, so the fake
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

Both projects -- `desktop` and `mobile` (Pixel 7, touch on) -- run every spec.
Skip explicitly when a gesture has no equivalent on the other surface, and say
why.

A test that cannot fail is worse than no test. When one covers a guard rather
than a feature -- "a long press plays nothing", "a desktop click does not
play" -- delete the guard, watch it go red, and put the guard back. Both of
those were vacuous when first written: one never dispatched the `pointerup`
that produces the click it claimed to be about.
