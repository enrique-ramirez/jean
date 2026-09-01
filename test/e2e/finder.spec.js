import { expect, openLibrary, requestsTo, statusBar, test } from './fixtures.js'

// Counts taken from the captured library rather than guessed. Jessico is twelve
// Babasónicos tracks at the top of the list, Lafcadio eleven further down -- so
// a query can match a block that is entirely off screen, which is the case that
// matters for a finder that does not filter.
const ACCENTED = { query: 'babasonicos', matches: 12, firstTitle: 'Los Calientes' }
const ONE_HIT = { query: 'delectrico', row: 2, title: 'Deléctrico' }
const OFF_SCREEN = { query: 'lafcadio', matches: 11, firstRow: 30 }

const finder = (page) => page.getByRole('textbox', { name: 'Find in this playlist' })
const results = (page) => page.getByRole('listbox').getByRole('option')
const matchedRows = (page) => page.locator('[role="row"][data-match="true"]')

const openFinder = async (page) => {
  await page.getByRole('button', { name: /Find in this playlist/ }).click()
  await expect(finder(page)).toBeVisible()
}

// Both layouts: the results dropdown is the same either way, but what it marks
// is rows, and album mode renders those inside groups.
//
// `test.use` goes inside a describe, not beside one. At file scope it applies to
// the whole file however many times it is called, so a loop that wrote it once
// per layout ran every case under whichever layout it wrote last -- and the
// describes named `(compact)` were quietly running in album mode.
;['compact', 'album'].forEach((layout) => {
test.describe(`the finder in ${layout} layout`, () => {
test.use({ settings: { 'jean.layout': layout } })

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
    // mouseenter earned that way handed the active result to whatever landed
    // under the cursor, and Enter then played that instead of the first match.
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

    // Somewhere else first, because that is what a pointer does and what this
    // is asking about. The first enter after the finder opens is rejected by
    // design -- there is no earlier position to compare it against -- so a
    // single synthetic move onto a result proves nothing either way. This test
    // used to get its movement for free: typing previewed the leading match,
    // that scrolled the list, and Chrome dispatches a mousemove at the
    // stationary pointer when content moves under it. Typing no longer scrolls
    // anything, so the move has to be real.
    await page.mouse.move(4, 4)
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
    await expect(statusBar(page)).toContainText('Nothing playing')

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
    await expect(statusBar(page)).toContainText(ONE_HIT.title)
  })

  test('clicking a result plays it', async ({ page, player }) => {
    await finder(page).fill(ONE_HIT.query)
    await expect(results(page)).toHaveCount(1)

    await results(page).first().click()

    await expect
      .poll(() => requestsTo(player, '/player/play/').map((entry) => entry.path))
      .toEqual([`/api/player/play/p7/${ONE_HIT.row}`])
    await expect(statusBar(page)).toContainText(ONE_HIT.title)
  })

  test('Escape closes it without playing', async ({ page, player }) => {
    test.skip(test.info().project.name === 'mobile', 'no keyboard on the phone')

    await finder(page).fill(ONE_HIT.query)
    await expect(results(page)).toHaveCount(1)

    await page.keyboard.press('Escape')

    await expect(finder(page)).toHaveCount(0)
    expect(requestsTo(player, '/player/play/')).toEqual([])
    await expect(statusBar(page)).toContainText('Nothing playing')
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
    await page.goto('/#/p7')
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
})
})

test.describe('the field is one field', () => {

  test('the focus ring goes round the field, not round a box inside it', async ({ page }) => {
    await openLibrary(page)
    await openFinder(page)
    await expect(finder(page)).toBeFocused()

    const rings = await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Find in this playlist"]')
      const ringOf = (element) => {
        const style = getComputedStyle(element)
        return style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth) || 0
      }
      return { input: ringOf(input), field: ringOf(input.parentElement) }
    })

    // The input is chromeless by construction. The global :focus-visible rule
    // drew a second rounded rectangle around it anyway -- a bare `.input` ties
    // with `:focus-visible` on specificity and loses on source order -- so the
    // pill ended up containing a visibly separate box.
    expect(rings.input).toBe(0)
    expect(rings.field).toBeGreaterThan(0)
  })
})

test.describe('typing does not drag the list around', () => {
  test.use({ librarySize: 30441 })

  const scrollTop = (page) => page.locator('main').evaluate((element) => element.scrollTop)

  test('narrowing a query leaves the view where it is', async ({ page }) => {
    await page.goto('/#/p7')
    await expect
      .poll(() => page.getByRole('grid').getAttribute('aria-rowcount'), { timeout: 30000 })
      .toBe('30441')

    await openFinder(page)
    const parked = await scrollTop(page)

    // Every one of these narrows to a different leading match, so the old
    // preview fired on all of them, and each jump was thousands of rows --
    // a full unmount and remount of the virtualised window, plus a scroll of
    // the container the sticky finder is inside. Android's keyboard lost its
    // composition to exactly that, and typed "Guster" came back scrambled.
    await finder(page).pressSequentially('guster', { delay: 60 })
    await page.waitForTimeout(600)

    // You are reading the dropdown while you type, not the list behind it.
    expect(Math.abs((await scrollTop(page)) - parked)).toBeLessThan(24)
  })

})

test.describe('the field has room to type in', () => {

  test('it takes the space the toolbar has, rather than halving it', async ({ page }) => {
    await openLibrary(page)
    await openFinder(page)

    const { gap, width } = await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Find in this playlist"]')
      const field = input.parentElement.getBoundingClientRect()
      const flame = document
        .querySelector('button[aria-label="Show play-count heat"]')
        .getBoundingClientRect()
      return { gap: flame.left - field.right, width: field.width }
    })

    // The field is as wide as it is allowed to be. Which limit binds depends on
    // the viewport: a phone runs out of toolbar, a desktop hits the 400px
    // measure the field caps itself at, and leftover room there is deliberate.
    if (width < 396) {
      // The toolbar's spacer also grows, so the field used to split the free
      // space with it, leaving the field and the button roughly equal --
      // nothing.
      expect(gap).toBeLessThan(40)
    } else {
      expect(width).toBeGreaterThanOrEqual(396)
    }
  })
})

// The finder used to live inside `PlaylistView`, so the two longest lists in
// the app -- All music and a shelf -- did not have one, and a whole library is
// not something anybody scrolls through looking for a record.
test.describe('finding in the library views', () => {
  test.use({ mediaLibrarySize: 4000 })

  // The button and the field it opens have to say the same thing. They did not:
  // the button was named for the list and the field said "Find in this
  // playlist" on a view that is not one.
  const field = (page, name) => page.getByRole('textbox', { name })

  test('All music has one, named for what it searches', async ({ page }) => {
    await page.goto('/#/all')
    await expect(page.getByRole('heading', { level: 1, name: 'All music' })).toBeVisible()

    // Named for the list, not for "a playlist": All music is not one, and the
    // label is what separates this from the library search above it.
    await page.getByRole('button', { name: /Find in all music/ }).click()
    await expect(field(page, 'Find in all music')).toBeFocused()

    await field(page, 'Find in all music').fill('nutshell')
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible()

    // Found, not filtered: every row the view had is still there.
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '4000')

    // And arrowing walks the list to a match rather than pulling matches out of
    // it -- which is the whole difference between this and the library search.
    // Asserted after moving, because a match in a 4,000-row list is very
    // probably nowhere near the rows currently mounted.
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('[role="row"][data-match="true"]').first()).toBeVisible()
  })

  test('a shelf has one too', async ({ page }) => {
    await page.goto('/#/shelf/recent')
    await expect(page.getByRole('heading', { level: 1, name: 'Recently played' })).toBeVisible()
    await page.getByRole('button', { name: /Find in this shelf/ }).click()
    await expect(field(page, 'Find in this shelf')).toBeFocused()
  })

  test('`/` opens it, and typing into it does not reach the player', async ({ page, player }) => {
    await page.goto('/#/all')
    await expect(page.getByRole('heading', { level: 1, name: 'All music' })).toBeVisible()
    await page.locator('[role="row"]').first().click()

    await page.keyboard.press('/')
    await expect(field(page, 'Find in all music')).toBeFocused()

    // The list stops answering to the keyboard while a field holds it, or
    // typing a track name seeks and pauses the player mid-word.
    await field(page, 'Find in all music').fill('nutshell')
    await page.keyboard.press('ArrowRight')
    expect(requestsTo(player, '/player')).toHaveLength(0)
  })

  test('a result plays the track it names', async ({ page, player }) => {
    await page.goto('/#/all')
    await expect(page.getByRole('heading', { level: 1, name: 'All music' })).toBeVisible()
    await page.getByRole('button', { name: /Find in all music/ }).click()
    await field(page, 'Find in all music').fill('nutshell')

    const first = page.getByRole('listbox').getByRole('option').first()
    const wanted = await first.innerText()
    await first.click()

    await expect.poll(() => requestsTo(player, '/player/play/').length).toBe(1)
    const play = requestsTo(player, '/player/play/').at(-1)
    const [, , , , plref, index] = play.path.split('/')
    const playlist = player.playlists.find((entry) => entry.id === plref)
    expect(wanted).toContain(playlist.items[Number(index)]['%title%'])
  })
})
