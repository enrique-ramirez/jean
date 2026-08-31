import { expect, requestsTo, scrollTo, scrollTop, test, trackRow } from './fixtures.js'

// The ways around the app that had no coverage: the palette, the first-run
// library screen, and the view memory that decides where you land when you come
// back to a list you had scrolled.

const palette = (page) => page.getByRole('dialog', { name: 'Go to playlist' })
const paletteField = (page) => page.getByRole('textbox', { name: 'Go to playlist' })
const results = (page) => palette(page).getByRole('option')

const openLibrary = async (page) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(trackRow(page, 0)).toBeAttached()
}

test.describe('the command palette', () => {
  test.skip(({ isMobile }) => isMobile, 'it is opened and driven entirely by keys')

  test.beforeEach(async ({ page }) => {
    await openLibrary(page)
    await page.keyboard.press('ControlOrMeta+Shift+p')
    await expect(palette(page)).toBeVisible()
  })

  test('it opens with the field ready and every playlist listed', async ({ page }) => {
    await expect(paletteField(page)).toBeFocused()
    await expect(results(page)).toHaveCount(4)
    await expect(results(page).first()).toHaveAttribute('aria-selected', 'true')
  })

  test('typing narrows it and Enter goes there', async ({ page }) => {
    await paletteField(page).fill('fav')
    await expect(results(page)).toHaveCount(1)

    await page.keyboard.press('Enter')

    await expect(palette(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Favorites' })).toBeVisible()
  })

  test('the arrows move the choice and Enter takes it', async ({ page }) => {
    await page.keyboard.press('ArrowDown')
    await expect(results(page).nth(1)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  })

  test('clicking a result goes there too', async ({ page }) => {
    await results(page).filter({ hasText: 'Rock en Español' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Rock en Español' })).toBeVisible()
  })

  // Nothing here types an accent on purpose. The palette filters with a plain
  // toLowerCase().includes(), so 'espanol' does NOT find 'Rock en Español' --
  // which is the one rule CLAUDE.md states about anything typed at a list, and
  // the reason fold() exists in ui/text.js. The finder folds, the library
  // search folds, ActionMenu's own filter folds; this one does not. Asserting
  // the current behaviour would make it look intended, so this note stands in
  // for the test until the palette goes through fold() too.
  test('it says so when nothing matches, rather than showing an empty box', async ({ page }) => {
    await paletteField(page).fill('zzzz')
    await expect(results(page)).toHaveCount(0)
    await expect(palette(page)).toContainText('No playlist matches that.')
  })

  test('Escape closes it and changes nothing', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(palette(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  })
})

// beefweb has no library API, so "the library" is whichever playlist the user
// points Jean at. On an install that has none by that name, the first thing
// search can do is explain how to make one.
test.describe('the first run, with no library playlist', () => {
  // Both, and the pairing is the point: the setup screen exists only for a
  // player with no media library API *and* no autoplaylist to fall back on.
  // Give it the API and there is nothing to set up, which is the whole reason
  // the API is worth having.
  test.use({ withoutLibraryPlaylist: true, library: { supported: false } })

  test('it explains the autoplaylist rather than showing an empty result set', async ({ page }) => {
    await page.goto('/#/search')

    await expect(page.getByRole('heading', { level: 1, name: /Point Jean at your library/ })).toBeVisible()
    await expect(page.getByText('ALL')).toBeVisible()

    // The promise that makes the instruction safe to follow.
    await expect(page.getByText('Nothing here creates, clears or reorders a playlist.')).toBeVisible()
  })

  test('the scratch buffer is offered with a warning on it', async ({ page }) => {
    await page.goto('/#/search')

    // Default Playlist is foobar's scratch buffer -- selecting an album in its
    // library view replaces the whole thing, measured at 30,441 items and 12 an
    // hour later. It is listed, because it is the user's to choose, and it is
    // labelled, because choosing it silently would be the trap.
    const scratch = page.getByRole('listitem').filter({ hasText: 'Default Playlist' })
    await expect(scratch).toBeVisible()
    await expect(scratch).toContainText('foobar clears this one')
  })

  test('picking a playlist gets you searching, and it sticks', async ({ page, player }) => {
    await page.goto('/#/search')
    await page.getByRole('listitem').filter({ hasText: 'Everything' }).click()

    await page.getByLabel('Search your library').fill('babasonicos')
    await expect(page.getByRole('heading', { level: 1, name: 'babasonicos' })).toBeVisible()
    await expect(trackRow(page, 0)).toBeAttached()

    // Nothing was written to get here -- the pick is Jean's own setting.
    expect(requestsTo(player, '/playlists/add')).toHaveLength(0)

    await page.reload()
    await page.getByLabel('Search your library').fill('babasonicos')
    await expect(page.getByRole('heading', { level: 1, name: 'babasonicos' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Point Jean at your library/ })).toHaveCount(0)
  })
})

test.describe('where a view puts you when you come back to it', () => {
  test('a playlist remembers where it was left', async ({ page }) => {
    await openLibrary(page)
    await scrollTo(page, 900)
    await expect.poll(() => scrollTop(page)).toBe(900)

    const sidebar = page.getByRole('navigation', { name: 'Playlists' })
    if (!(await sidebar.isVisible())) {
      await page.getByRole('button', { name: 'Show playlists' }).click()
    }
    await sidebar.getByRole('button').filter({ hasText: 'Favorites' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Favorites' })).toBeVisible()

    // A different view starts at the top rather than inheriting the offset.
    await expect.poll(() => scrollTop(page)).toBe(0)

    if (!(await sidebar.isVisible())) {
      await page.getByRole('button', { name: 'Show playlists' }).click()
    }
    await sidebar.getByRole('button').filter({ hasText: 'Library' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()

    // Rows arrive a chunk at a time, so the content is often too short to hold
    // the offset at the moment the view comes back -- the restore keeps trying
    // for about a second rather than giving up on the first frame.
    await expect.poll(() => scrollTop(page)).toBe(900)
  })
})
