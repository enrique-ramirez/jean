import { expect, test } from './fixtures.js'

// Jean is for anybody's library, and the captured fixture is one tidy,
// mid-sized, thoroughly tagged collection. Every bug this file is about lives
// in the libraries it is *not*: four songs in a folder, one artist on repeat,
// a rip with no year tags, a fresh install with no playlists. The home header
// is where a library describes itself, so it is where assuming somebody else's
// shows first.
//
// The autoplaylist fallback reads the same synthesised library -- the fixture
// replaces both sources -- so every one of these holds either way.

const header = (page) => page.locator('main header').first()
const heading = (page) => header(page).getByRole('heading', { level: 1 })

// The figure drawn under a given noun, or null when the header does not draw
// one. Read off the pair rather than off the rail's text, so "1 album" cannot
// be satisfied by "1" appearing anywhere near the word.
const figure = async (page, noun) => {
  const label = header(page).getByText(new RegExp(`^${noun}s?$`))
  if ((await label.count()) === 0) return null
  return (await label.locator('xpath=preceding-sibling::dd').innerText()).trim()
}

const settled = async (page) => {
  await expect(heading(page)).toBeVisible()
  await expect(header(page).getByText('still counting')).toHaveCount(0)
}

test.describe('a folder of four songs', () => {
  test.use({
    libraryShape: { tracks: 4, albums: 1, artists: 1, genres: 1, seconds: 200 },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('counts in the singular where the count is one', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // Somebody trying Jean against four songs is looking hardest at this
    // screen, and "1 albums" tells them it was written for another library.
    expect(await figure(page, 'track')).toBe('4')
    expect(await figure(page, 'album')).toBe('1')
    expect(await figure(page, 'artist')).toBe('1')
    expect(await figure(page, 'genre')).toBe('1')
    await expect(header(page).getByText('album', { exact: true })).toBeVisible()
    await expect(header(page).getByText('albums', { exact: true })).toHaveCount(0)
  })

  test('measures 13 minutes in minutes, not in days', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // 800 seconds is not "0 days". The unit has to follow the collection, or
    // the one number the header leads with is the one that reads as broken.
    await expect(heading(page)).toContainText('13 minutes')
    await expect(heading(page)).not.toContainText('day')
  })
})

test.describe('one artist on repeat', () => {
  test.use({
    libraryShape: { tracks: 400, albums: 12, artists: 1, genres: 1, seconds: 210 },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('a library with no variety in it still describes itself', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    expect(await figure(page, 'track')).toBe('400')
    expect(await figure(page, 'album')).toBe('12')
    expect(await figure(page, 'artist')).toBe('1')

    // One genre at 100% is a true and slightly funny thing to say about a
    // library, and saying it is better than a bare row of numbers. Counted
    // rather than seen, because on a phone the chips are deliberately not
    // drawn -- see below.
    await expect(header(page).getByText('100%')).toHaveCount(1)
  })
})

test.describe('a wide, varied library', () => {
  test.use({
    libraryShape: {
      tracks: 6000,
      albums: 500,
      artists: 300,
      genres: 40,
      seconds: 250,
      years: [1961, 2024],
    },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('big numbers are grouped, and the span covers the whole range', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // Grouped, because 6000 is a number you read and 6,000 is a number you see.
    expect(await figure(page, 'track')).toBe('6,000')
    expect(await figure(page, 'album')).toBe('500')
    expect(await figure(page, 'artist')).toBe('300')
    expect(await figure(page, 'genre')).toBe('40')
    await expect(header(page)).toContainText('1961')
    await expect(header(page)).toContainText('2024')
  })

  test('the characterisation goes on a phone, the counts stay', async ({ page }, testInfo) => {
    await page.goto('/')
    await settled(page)

    // The shelves stack close enough on a phone that another band of text above
    // them turns the screen into more reading than looking -- the same call the
    // shelf blurbs make. The counts stay, because they are why this header
    // exists; the genre chips go.
    const chips = header(page).getByText(/^\d+%$/).first()
    const onPhone = testInfo.project.name === 'mobile'
    await expect(chips).toBeVisible({ visible: !onPhone })
    await expect(header(page).getByText('tracks', { exact: true })).toBeVisible()
  })

  test('only the four biggest genres are named, however many there are', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // Forty chips would be the whole screen. The rail says how many there are;
    // the chips say which ones you would recognise.
    // One share per chip. Counted by what a chip *is* rather than by a hashed
    // class name -- `[class*="chip"]` also matches the container they sit in.
    await expect(header(page).getByText(/^\d+%$/)).toHaveCount(4)
  })
})

test.describe('a rip with no year tags', () => {
  test.use({
    libraryShape: { tracks: 60, albums: 6, omit: ['%year%'] },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('says nothing about years rather than inventing a span', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    await expect(header(page)).not.toContainText('–')
    expect(await figure(page, 'album')).toBe('6')
  })
})

test.describe('a library the player reports no durations for', () => {
  test.use({
    libraryShape: { tracks: 60, albums: 6, omit: ['%length_seconds%'] },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('falls back to naming itself rather than claiming zero', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // The headline is the one thing that cannot be dropped -- something has to
    // be the h1 -- so this is the one figure with a fallback rather than an
    // absence.
    await expect(heading(page)).toHaveText('Your library')
    expect(await figure(page, 'track')).toBe('60')
  })
})

test.describe('a library with no album or genre tags at all', () => {
  test.use({
    libraryShape: { tracks: 40, omit: ['%album%', '%genre%'] },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('draws the figures it can fill and no others', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // Zero albums is not "a library without albums", it is "Jean cannot tell",
    // and either way a nought in the rail is an absence dressed as a fact.
    expect(await figure(page, 'track')).toBe('40')
    expect(await figure(page, 'album')).toBeNull()
    expect(await figure(page, 'genre')).toBeNull()
    expect(await figure(page, 'artist')).toBeNull()
    await expect(header(page).getByText(/^\d+%$/)).toHaveCount(0)
  })
})

test.describe('a fresh install with no playlists', () => {
  test.use({
    withoutPlaylists: true,
    libraryShape: { tracks: 40, albums: 4 },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('the playlists figure goes rather than reading nought', async ({ page }) => {
    test.skip(
      Boolean(process.env.JEAN_NO_LIBRARY_API),
      'without playlists there is no autoplaylist either, so the fallback has no library to read',
    )
    await page.goto('/')
    await settled(page)

    expect(await figure(page, 'playlist')).toBeNull()
    expect(await figure(page, 'track')).toBe('40')
  })
})

test.describe('a library two people tagged', () => {
  test.use({
    libraryShape: { tracks: 20, albums: 2, artists: 1, mixedCase: true },
    settings: { 'jean.heatIntroSeen': true },
  })

  test('one artist spelled two ways is counted once', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // `Artist 1` and `ARTIST  1` differ in case and in whitespace, which is
    // exactly the drift `sameTagValue` exists to absorb elsewhere. Two here
    // would be Jean reporting somebody's inconsistent tagging as a fact about
    // their music.
    expect(await figure(page, 'artist')).toBe('1')
    expect(await figure(page, 'album')).toBe('2')
  })
})
