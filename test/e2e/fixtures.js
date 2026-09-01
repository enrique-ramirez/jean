import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test as base, expect } from '@playwright/test'

import { createServer } from '../fake-api/server.js'
import { DEFAULT_PLAYLISTS, createState } from '../fake-api/state.js'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../dist')

export const test = base.extend({
  // One fake player per worker, on a port the OS picks. Workers never share a
  // player, so the suite stays parallel without tests seeing each other's
  // playlists.
  fakeServer: [
    async ({}, use) => {
      const server = createServer({ serveDir: DIST })
      await new Promise((resolve) => server.listen(0, resolve))
      await use(server)
      await new Promise((resolve) => server.close(resolve))
    },
    { scope: 'worker' },
  ],

  // How many tracks the Library playlist holds. The captured 54 are enough for
  // anything about one screen of rows; past a few thousand the app behaves
  // differently -- rows arrive in chunks rather than one response, and scroll
  // offsets are computed over a list taller than any hand-written fixture.
  // test.use({ librarySize: 30441 }) to ask for that.
  librarySize: [null, { option: true }],

  // Title-formatting expressions this player cannot resolve, so a spec can ask
  // for a bare install: test.use({ withoutFields: ['%lastfm_play_count%'] }) is
  // foobar2000 with no playback-statistics component, and everything built on
  // play counts should disappear rather than break.
  withoutFields: [[], { option: true }],

  // Removes the playlist Jean resolves as the library, so the first-run path is
  // reachable. Nothing else can get there: an install that already has a
  // `#Jean Library` never sees the setup screen, and the capture always has one.
  withoutLibraryPlaylist: [false, { option: true }],

  // The media library's state, as beefweb 0.11+ reports it.
  // test.use({ library: { supported: false } }) is DeaDBeeF, where every
  // library endpoint answers 501; { enabled: false } is foobar2000 with no
  // media library configured. Both send Jean back to the autoplaylist, but for
  // different reasons and with different fixes.
  // JEAN_NO_LIBRARY_API=1 runs the whole suite against the autoplaylist
  // fallback instead. The app is supposed to behave identically either way --
  // that is what the source seam is for -- so the same assertions should hold
  // with the data coming from somewhere else entirely. Where they cannot, the
  // spec says so and skips.
  library: [
    process.env.JEAN_NO_LIBRARY_API ? { supported: false } : {},
    { option: true },
  ],

  // Tag values the capture does not carry, keyed by track title:
  // test.use({ retagged: { Bloodhail: { '%artist%': 'Have a Nice Life feat. X' } } }).
  // The captured library has no featured artist and no compilation on it, and
  // both change what a row renders -- so a test states the tag rather than the
  // fixture growing an invented album for it.
  retagged: [{}, { option: true }],

  // Overrides merged onto the captured player state, for the things that vary
  // between installs and are not in the fixture: permissions, the volume range,
  // which playback orders the player actually offers.
  playerState: [null, { option: true }],

  // A fresh player per test. The previous test's page is closed by now, so no
  // stream is left subscribed to the state being discarded.
  player: async (
    {
      fakeServer,
      librarySize,
      withoutFields,
      retagged,
      withoutLibraryPlaylist,
      library,
      playerState,
    },
    use,
  ) => {
    // Drops the `#Jean Library` autoplaylist, which is the only thing that makes
    // Jean's library resolve on a player without the media library API -- so
    // this is the first run. The ordinary playlist called 'Library' stays, and
    // must not be mistaken for it.
    const playlists = DEFAULT_PLAYLISTS().filter(
      (playlist) => !(withoutLibraryPlaylist && playlist.title === '#Jean Library'),
    )

    await use(
      fakeServer.reset(
        createState({
          playlists,
          librarySize,
          withoutFields,
          retagged,
          library,
          player: playerState,
        }),
      ),
    )
  },

  baseURL: async ({ fakeServer }, use) => {
    await use(`http://localhost:${fakeServer.address().port}`)
  },

  // Settings live in localStorage until they move to /api/clientconfig, and
  // several of them change what is on screen -- the play-count shading
  // introduces itself on first sight, and would otherwise be covering the
  // toolbar in every test that never asked about it. Seeded per test so a test
  // about first-run behaviour can ask for the unseeded version.
  settings: [{ 'jean.heatIntroSeen': true }, { option: true }],

  // The app animates deliberately and without stopping: the play/pause toggle
  // layers scale and rotate on coprime durations for as long as something is
  // playing. Neither moves it, but both change its bounding box every frame,
  // and Playwright waits for a box that holds still across two frames before
  // it will click. Against a permanently moving target that wait can only time
  // out -- so the suite asks for the preference the app already honours in
  // tokens.css rather than forcing clicks past the checks that catch genuinely
  // unclickable elements.
  //
  // The cost is that these tests say nothing about the motion itself. A spec
  // that wants to assert on it opts out with test.use({ motion: 'allow' }).
  motion: ['reduce', { option: true }],

  page: async ({ page, settings, player, motion }, use) => {
    void player
    if (motion === 'reduce') await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript((values) => {
      for (const [key, value] of Object.entries(values)) {
        window.localStorage.setItem(key, JSON.stringify(value))
      }
    }, settings)
    await use(page)
  },
})

export { expect }

// The row the virtualiser has mounted for a given position in the view. Rows
// carry data-row, which is their index in the view rather than in the playlist
// -- the two differ the moment anything is filtered.
export const trackRow = (page, index) => page.locator(`[role="row"][data-row="${index}"]`)

export const rowByTitle = (page, title) =>
  page.locator('[role="row"]').filter({ hasText: title }).first()

// Whether a row is actually on screen, which is not the same question as
// whether it rendered: overscan deliberately mounts rows past the fold, and an
// album group is tall enough that its rows can be mounted while sitting well
// below the viewport. Measured against the scroll container, the same way
// TrackList decides which way the "Now playing" pill points.
//
// The tolerance is not slack, it is the unit the browser works in. Row heights,
// the scroll offset and the container's own rect are all fractional, so a row
// scrolled exactly to the bottom edge lands a few tenths of a pixel past it.
// Asserting exact containment fails on geometry nobody can see.
const EDGE_TOLERANCE_PX = 1

export const isRowOnScreen = (page, index) =>
  page.evaluate(
    ({ row, slack }) => {
      const element = document.querySelector(`[role="row"][data-row="${row}"]`)
      if (!element) return false
      const scroller = document.querySelector('main')
      const seen = element.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      return seen.top >= view.top - slack && seen.bottom <= view.bottom + slack
    },
    { row: index, slack: EDGE_TOLERANCE_PX },
  )

// The virtualiser only mounts what is near the viewport, so a row further down
// a playlist does not exist to be located until the list has been scrolled to
// it. A screenful at a time rather than a jump to the end: the row wanted is as
// often in the middle as at the bottom, and in album mode the total height is an
// estimate until the groups have been measured, so any single jump is aimed at
// the wrong place anyway.
export const scrollUntilMounted = async (page, locator) => {
  // Wait for the view before scrolling it. Without this the poll below starts
  // against an empty list, scrolls a container with nothing in it to scroll,
  // and spends its whole budget before the rows have even arrived -- which is
  // why it failed only in a full parallel run and never on its own.
  await expect(page.locator('[role="row"]').first()).toBeAttached()

  await expect
    .poll(async () => {
      if (await locator.count()) return true
      await page.evaluate(() => {
        const scroller = document.querySelector('main')
        scroller.scrollBy(0, scroller.clientHeight * 0.8)
      })
      return false
    })
    .toBe(true)
  await expect(locator).toBeAttached()
}

export const scrollTop = (page) => page.evaluate(() => document.querySelector('main').scrollTop)

export const scrollTo = (page, offset) =>
  page.evaluate((to) => document.querySelector('main').scrollTo(0, to), offset)

// What the app sent, so a test can assert on the wire rather than only on the
// screen. Reads the fake's own log, not the browser's.
export const requestsTo = (player, pattern) =>
  player.requests.filter((entry) => entry.path.includes(pattern))
