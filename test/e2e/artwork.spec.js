import { expect, requestsTo, scrollTop, test } from './fixtures.js'

// Far enough down a library-sized playlist that getting there crosses thousands
// of rows. The view has never been near it, so nothing about these covers is
// already known.
const FAR = 25000

// The covers on screen when the list stops moving, which is the number every
// assertion here is really about.
const settle = async (page) => {
  await page.waitForTimeout(1500)
  return page.locator('main [role="row"]').count()
}

test.describe('artwork loading', () => {
  test.use({ librarySize: 30441, motion: 'allow' })

  test('a jump across the library asks for the covers it lands on, not the ones it passes', async ({
    page,
    player,
  }) => {
    await page.goto('/#/p7')
    await expect(page.locator('[role="row"]').first()).toBeAttached()
    // Let the first screenful arrive, so what follows measures the jump rather
    // than the load.
    await expect.poll(() => requestsTo(player, 'artwork').length).toBeGreaterThan(0)
    await page.waitForTimeout(500)
    player.requests.length = 0

    // Following playback flies the list there, mounting and unmounting every row
    // in between. Native lazy loading counted each of those as visible and
    // started a request for it -- measured, ~500 covers for a screen that comes
    // to rest showing forty, and a play/pause pressed a second and a half later
    // waiting 122ms for a connection while they drained for another eighteen.
    await page.evaluate((index) => fetch(`/api/player/play/p7/${index}`, { method: 'POST' }), FAR)
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(1_000_000)

    const rows = await settle(page)
    const asked = requestsTo(player, 'artwork').length

    // A little over one screenful is the honest bound: the destination is
    // measured rather than computed, so the list settles through a row or two.
    // Hundreds would mean the ones it flew past are being fetched as well.
    expect(asked, `${asked} artwork requests for ${rows} rows on screen`).toBeLessThan(rows * 2)
  })

  test('a cover already answered for is not asked for again', async ({ page, player }) => {
    await page.goto('/#/p7')
    await expect(page.locator('[role="row"]').first()).toBeAttached()
    await expect.poll(() => requestsTo(player, 'artwork').length).toBeGreaterThan(0)
    await page.waitForTimeout(500)

    await page.evaluate(() => document.querySelector('main').scrollBy(0, 4000))
    await settle(page)

    const seen = requestsTo(player, 'artwork').length
    player.requests.length = 0

    // Back over rows that have all been answered for once -- including the ones
    // with no cover at all, which is most of a real library and was most of the
    // traffic.
    await page.evaluate(() => document.querySelector('main').scrollTo(0, 0))
    await settle(page)

    const again = requestsTo(player, 'artwork').length
    expect(again, `${seen} covers on the way down, ${again} on the way back`).toBe(0)
  })
})
