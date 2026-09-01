import { expect, requestsTo, test, trackRow } from './fixtures.js'

// The first three tracks of the Library fixture, which is Jessico in playlist
// order. Named here rather than inline so a recapture that reorders the album
// breaks in one place.
const THIRD_TRACK = { title: 'Deléctrico', artist: 'Babasónicos', index: 2 }

const statusBar = (page) => page.locator('footer')

// Both layouts. Album mode renders its rows through AlbumGroup rather than
// TrackList directly -- the same file the per-row play handler was removed from
// when tap-to-play moved onto the container -- so the one path these gestures
// were changed for is the one they were never tested on.
for (const layout of ['compact', 'album']) {
test.describe(`playing a track (${layout} layout)`, () => {
  test.use({ settings: { 'jean.heatIntroSeen': true, 'jean.layout': layout } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/p7')
    // Opening with no hash lands on whichever playlist the player is on, so
    // this also asserts that isCurrent is what decides.
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    await expect(statusBar(page)).toContainText('Nothing playing')
  })

  test('double-clicking a row plays that track', async ({ page, player }) => {
    // Skipped rather than rewritten for touch: there is no touch equivalent
    // yet. See the fixme at the bottom of this file.
    test.skip(test.info().project.name === 'mobile', 'double-click is a pointer gesture')

    const row = trackRow(page, THIRD_TRACK.index)
    await expect(row).toContainText(THIRD_TRACK.title)

    await row.dblclick()

    // What went over the wire. Index is identity in this API, so the assertion
    // is on the exact path -- an off-by-one here plays the wrong song, and
    // looks fine on screen because the row would still light up.
    await expect
      .poll(() => requestsTo(player, '/player/play/').map((entry) => entry.path))
      .toEqual([`/api/player/play/p7/${THIRD_TRACK.index}`])

    // And what came back. Nothing below is written by the click: the app
    // learns it played from the SSE snapshot the fake pushes afterwards, so
    // this is the whole round trip rather than an optimistic update.
    await expect(statusBar(page)).toContainText(THIRD_TRACK.title)
    await expect(statusBar(page)).toContainText(THIRD_TRACK.artist)
    await expect(statusBar(page).getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute('data-active', 'true')
    // The equalizer replaces the track number in the active row, and is the
    // only thing on the page labelled this way -- so exactly one row carries
    // it, and it is that one.
    await expect(page.getByLabel('Now playing')).toHaveCount(1)
    await expect(trackRow(page, THIRD_TRACK.index).getByLabel('Now playing')).toBeVisible()
  })

  test('Enter plays the track the cursor is on', async ({ page, player }) => {
    test.skip(test.info().project.name === 'mobile', 'no keyboard on the phone')

    // Arrow keys move a cursor held in state rather than DOM focus, because the
    // virtualiser unmounts the focused row the moment it scrolls away. It
    // starts on the first row rather than nowhere, so one press is row 1.
    await expect(trackRow(page, 0)).toHaveAttribute('data-cursor', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(trackRow(page, 1)).toHaveAttribute('data-cursor', 'true')

    await page.keyboard.press('Enter')

    await expect
      .poll(() => requestsTo(player, '/player/play/').map((entry) => entry.path))
      .toEqual(['/api/player/play/p7/1'])
    await expect(statusBar(page)).toContainText('Fizz')
  })

  test('the header Play button starts the playlist from the top', async ({ page, player }) => {
    // The one play path that exists on both surfaces, so this is also the
    // mobile coverage for playback reaching the status bar.
    await page.getByRole('main').getByRole('button', { name: 'Play', exact: true }).click()

    await expect
      .poll(() => requestsTo(player, '/player/play/').map((entry) => entry.path))
      .toEqual(['/api/player/play/p7/0'])
    await expect(statusBar(page)).toContainText('Los Calientes')
  })

  test('pausing from the status bar leaves the track where it is', async ({ page, player }) => {
    await page.getByRole('main').getByRole('button', { name: 'Play', exact: true }).click()
    await expect(statusBar(page).getByRole('button', { name: 'Pause' })).toBeVisible()

    await statusBar(page).getByRole('button', { name: 'Pause' }).click()

    await expect(statusBar(page).getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(statusBar(page)).toContainText('Los Calientes')
    await expect.poll(() => player.player.playbackState).toBe('paused')
  })
})

test.describe(`playing on touch (${layout} layout)`, () => {
  test.skip(({ isMobile }) => !isMobile, 'these are touch gestures')
  test.use({ settings: { 'jean.heatIntroSeen': true, 'jean.layout': layout } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/p7')
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  })

  test('a tap plays the track', async ({ page, player }) => {
    await trackRow(page, THIRD_TRACK.index).tap()

    await expect
      .poll(() => requestsTo(player, '/player/play/').map((entry) => entry.path))
      .toEqual([`/api/player/play/p7/${THIRD_TRACK.index}`])
    await expect(statusBar(page)).toContainText(THIRD_TRACK.title)
    await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute('data-active', 'true')
  })

  test('a press-and-hold opens the menu and plays nothing', async ({ page, player }) => {
    // The whole gesture, echo included. A hold ends in a synthetic click that
    // useLongPress swallows in its capture phase; if it ever stops doing that,
    // every long press also starts a track. Dispatched rather than driven by
    // page.touchscreen, which has no way to hold.
    const row = trackRow(page, THIRD_TRACK.index)
    const touch = { pointerType: 'touch', isPrimary: true, button: 0, clientX: 120, clientY: 300 }

    await row.dispatchEvent('pointerdown', touch)
    await page.waitForTimeout(520) // past the 420ms hold
    await row.dispatchEvent('pointerup', touch)
    await row.dispatchEvent('click', { ...touch, detail: 1 })

    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(150)
    expect(requestsTo(player, '/player/play/')).toEqual([])
  })
})

test(`on a pointer, a single click selects and does not play (${layout} layout)`, async ({
  page,
  player,
}) => {
  // The other half of the same gate. Tap-to-play is decided by pointerType, so
  // a regression there does not break the phone -- it silently turns every
  // desktop click into playback, which nothing else here would catch.
  test.skip(test.info().project.name === 'mobile', 'this is the mouse path')

  await page.goto('/#/p7')
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()

  await trackRow(page, THIRD_TRACK.index).click()

  await expect(trackRow(page, THIRD_TRACK.index)).toHaveAttribute('data-selected', 'true')
  await page.waitForTimeout(150)
  expect(requestsTo(player, '/player/play/')).toEqual([])
  await expect(statusBar(page)).toContainText('Nothing playing')
})
}
