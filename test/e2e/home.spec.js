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
    await expect(page.getByRole('heading', { level: 1, name: /of music/ })).toBeVisible()
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

test.describe('the library header', () => {
  test.use({ settings: { 'jean.heatIntroSeen': true } })

  test('it leads with the time, and counts underneath', async ({ page }) => {
    await page.goto('/')

    // The claim, then its evidence. 30,441 is a number; "85 days of music" is
    // a feeling, and the feeling is what a front door is for.
    const header = page.locator('main header').first()
    await expect(header.getByRole('heading', { level: 1 })).toContainText('of music')
    // Uppercased in CSS, so the text itself is still sentence case.
    await expect(header).toContainText('Your library')

    for (const label of ['tracks', 'albums', 'artists', 'genres', 'playlists']) {
      await expect(header.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('the counts are of the user\'s music, not of Jean\'s plumbing', async ({ page, player }) => {
    await page.goto('/')
    const header = page.locator('main header').first()
    await expect(header.getByRole('heading', { level: 1 })).toBeVisible()

    // `#Jean Library` is Jean's, and so is any scratch. Counting them here
    // would make this header disagree with the sidebar two centimetres to its
    // left, which lists neither.
    const mine = player.playlists.filter((entry) => !entry.title.startsWith('#Jean'))
    await expect(header).toContainText(String(mine.length))
    expect(player.playlists.length).toBeGreaterThan(mine.length)
  })

  test('a figure the player cannot answer for is not drawn', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main header').first().getByText('genres', { exact: true })).toBeVisible()
  })
})

test.describe('a library with no genre tag', () => {
  test.use({ withoutFields: ['%genre%'], settings: { 'jean.heatIntroSeen': true } })

  test('says nothing about genres rather than saying zero', async ({ page }) => {
    await page.goto('/')
    const header = page.locator('main header').first()
    await expect(header.getByRole('heading', { level: 1 })).toBeVisible()

    // The rule the shelves already follow: a claim needs the data behind it, and
    // "0 genres" is not "this library has no genres", it is "Jean cannot tell".
    await expect(header.getByText('genres', { exact: true })).toHaveCount(0)
    await expect(header.getByText('tracks', { exact: true })).toBeVisible()
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

test.describe('opening a shelf from its heading', () => {
  test.use({ settings: { 'jean.heatIntroSeen': true } })

  test('the title opens the shelf and starts nothing', async ({ page, player }) => {
    await page.goto('/')
    await expect(shelf(page, 'Most played')).toBeVisible()

    await page.getByRole('link', { name: 'Most played' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Most played' })).toBeVisible()

    // Browsing writes nothing and plays nothing. Opening a shelf to look at it
    // must not take the scratch playlist off whatever is already in it, and
    // must not interrupt what is playing -- that separation is the whole reason
    // the scratch holds the last set you *chose*.
    expect(scratchOf(player)).toBeUndefined()
    expect(requestsTo(player, '/player/play/')).toHaveLength(0)
    expect(player.player.playbackState).toBe('stopped')
  })

  test('it leaves what is already playing alone', async ({ page, player }) => {
    await page.goto('/')
    await expect(shelf(page, 'Most played')).toBeVisible()
    await page
      .getByRole('region', { name: 'Most played' })
      .getByRole('button', { name: /^Jessico/ })
      .click()
    // Polled on playback, not on the fill: the playlist is written first and
    // played a round trip later, so reading the active item the moment the
    // items land reads -1 and compares nothing to nothing.
    await expect.poll(() => player.player.activeItem.index).toBeGreaterThanOrEqual(0)

    const playing = player.player.activeItem.index
    await page.goto('/')
    await expect(shelf(page, 'Recently played')).toBeVisible()
    await page.getByRole('link', { name: 'Recently played' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Recently played' })).toBeVisible()

    // A different shelf, opened. The one being listened to is untouched.
    expect(scratchOf(player).title).toBe('#Jean [shelf: Most played]')
    expect(player.player.activeItem.index).toBe(playing)
  })

  test('the blurb under it is not a target', async ({ page }) => {
    await page.goto('/')
    await expect(shelf(page, 'Most played')).toBeVisible()
    const link = page.getByRole('link', { name: 'Most played' })
    await expect(link).toBeVisible()
    // The sentence explains why the records are there. Only the heading opens.
    await expect(page.getByRole('link', { name: /Where you have been lately/ })).toHaveCount(0)
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
    await expect(page.getByRole('heading', { level: 1, name: /of music/ })).toBeVisible()

    await expect(shelf(page, 'Most played')).toHaveCount(0)
    await expect(shelf(page, 'Recently played')).toHaveCount(0)
    await expect(shelf(page, 'You used to love this')).toHaveCount(0)
  })

  test('and the screen still opens on something to press', async ({ page }) => {
    await page.goto('/')

    // Every other shelf is built out of listening history, so a player with no
    // playback statistics would otherwise get a heading and nothing under it.
    // One row drawn at random needs no history at all, and every install has a
    // library -- an apology is not a home screen.
    await expect(shelf(page, 'Start somewhere')).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Start somewhere' }).getByRole('button').first(),
    ).toBeVisible()
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

test.describe('a shelf says it is playing', () => {
  test.use({ settings: { 'jean.heatIntroSeen': true } })

  test('it appears in the sidebar and in the status bar, and survives leaving it', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(shelf(page, 'Most played')).toBeVisible()

    // Nothing before it is played: the row only exists while the shelf is the
    // thing playing. Checked without opening the drawer -- on a phone that
    // would cover the very card the next line clicks.
    await expect(nav(page).getByRole('button', { name: 'Most played' })).toHaveCount(0)

    await page
      .getByRole('region', { name: 'Most played' })
      .getByRole('button', { name: /^Jessico/ })
      .click()

    await openSidebar(page)
    const row = nav(page).getByRole('button', { name: /Most played/ })
    await expect(row).toBeVisible()
    await expect(row.getByLabel('Playing from here')).toBeVisible()
    await expect(page.locator('footer')).toContainText('from')
    await expect(page.locator('footer')).toContainText('Most played')

    // Browsing away does not move playback, so the row and the status line stay
    // -- that is the whole point of separating what you are looking at from what
    // you are listening to.
    await page.goto('/#/p5')
    await expect(page.getByRole('heading', { level: 1, name: 'Rock en Español' })).toBeVisible()
    await openSidebar(page)
    await expect(nav(page).getByRole('button', { name: /Most played/ })).toBeVisible()
    await expect(page.locator('footer')).toContainText('Most played')
  })
})
