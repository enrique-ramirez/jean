import { expect, requestsTo, test } from './fixtures.js'

// Counts verified against the captured library rather than guessed. Jessico is
// twelve Babasónicos tracks at the top of the list, Lafcadio eleven further
// down -- so a query can match a block that is entirely off screen, which is
// the case that matters for a finder that does not filter.
const ACCENTED = { query: 'babasonicos', matches: 12, firstTitle: 'Los Calientes' }
const ONE_HIT = { query: 'delectrico', row: 2, title: 'Deléctrico' }
const OFF_SCREEN = { query: 'lafcadio', matches: 11, firstRow: 30 }

const finder = (page) => page.getByRole('textbox', { name: 'Find in this playlist' })
const results = (page) => page.getByRole('listbox').getByRole('option')
const matchedRows = (page) => page.locator('[role="row"][data-match="true"]')

const openLibrary = async (page) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
}

const openFinder = async (page) => {
  await page.getByRole('button', { name: /Find in playlist/ }).click()
  await expect(finder(page)).toBeVisible()
}

test.describe('opening the finder', () => {
  test.beforeEach(({ page }) => openLibrary(page))

  test('the button opens it with the field already focused', async ({ page }) => {
    await openFinder(page)

    // Opening a search you then have to click into is a search you did not
    // really open.
    await expect(finder(page)).toBeFocused()
  })

  test('the first result is the active one, wherever the pointer is', async ({ page }) => {
    // The results render exactly where the button that opened them was, so the
    // pointer is left sitting on top of them without having gone anywhere. A
    // mouseenter earned that way used to hand the active result to whatever
    // landed under the cursor -- measured, the fifth -- and Enter then plays
    // that instead of the first match.
    await openFinder(page)
    await finder(page).fill(OFF_SCREEN.query)
    await expect(results(page)).toHaveCount(OFF_SCREEN.matches)

    await expect(results(page).first()).toHaveAttribute('aria-selected', 'true')

    // And the same again for a second query typed under the same still pointer.
    await finder(page).fill(ACCENTED.query)
    await expect(results(page)).toHaveCount(ACCENTED.matches)
    await expect(results(page).first()).toHaveAttribute('aria-selected', 'true')
  })

  test('hovering a result still selects it, once the pointer really moves', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'nothing hovers on a phone')

    await openFinder(page)
    await finder(page).fill(OFF_SCREEN.query)
    await expect(results(page)).toHaveCount(OFF_SCREEN.matches)

    const target = results(page).nth(6)
    const box = await target.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    await expect(target).toHaveAttribute('aria-selected', 'true')
  })

  test('/ opens it too', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'no keyboard on the phone')

    await page.keyboard.press('/')

    await expect(finder(page)).toBeVisible()
    await expect(finder(page)).toBeFocused()
    // And the key that opened it is not left in the field.
    await expect(finder(page)).toHaveValue('')
  })
})

test.describe('finding', () => {
  test.beforeEach(async ({ page }) => {
    await openLibrary(page)
    await openFinder(page)
  })

  test('finds without filtering the playlist', async ({ page }) => {
    // The whole design decision in one assertion: the playlist keeps every
    // track and its order, and matching only marks rows. A finder that filtered
    // would change what the playlist *is*, and the count below would drop.
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '54')

    await finder(page).fill(ACCENTED.query)

    await expect(results(page)).toHaveCount(ACCENTED.matches)
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '54')
    await expect(matchedRows(page).first()).toBeVisible()
  })

  test('matches through the accents, not around them', async ({ page }) => {
    // Typing the accents in your own library is a tax on exactly the tracks you
    // are most likely to be hunting for, and from outside it does not look
    // strict, it looks broken. Both sides fold, so both spellings work.
    await finder(page).fill(ACCENTED.query)
    await expect(results(page)).toHaveCount(ACCENTED.matches)
    await expect(results(page).first()).toContainText(ACCENTED.firstTitle)

    await finder(page).fill('Babasónicos')
    await expect(results(page)).toHaveCount(ACCENTED.matches)

    await finder(page).fill(ONE_HIT.query)
    await expect(results(page)).toHaveCount(1)
    await expect(results(page).first()).toContainText(ONE_HIT.title)
  })

  test('every token has to appear, in any order', async ({ page }) => {
    // One word from the title, one from the album. Neither row matches on its
    // own field alone, which is the point of tokenising rather than substring
    // matching the whole query.
    await finder(page).fill('jessico calientes')
    await expect(results(page)).toHaveCount(1)
    await expect(results(page).first()).toContainText('Los Calientes')

    await finder(page).fill('calientes jessico')
    await expect(results(page)).toHaveCount(1)
  })

  test('says so when nothing matches', async ({ page }) => {
    await finder(page).fill('zzzznothing')

    await expect(results(page)).toHaveCount(0)
    await expect(page.getByText('Nothing here matches that.')).toBeVisible()
    await expect(matchedRows(page)).toHaveCount(0)
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '54')
  })
})

test.describe('moving through results', () => {
  test.skip(({ isMobile }) => isMobile, 'these are keyboard gestures')

  test.beforeEach(async ({ page }) => {
    await openLibrary(page)
    await openFinder(page)
  })

  test('arrowing previews without playing anything', async ({ page, player }) => {
    // Browsing must never hijack what is playing. Arrowing scrolls the list so
    // each hit is seen in place; only Enter starts a track.
    await finder(page).fill(OFF_SCREEN.query)
    await expect(results(page)).toHaveCount(OFF_SCREEN.matches)

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(results(page).nth(2)).toHaveAttribute('aria-selected', 'true')

    // The preview is debounced, so give it time to be wrong.
    await page.waitForTimeout(400)
    expect(requestsTo(player, '/player/play/')).toEqual([])
    await expect(page.locator('footer')).toContainText('Nothing playing')

    // It did move the list, though: the block being previewed starts well below
    // the fold and the cursor is now inside it.
    await expect(page.locator(`[role="row"][data-cursor="true"]`)).toHaveAttribute(
      'data-row',
      String(OFF_SCREEN.firstRow + 2),
    )
  })

  test('the arrows belong to the finder, not the list behind it', async ({ page }) => {
    await finder(page).fill(OFF_SCREEN.query)
    await expect(results(page)).toHaveCount(OFF_SCREEN.matches)

    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(300)

    // If the playlist's own cursor keys were still live, this would have moved
    // one row down the playlist instead of one result down the finder.
    await expect(results(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[role="row"][data-cursor="true"]')).toHaveAttribute(
      'data-row',
      String(OFF_SCREEN.firstRow + 1),
    )
  })

  test('the list stays suspended even after focus leaves the field', async ({ page }) => {
    // The field being focused is not what protects the list -- bindings already
    // ignore keys typed at an input. What `keysEnabled` covers is the gap after
    // that: click a track and focus leaves the field, but the finder is still
    // open and Escape, Enter and the arrows still belong to it. Without it the
    // list quietly takes its shortcuts back while a search is on screen.
    const flame = page.getByRole('button', { name: 'Show play-count heat' })
    await finder(page).fill(OFF_SCREEN.query)
    await expect(results(page)).toHaveCount(OFF_SCREEN.matches)

    await page.locator('[role="row"]').first().click()
    await expect(finder(page)).toBeVisible()
    await expect(finder(page)).not.toBeFocused()

    await page.keyboard.press('h')
    await expect(flame).toHaveAttribute('aria-pressed', 'true')
  })

  test('letters typed at the field stay in the field', async ({ page }) => {
    // h toggles the play-count shading and v switches the layout -- both single
    // keys, both live in the list behind this. Typing a word with either in it
    // must not reach them.
    const flame = page.getByRole('button', { name: 'Show play-count heat' })
    await expect(flame).toHaveAttribute('aria-pressed', 'true')

    await finder(page).fill('have')

    await expect(finder(page)).toHaveValue('have')
    await expect(flame).toHaveAttribute('aria-pressed', 'true')
    // Still the compact list, not the album view v would have switched to.
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '54')
  })
})

test.describe('leaving the finder', () => {
  test.beforeEach(async ({ page }) => {
    await openLibrary(page)
    await openFinder(page)
  })

  test('Enter plays the active result and closes', async ({ page, player }) => {
    test.skip(test.info().project.name === 'mobile', 'no keyboard on the phone')

    await finder(page).fill(ONE_HIT.query)
    await expect(results(page)).toHaveCount(1)

    await page.keyboard.press('Enter')

    await expect
      .poll(() => requestsTo(player, '/player/play/').map((entry) => entry.path))
      .toEqual([`/api/player/play/p7/${ONE_HIT.row}`])
    await expect(finder(page)).toHaveCount(0)
    await expect(page.locator('footer')).toContainText(ONE_HIT.title)
  })

  test('clicking a result plays it', async ({ page, player }) => {
    await finder(page).fill(ONE_HIT.query)
    await expect(results(page)).toHaveCount(1)

    await results(page).first().click()

    await expect
      .poll(() => requestsTo(player, '/player/play/').map((entry) => entry.path))
      .toEqual([`/api/player/play/p7/${ONE_HIT.row}`])
    await expect(page.locator('footer')).toContainText(ONE_HIT.title)
  })

  test('Escape closes it without playing', async ({ page, player }) => {
    test.skip(test.info().project.name === 'mobile', 'no keyboard on the phone')

    await finder(page).fill(ONE_HIT.query)
    await expect(results(page)).toHaveCount(1)

    await page.keyboard.press('Escape')

    await expect(finder(page)).toHaveCount(0)
    expect(requestsTo(player, '/player/play/')).toEqual([])
    await expect(page.locator('footer')).toContainText('Nothing playing')
  })

  test('closing clears the query and the marks with it', async ({ page }) => {
    await finder(page).fill(ACCENTED.query)
    await expect(matchedRows(page).first()).toBeVisible()

    await page.getByRole('button', { name: 'Close finder' }).click()
    await expect(finder(page)).toHaveCount(0)
    await expect(matchedRows(page)).toHaveCount(0)

    // Reopening starts fresh rather than resuming a search you already left.
    await openFinder(page)
    await expect(finder(page)).toHaveValue('')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })
})

test.describe('at library scale', () => {
  test.use({ librarySize: 30441 })

  test('marks every match but renders only a page of them', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(() => page.getByRole('grid').getAttribute('aria-rowcount'), { timeout: 30000 })
      .toBe('30441')

    await openFinder(page)
    await finder(page).fill('babasonicos')

    // The dropdown is capped -- rendering thousands of buttons for a query that
    // is still being typed is the kind of thing that makes a search feel broken
    // -- while the playlist itself keeps marking every hit, because that is
    // what "finds without filtering" has to mean at this size too.
    await expect(results(page)).toHaveCount(60)
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '30441')
  })
})
