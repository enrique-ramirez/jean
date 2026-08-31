import { expect, requestsTo, test, trackRow } from './fixtures.js'

// Every optional column is fetched whether or not it is shown, so toggling one
// is a layout change and nothing else. That is the claim this file is here to
// hold: instant, no round trip, and the grid still lines up afterwards.

const LEADING = 3 // the number, the artwork, the names cell

const menu = (page) => page.getByRole('button', { name: 'View options' })
const option = (page, name) => page.getByRole('menuitemcheckbox', { name })

const openLibrary = async (page) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(trackRow(page, 0)).toBeAttached()
}

// Closed by clicking away rather than with Escape, which does not close this
// menu at all. Found while writing this file and left unfixed here on purpose:
// while the dropdown is open, Escape reaches the app behind it and clears the
// track selection instead. `useDismissable` listens on document in the bubble
// phase and the hotkey manager gets there first. ActionMenu takes the key from
// the app while it is open; ui/Menu.jsx does not. Enshrining that in an
// assertion would make the bug harder to fix, so there is no test for it --
// only this note and a helper that works around it.
const toggle = async (page, name) => {
  await menu(page).click()
  await option(page, name).click()
  await page.getByRole('heading', { level: 1 }).click()
  await expect(option(page, name)).toHaveCount(0)
}

const cellCount = (page) => trackRow(page, 0).locator(':scope > *').count()

// The invariant behind the whole file, and the shape of the bug it guards: the
// grid template is built from the same list the cells are rendered from, so a
// template with one track too many leaves an empty column and shifts every cell
// after it. Neither count is interesting alone; only that they agree.
const templateMatchesCells = (page) =>
  trackRow(page, 0).evaluate((row) => {
    const tracks = getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length
    return { tracks, cells: row.children.length }
  })

const itemFetches = (player) =>
  requestsTo(player, '/items/').filter((entry) => entry.method === 'GET').length

// Desktop only: a phone caps the count at two, so turning on a fourth column
// there correctly changes nothing on screen. The cap has its own block below.
test.describe('showing and hiding columns', () => {
  test.skip(({ isMobile }) => isMobile, 'the compact viewport caps the count; see below')
  test.beforeEach(({ page }) => openLibrary(page))

  test('turning one on adds its cell and asks the player for nothing', async ({ page, player }) => {
    const before = await cellCount(page)
    const fetches = itemFetches(player)

    await toggle(page, 'Year')

    await expect.poll(() => cellCount(page)).toBe(before + 1)
    // Jessico is 2001, so the cell that appeared is carrying the year rather
    // than being an empty column that happens to be the right width.
    await expect(trackRow(page, 0)).toContainText('2001')

    // The reason every field is fetched regardless of what is displayed: a
    // toggle that cost a round trip would make the menu feel broken.
    await page.waitForTimeout(300)
    expect(itemFetches(player)).toBe(fetches)
  })

  test('turning one off takes the cell with it', async ({ page }) => {
    await expect(trackRow(page, 0)).toContainText('4:37') // Los Calientes, the duration column
    const before = await cellCount(page)

    await toggle(page, 'Time')

    await expect.poll(() => cellCount(page)).toBe(before - 1)
    await expect(trackRow(page, 0)).not.toContainText('4:37')
  })

  test('the grid keeps one track per cell however many are on', async ({ page }) => {
    expect(await templateMatchesCells(page)).toEqual(
      expect.objectContaining({ tracks: await cellCount(page) }),
    )

    for (const name of ['Year', 'Genre', 'Codec']) {
      await toggle(page, name)
      const measured = await templateMatchesCells(page)
      expect(measured.tracks, `after turning on ${name}`).toBe(measured.cells)
    }

    // And with the artwork track removed, which is the case that first got this
    // wrong: album rows sit beside a cover and carry no artwork cell, so a
    // template built for one leaves a hole.
    await toggle(page, 'Artwork')
    const bare = await templateMatchesCells(page)
    expect(bare.tracks).toBe(bare.cells)

  })
})

test.describe('the artwork toggle', () => {
  test.beforeEach(({ page }) => openLibrary(page))

  test('it removes the image and the column it sat in', async ({ page }) => {
    await expect(trackRow(page, 0).locator('img')).toHaveCount(1)
    const before = await cellCount(page)

    await toggle(page, 'Artwork')

    await expect(trackRow(page, 0).locator('img')).toHaveCount(0)
    await expect.poll(() => cellCount(page)).toBe(before - 1)
  })
})

test.describe('a field the player cannot resolve', () => {
  // No playback-statistics component, so %lastfm_play_count% comes back '?' on
  // every row exactly as it would on a real install.
  test.use({ withoutFields: ['%lastfm_play_count%'] })

  test('it is offered as unavailable rather than quietly dropped', async ({ page }) => {
    await openLibrary(page)
    await menu(page).click()

    // Named, so someone looking for the column learns it needs a component --
    // rather than finding an entry missing and wondering whether Jean forgot.
    const plays = option(page, 'Plays (not available)')
    await expect(plays).toBeVisible()
    await expect(plays).toBeDisabled()
  })

  test('it is not counted as a shown column even though it is enabled', async ({ page }) => {
    await openLibrary(page)

    // 'playCount' is in the stored defaults, so this is the case where the
    // setting and the player disagree: the setting says show it, the player
    // cannot supply it, and the row must not gain an empty column for it.
    const measured = await templateMatchesCells(page)
    expect(measured.tracks).toBe(measured.cells)
    expect(measured.cells).toBe(LEADING + 2) // Time and Rating, not Plays
  })
})

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the cap only exists on the compact viewport')

  test('it shows at most two columns however many are turned on', async ({ page }) => {
    await openLibrary(page)

    await menu(page).click()
    for (const name of ['Album', 'Year', 'Genre', 'Codec', 'Rate', 'Last played']) {
      await option(page, name).click()
    }
    await page.keyboard.press('Escape')

    // Every fixed column comes straight out of the title, and once the fixed
    // widths exceed the viewport the flexible names cell collapses to nothing.
    // So the compact layout caps the count rather than trusting the grid.
    const measured = await templateMatchesCells(page)
    expect(measured.cells - LEADING).toBeLessThanOrEqual(2)
    expect(measured.tracks).toBe(measured.cells)
  })
})

test.describe('the settings follow you', () => {
  test.skip(({ isMobile }) => isMobile, 'a fourth column is not shown on a phone to begin with')

  test('a reload comes back to the columns you chose', async ({ page }) => {
    await openLibrary(page)

    await toggle(page, 'Year')
    await toggle(page, 'Artwork')
    await expect(trackRow(page, 0)).toContainText('2001')

    await page.reload()
    await expect(trackRow(page, 0)).toBeAttached()

    await expect(trackRow(page, 0)).toContainText('2001')
    await expect(trackRow(page, 0).locator('img')).toHaveCount(0)

    // The menu agrees with the rows, rather than each remembering separately.
    await menu(page).click()
    await expect(option(page, 'Year')).toHaveAttribute('aria-checked', 'true')
    await expect(option(page, 'Artwork')).toHaveAttribute('aria-checked', 'false')
  })
})
