import { expect, requestsTo, test } from './fixtures.js'

const scratchOf = (player) => player.playlists.find((entry) => entry.title.startsWith('#Jean ['))

const playedFrom = (player) => {
  const play = requestsTo(player, '/player/play/').at(-1)
  if (!play) return null
  const [, , , , plref, index] = play.path.split('/')
  return { plref, index: Number(index) }
}

// What the player was actually told to play, resolved through the playlist it
// was told to play it from. The whole class of bug here is that a position and
// a track agree on a number and disagree on a song, so nothing short of
// resolving it says anything.
const trackPlayed = (player) => {
  const at = playedFrom(player)
  if (!at) return null
  const playlist = player.playlists.find((entry) => entry.id === at.plref)
  return playlist?.items[at.index]?.['%title%'] ?? null
}

const row = (page, index) => page.locator(`[role="row"][data-row="${index}"]`)

// Two of these are about *how* the library source fills a playlist, and the
// autoplaylist fallback does not fill one that way: `items/copy` hands the
// player indices into a playlist it already has, so there is no body to
// outgrow and no order to put back. The behaviour either source has to get
// right -- the row you click is the row that plays -- is asserted for both.
const libraryApiOnly = () =>
  test.skip(
    Boolean(process.env.JEAN_NO_LIBRARY_API),
    'the autoplaylist fallback copies by index, so neither the size limit nor the sort applies',
  )

test.describe('playing from all music', () => {
  // Big enough that the set cannot be named in one request: 30,441 tracks as
  // explicit {path, subsong} is a 2.9 MB body and beefweb hangs up over 1 MiB,
  // which is exactly why All Music could not play anything at all. The
  // synthesised tracks also sit in a different order by tag than by path, which
  // is the second half of it -- see `browseOrder` in the fake.
  test.use({ mediaLibrarySize: 30441, settings: { 'jean.heatIntroSeen': true } })

  test('the whole library is asked for, not named track by track', async ({ page, player }) => {
    libraryApiOnly()
    await page.goto('/#/all')
    await expect(page.getByRole('heading', { level: 1, name: 'All music' })).toBeVisible()
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '30441')

    await row(page, 0).dblclick()
    await expect.poll(() => scratchOf(player)?.items.length ?? 0).toBe(30441)

    // One request carrying no `items` at all, which is how the API says "the
    // whole library". Naming them is both too big to send and ~1.2 ms a track
    // to resolve, so a regression here is either a dead button or a
    // thirty-second wait, depending on which limit it hits first.
    const adds = requestsTo(player, 'add-from-library')
    expect(adds.length).toBe(1)
    expect(adds[0].body?.items).toBeUndefined()
    expect(adds[0].body?.replace).toBe(true)
  })

  test('the row you click is the row that plays', async ({ page, player }) => {
    await page.goto('/#/all')
    await expect(page.getByRole('heading', { level: 1, name: 'All music' })).toBeVisible()

    // Not row 0. A set comes back in the player's own browse order, which
    // agrees with the path order Jean shows often enough that the first row
    // proves nothing.
    await row(page, 12).dblclick()
    await expect.poll(() => playedFrom(player)?.plref).toBe(scratchOf(player)?.id)
    await expect(row(page, 12)).toContainText(trackPlayed(player))
  })
})

test.describe('the order a set is played in', () => {
  test.use({ mediaLibrarySize: 4000, settings: { 'jean.heatIntroSeen': true } })

  // A named set rather than a wholesale one, so this covers the other half of
  // `fill`: chunked adds followed by the same sort.
  test('a search result plays the result that was clicked', async ({ page, player }) => {
    await page.goto('/#/search')
    await page.getByRole('searchbox').fill('nutshell')
    await expect.poll(() => page.locator('[role="row"]').count()).toBeGreaterThan(10)

    await row(page, 7).dblclick()
    await expect.poll(() => playedFrom(player)?.plref).toBe(scratchOf(player)?.id)
    await expect(row(page, 7)).toContainText(trackPlayed(player))
  })

  test('the playlist is left in the order the view shows, whatever the player did', async ({
    page,
    player,
  }) => {
    libraryApiOnly()
    await page.goto('/#/all')
    await expect(page.getByRole('heading', { level: 1, name: 'All music' })).toBeVisible()
    await row(page, 0).dblclick()

    // Polled on the sort, not on the item count: the add lands first and the
    // sort a round trip later, so asserting on the contents the moment they
    // arrive reads the playlist half way through being filled.
    await expect.poll(() => requestsTo(player, 'items/sort').length).toBe(1)
    expect(scratchOf(player).items.length).toBe(4000)

    // Sorted by the same expression the library is read with. Without it the
    // playlist holds the right tracks in the wrong places, and every position
    // Jean computes addresses somebody else's song.
    expect(requestsTo(player, 'items/sort')[0].body?.by).toBe('%path%')

    const held = scratchOf(player).items.map((track) => track['%path%'].replace(/\\/g, '/'))
    expect(held).toEqual([...held].sort((a, b) => a.localeCompare(b)))
  })
})
