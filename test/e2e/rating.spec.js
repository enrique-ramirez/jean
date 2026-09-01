import { expect, test, trackRow } from './fixtures.js'

// What a rating tag can hold, on one real library. *Measured*: 375 tracks at
// `5`, 39 at `100`, 40 at `-1` and 27 at `0` standing in for "unrated", and a
// handful of halves. Four scales written by four tools over fifteen years, and
// every install has its own mix -- so this is the shape the column has to
// survive, not a tidy 0-5 someone designed for.
// No playback-statistics component, which is what puts Rating on screen on a
// phone as well: the compact layout shows two optional columns and Rating is
// third in line behind Time and Plays. The column's own priority is
// columns.spec's business; this file is about what it draws.
test.use({
  withoutFields: ['%lastfm_play_count%'],
  retagged: {
    'Los Calientes': { '$meta(rating)': '5' },
    'Deléctrico': { '$meta(rating)': '3.5' },
    'Soy Rock': { '$meta(rating)': '3' },
    'El Loco': { '$meta(rating)': '0' },
    'La Fox': { '$meta(rating)': '-1' },
    Toxica: { '$meta(rating)': '100' },
    Sagrado: { '$meta(rating)': 'good' },
  },
})

const stars = (page, row) => trackRow(page, row).getByRole('img')

test.beforeEach(async ({ page }) => {
  await page.goto('/#/p7')
  await expect(trackRow(page, 0)).toBeAttached()
})

test('a whole rating is that many stars', async ({ page }) => {
  await expect(stars(page, 0)).toHaveAccessibleName('5 of 5 stars')
  await expect(stars(page, 3)).toHaveAccessibleName('3 of 5 stars')
})

// The tag says 3.5, so the row says 3.5. Rounding it to 4 would be Jean
// disagreeing with the player about what the library contains, which is the
// one thing tag handling here is not allowed to do.
test('a half rating stays a half', async ({ page }) => {
  await expect(stars(page, 2)).toHaveAccessibleName('3.5 of 5 stars')
})

// `0` and `-1` are how two different taggers spell "unrated", and neither is a
// bad review. `100` is a 0-100 scale, and rescaling it would be Jean inventing
// a number the file does not carry -- worse, on a library holding both scales
// at once, `5` is five stars under one reading and one star under the other,
// so there is nothing to infer from. Anything outside (0, 5] is not a rating.
test('everything that is not a rating reads as unrated', async ({ page }) => {
  for (const row of [5, 6, 7, 8]) {
    await expect(stars(page, row)).toHaveAccessibleName('Unrated')
  }
})
