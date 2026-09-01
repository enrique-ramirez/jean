import { expect, rowByTitle, scrollUntilMounted, test } from './fixtures.js'

// Deathconsciousness is the fixture's two-disc album and the last one in the
// Library, which is why everything here scrolls to the end first. Both discs
// number their tracks from 01, so a track number alone cannot tell them apart
// -- that is the whole reason either half of this feature exists.
const DISC_ONE = 'A Quick One Before The Eternal Worm Devours Connecticut'
const DISC_TWO = 'Waiting For Black Metal Records To Come In The Mail'

// Jar Of Flies is one disc, so it must look exactly as it did before.
const SINGLE_DISC_ALBUM = 'Jar Of Flies'
const SINGLE_DISC_TRACK = 'Nutshell'

const trackNumberOf = (row) => row.locator(':scope > span').first()

const heading = (page, name) => page.getByRole('heading', { level: 3, name })

test.describe('a multi-disc album in the album layout', () => {
  test.use({ settings: { 'jean.layout': 'album' } })

  test('the discs are headed inside one album, not split into two', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, DISC_TWO))

    await expect(heading(page, 'Disc 1')).toBeVisible()
    await expect(heading(page, 'Disc 2')).toBeVisible()

    // One cover and one caption. Two headings inside a group is the point --
    // two groups would be the bug, and both look the same from a distance.
    const album = page.locator('section').filter({ hasText: 'Deathconsciousness' })
    await expect(album).toHaveCount(1)
    await expect(album.getByRole('heading', { level: 3 })).toHaveCount(2)
  })

  test('the numbers stay bare, because the heading already said it', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, DISC_TWO))

    await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText('01')
  })

  test('an ordinary album is not headed at all', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, SINGLE_DISC_TRACK))

    const album = page.locator('section').filter({ hasText: SINGLE_DISC_ALBUM })
    await expect(album).toHaveCount(1)
    await expect(album.getByRole('heading', { level: 3 })).toHaveCount(0)
  })
})

test.describe('a multi-disc album in the list layout', () => {
  test.use({ settings: { 'jean.layout': 'compact' } })

  test('the track number carries the disc, since nothing else can', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, DISC_TWO))

    await expect(trackNumberOf(rowByTitle(page, DISC_ONE))).toHaveText('1.01')
    await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText('2.01')
  })

  test('the number fits its column rather than running into what follows', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, DISC_ONE))

    // Four characters where the column was drawn for two. Overflow here is
    // invisible in a screenshot on a wide window and lands on the artwork on a
    // phone, so it is measured rather than looked at.
    const fits = await rowByTitle(page, DISC_ONE).evaluate((row) => {
      const cell = row.firstElementChild
      return cell.scrollWidth <= cell.clientWidth
    })
    expect(fits).toBe(true)
  })

  test('a single-disc album keeps a plain number', async ({ page }) => {
    await page.goto('/#/p7')
    await scrollUntilMounted(page, rowByTitle(page, SINGLE_DISC_TRACK))

    await expect(trackNumberOf(rowByTitle(page, SINGLE_DISC_TRACK))).toHaveText('02')
  })
})

// %discnumber% is a tag like any other, and a library that never wrote it is
// the ordinary case rather than a broken one. Nothing may appear when it is
// absent -- not a heading, not a '?.01' where a number used to be.
;['compact', 'album'].forEach((layout) => {
  test.describe(`a library with no disc tags (${layout})`, () => {
    test.use({
      withoutFields: ['%discnumber%'],
      settings: { 'jean.layout': layout },
    })

    test('nothing is drawn for a disc that was never tagged', async ({ page }) => {
      await page.goto('/#/p7')
      await scrollUntilMounted(page, rowByTitle(page, DISC_TWO))

      await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)
      await expect(trackNumberOf(rowByTitle(page, DISC_TWO))).toHaveText('01')
    })
  })
})
