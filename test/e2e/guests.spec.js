import { expect, rowByTitle, scrollUntilMounted, test } from './fixtures.js'

// Jar Of Flies, retagged. The captured library has no featured artist on it and
// no compilation, and both are what an album row has to tell apart.
//
// 'No Excuses' and "Don't Follow" are the pair worth having: the same two words,
// 'Mad Season', rendered two different ways because on one of them it is the
// album artist plus a guest and on the other it is somebody else.
const ALBUM_ARTIST = 'Alice in Chains'

const GUESTS = 'Nutshell'
const JOINED_BY_COMMA = 'No Excuses'
const SOMEONE_ELSE = "Don't Follow"

const RETAGGED = {
  [GUESTS]: { '%artist%': `${ALBUM_ARTIST} feat. Ozzy Osbourne & Travis Scott` },
  [JOINED_BY_COMMA]: { '%artist%': `${ALBUM_ARTIST}, Mad Season` },
  [SOMEONE_ELSE]: { '%artist%': 'Mad Season' },
}

// The names cell says which shape it took: one line with the guests beside the
// title, or two with the artist under it.
const names = (row) => row.locator('[data-inline]')
const inlineNames = (row) => row.locator('[data-inline="true"]')

test.describe('guests on an album row', () => {
  test.use({ retagged: RETAGGED, settings: { 'jean.layout': 'album' } })

  test('the guests sit beside the title and the album artist is not repeated', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, GUESTS))

    const row = rowByTitle(page, GUESTS)
    await expect(inlineNames(row)).toContainText('feat. Ozzy Osbourne & Travis Scott')

    // The caption two inches to the left already says Alice in Chains. Saying it
    // again on every other row is the clutter this replaced.
    await expect(names(row)).not.toContainText(ALBUM_ARTIST)
  })

  test('a comma-joined tag loses the comma, not the guest', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, JOINED_BY_COMMA))

    await expect(inlineNames(rowByTitle(page, JOINED_BY_COMMA))).toHaveText(
      `${JOINED_BY_COMMA}Mad Season`,
    )
  })

  test('an artist who is not the album\'s keeps a line of their own', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, SOMEONE_ELSE))

    const row = rowByTitle(page, SOMEONE_ELSE)
    await expect(names(row)).toHaveAttribute('data-inline', 'false')
    await expect(names(row)).toContainText('Mad Season')

    // Same two words as the row above, drawn differently, because there they
    // were something added to the album artist and here they replace them.
    await expect(names(rowByTitle(page, JOINED_BY_COMMA))).toHaveAttribute('data-inline', 'true')
  })

  test('a row with nothing to add says nothing', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, 'Rotten Apple'))

    const row = rowByTitle(page, 'Rotten Apple')
    await expect(names(row)).toHaveAttribute('data-inline', 'false')
    await expect(names(row)).toHaveText('Rotten Apple')
  })

  test('the title truncates last', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, GUESTS))

    // A short title against a long guest list. Sharing the shrink between them
    // is the obvious flexbox default and it is wrong: it cut 'Nutshell' to
    // 'Nuts...' on a phone while drawing most of the guests. The title is the
    // row's identity, so the guests are what gives.
    const title = inlineNames(rowByTitle(page, GUESTS)).locator('span').first()
    await expect(title).toHaveText(GUESTS)

    const whole = await title.evaluate((element) => element.scrollWidth <= element.clientWidth)
    expect(whole).toBe(true)
  })
})

// Outside a group there is no caption naming the album artist, so the row is the
// only thing that can, and it says the artist in full on its own line -- which
// is what it did before any of this and must keep doing.
test.describe('the same track in the list layout', () => {
  test.use({
    retagged: RETAGGED,
    settings: { 'jean.layout': 'compact' },
  })

  test('the artist is stated in full, under the title', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, GUESTS))

    const row = rowByTitle(page, GUESTS)
    await expect(names(row)).toHaveAttribute('data-inline', 'false')
    await expect(names(row)).toContainText(`${ALBUM_ARTIST} feat. Ozzy Osbourne & Travis Scott`)
  })

  test('the album group is the only place a row is told about its album', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, SOMEONE_ELSE))

    await expect(names(rowByTitle(page, SOMEONE_ELSE))).toContainText('Mad Season')
    await expect(page.locator('[data-inline="true"]')).toHaveCount(0)
  })
})

// A compilation gives every row a second line, and two lines of type in an album
// row that was sized for one left the text of one row all but touching the next.
// Measured rather than looked at, because it is
// half a pixel, and it reads as "cluttered" rather than as anything nameable.
test.describe('an album row with two lines has room for them', () => {
  test.use({
    retagged: { [SOMEONE_ELSE]: { '%artist%': 'Mad Season' } },
    settings: { 'jean.layout': 'album' },
  })

  test('it grows rather than crushing the two lines together', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, SOMEONE_ELSE))

    const slack = await rowByTitle(page, SOMEONE_ELSE).evaluate((row) => {
      const cell = row.querySelector('[data-inline]')
      return row.getBoundingClientRect().height - cell.getBoundingClientRect().height
    })
    expect(slack).toBeGreaterThanOrEqual(6)

    // And a one-line row is left exactly where it was: 34px, so an album of
    // them keeps the rhythm the grown row is the exception to.
    const single = await rowByTitle(page, 'Rotten Apple').evaluate(
      (row) => row.getBoundingClientRect().height,
    )
    expect(single).toBe(34)
  })
})
