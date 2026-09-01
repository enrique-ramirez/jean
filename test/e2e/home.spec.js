import { expect, requestsTo, test } from './fixtures.js'

const nav = (page) => page.getByRole('navigation', { name: 'Playlists' })
const shelf = (page, title) => page.getByRole('heading', { level: 2, name: title })
const scratchOf = (player) => player.playlists.find((entry) => entry.title.startsWith('#Jean ['))

const playedFrom = (player) => {
  const play = requestsTo(player, '/player/play/').at(-1)
  if (!play) return null
  const [, , , , plref, index] = play.path.split('/')
  return { plref, index: Number(index) }
}

const openSidebar = async (page) => {
  if (await nav(page).getByRole('button', { name: 'Home' }).isVisible()) return
  await page.getByRole('button', { name: 'Show playlists' }).click()
}

test.describe('the home screen', () => {
  test.use({ settings: { 'jean.heatIntroSeen': true } })

  test('it is where the root lands, not a playlist', async ({ page }) => {
    // Jean used to open on whichever playlist the player was on, which meant
    // the first thing you saw depended on what the desktop happened to be
    // doing. Home is a place; a playlist is a thing you go to.
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Your library' })).toBeVisible()
    await expect(shelf(page, 'Most played')).toBeVisible()
  })

  test('the sidebar reads search, home, all music, then playlists', async ({ page }) => {
    await page.goto('/')
    await openSidebar(page)

    const labels = await nav(page).getByRole('button').allInnerTexts()
    const home = labels.findIndex((entry) => entry.startsWith('Home'))
    const all = labels.findIndex((entry) => entry.startsWith('All music'))
    const firstPlaylist = labels.findIndex((entry) => entry.startsWith('Default Playlist'))

    expect(home).toBeGreaterThanOrEqual(0)
    expect(all).toBe(home + 1)
    expect(firstPlaylist).toBeGreaterThan(all)
  })

  test('a shelf says why each record is on it', async ({ page }) => {
    await page.goto('/')
    await expect(shelf(page, 'Most played')).toBeVisible()

    // The caption is the whole difference between a shelf and a query result:
    // "1,315 plays" is a reason to press play, "matches a predicate" is not.
    await expect(page.getByText(/[\d,]+ plays$/).first()).toBeVisible()
  })
})

test.describe('all music', () => {
  test.use({ settings: { 'jean.heatIntroSeen': true } })

  test('it is the library with no filter on it', async ({ page }) => {
    await page.goto('/#/all')
    await expect(page.getByRole('heading', { level: 1, name: 'All music' })).toBeVisible()
    // Every track the library holds, which is the whole point of the view.
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '54')
  })
})

test.describe('playing from a shelf', () => {
  test.use({ settings: { 'jean.heatIntroSeen': true } })

  test('it plays the whole row, starting at the album you clicked', async ({ page, player }) => {
    await page.goto('/')
    await expect(shelf(page, 'Most played')).toBeVisible()
    expect(scratchOf(player)).toBeUndefined()

    // Jessico is not first on this shelf, so this also proves the click starts
    // where it was aimed rather than at the top of the row.
    await page
      .getByRole('region', { name: 'Most played' })
      .getByRole('button', { name: /^Jessico/ })
      .click()

    // Polled on the contents, not the title: the playlist is named when it is
    // created and filled a round trip later, so a title assertion passes while
    // it is still empty.
    //
    // The row, not the album. Playing one record and stopping would make every
    // shelf twenty dead ends -- the point is that what follows the album is the
    // next album on the shelf.
    await expect.poll(() => scratchOf(player)?.items.length ?? 0).toBeGreaterThan(12)
    const scratch = scratchOf(player)
    expect(scratch.title).toBe('#Jean [shelf: Most played]')
    await expect.poll(() => playedFrom(player)?.plref).toBe(scratch.id)
    expect(scratch.items[playedFrom(player).index]['%title%']).toBe('Los Calientes')

    // And it opens the shelf under its own name, with the playing row marked.
    await expect(page.getByRole('heading', { level: 1, name: 'Most played' })).toBeVisible()
    await expect(page.locator('[role="row"][data-active="true"]')).toContainText('Los Calientes')
  })
})

test.describe('an install with no play counts', () => {
  // Most shelves are built out of play data. On a player without it they must
  // disappear rather than render empty -- a bare install gets a coherent app,
  // never a dead shelf.
  test.use({ withoutFields: ['%lastfm_play_count%', '%lastfm_last_played%'], settings: {} })

  test('the shelves that need them are simply not there', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Your library' })).toBeVisible()

    await expect(shelf(page, 'Most played')).toHaveCount(0)
    await expect(shelf(page, 'Recently played')).toHaveCount(0)
    await expect(shelf(page, 'You used to love this')).toHaveCount(0)
  })
})

test.describe('where you are, in the sidebar', () => {
  test.use({ settings: { 'jean.heatIntroSeen': true } })

  const current = (page) => nav(page).locator('[aria-current="true"]')

  test('a library route does not also light up a playlist', async ({ page }) => {
    // `selectedId` falls back to the remembered or current playlist so that
    // leaving the search has somewhere to return to. Passed to the sidebar
    // unconditionally, that lit Default Playlist up while Home was open -- two
    // rows claiming to be where you are.
    await page.goto('/')
    await openSidebar(page)
    await expect(current(page)).toHaveCount(1)
    await expect(current(page)).toContainText('Home')

    await nav(page).getByRole('button', { name: 'All music' }).click()
    await openSidebar(page)
    await expect(current(page)).toHaveCount(1)
    await expect(current(page)).toContainText('All music')

    // And a playlist route still marks its playlist.
    await page.goto('/#/p5')
    await openSidebar(page)
    await expect(current(page)).toHaveCount(1)
    await expect(current(page)).toContainText('Rock en Español')
  })
})
