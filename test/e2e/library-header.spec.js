import { expect, test, viewHeader } from './fixtures.js'

// Jean is for anybody's library, and the captured fixture is one tidy,
// mid-sized, thoroughly tagged collection. Every bug this file is about lives
// in the libraries it is *not*: four songs in a folder, one artist on repeat,
// a rip with no year tags, a fresh install with no playlists. The home header
// is where a library describes itself, so it is where assuming somebody else's
// shows first.
//
// The autoplaylist fallback reads the same synthesised library -- the fixture
// replaces both sources -- so every one of these holds either way.

const heading = (page) => viewHeader(page).getByRole('heading', { level: 1 })

// The figure drawn under a given noun, or null when the header does not draw
// one. Read off the pair rather than off the rail's text, so "1 album" cannot
// be satisfied by "1" appearing anywhere near the word.
const figure = async (page, noun) => {
  const label = viewHeader(page).getByText(new RegExp(`^${noun}s?$`))
  if ((await label.count()) === 0) return null
  return (await label.locator('xpath=preceding-sibling::dd').innerText()).trim()
}

const settled = async (page) => {
  await expect(heading(page)).toBeVisible()
  await expect(viewHeader(page).getByText('still counting')).toHaveCount(0)
}

test.describe('a folder of four songs', () => {
  test.use({
    libraryShape: { tracks: 4, albums: 1, artists: 1, genres: 1, seconds: 200 },
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
    await expect(viewHeader(page).getByText('album', { exact: true })).toBeVisible()
    await expect(viewHeader(page).getByText('albums', { exact: true })).toHaveCount(0)
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
    await expect(viewHeader(page).getByText('100%')).toHaveCount(1)
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
  })

  test('big numbers are grouped, and the span covers the whole range', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // Grouped, because 6000 is a number you read and 6,000 is a number you see.
    expect(await figure(page, 'track')).toBe('6,000')
    expect(await figure(page, 'album')).toBe('500')
    expect(await figure(page, 'artist')).toBe('300')
    expect(await figure(page, 'genre')).toBe('40')
    await expect(viewHeader(page)).toContainText('1961')
    await expect(viewHeader(page)).toContainText('2024')
  })

  test('the characterisation goes on a phone, the counts stay', async ({ page }, testInfo) => {
    await page.goto('/')
    await settled(page)

    // The shelves stack close enough on a phone that another band of text above
    // them turns the screen into more reading than looking -- the same call the
    // shelf blurbs make. The counts stay, because they are why this header
    // exists; the genre chips go.
    const chips = viewHeader(page).getByText(/^\d+%$/).first()
    const onPhone = testInfo.project.name === 'mobile'
    await expect(chips).toBeVisible({ visible: !onPhone })
    await expect(viewHeader(page).getByText('tracks', { exact: true })).toBeVisible()
  })

  // The rail is one line at every width, and below the breakpoint it scrolls
  // rather than wrapping. Two lines of figures read as two statements about the
  // library instead of one, and the short second line -- two figures and three
  // columns of nothing -- looks like the row failed to fill rather than like it
  // ended. Asserted off the geometry, because that is the only thing that
  // notices; every count is still correct when the rail is stacked in two.
  test('the figures stay on one line, and scroll if they must', async ({ page }, testInfo) => {
    await page.goto('/')
    await settled(page)

    const rail = viewHeader(page).locator('dl')
    const shape = await rail.evaluate((el) => ({
      lines: new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
      overflows: el.scrollWidth > el.clientWidth,
      // Full-bleed, so what is cut is cut by the edge of the screen. Clipped at
      // the gutter it reads as drawn too wide; clipped at the glass it reads as
      // continuing.
      spansViewport: el.clientWidth === document.documentElement.clientWidth,
      // And it must scroll *itself*. A rail that pushes the document sideways
      // takes the whole app with it.
      pushesDocument: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }))

    expect(shape.lines).toBe(1)
    expect(shape.pushesDocument).toBe(false)
    if (testInfo.project.name === 'mobile') {
      expect(shape.overflows).toBe(true)
      expect(shape.spansViewport).toBe(true)
    }
  })

  test('only the four biggest genres are named, however many there are', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    // Forty chips would be the whole screen. The rail says how many there are;
    // the chips say which ones you would recognise.
    // One share per chip. Counted by what a chip *is* rather than by a hashed
    // class name -- `[class*="chip"]` also matches the container they sit in.
    await expect(viewHeader(page).getByText(/^\d+%$/)).toHaveCount(4)
  })
})

test.describe('a rip with no year tags', () => {
  test.use({
    libraryShape: { tracks: 60, albums: 6, omit: ['%year%'] },
  })

  test('says nothing about years rather than inventing a span', async ({ page }) => {
    await page.goto('/')
    await settled(page)

    await expect(viewHeader(page)).not.toContainText('–')
    expect(await figure(page, 'album')).toBe('6')
  })
})

test.describe('a library the player reports no durations for', () => {
  test.use({
    libraryShape: { tracks: 60, albums: 6, omit: ['%length_seconds%'] },
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
    await expect(viewHeader(page).getByText(/^\d+%$/)).toHaveCount(0)
  })
})

test.describe('a fresh install with no playlists', () => {
  test.use({
    withoutPlaylists: true,
    libraryShape: { tracks: 40, albums: 4 },
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
