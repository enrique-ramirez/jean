import {
  expect,
  openLibrary,
  openSidebar,
  pressAndHold,
  sidebar,
  test,
  trackRow,
} from './fixtures.js'

// `ui/ActionMenu.jsx` is the only menu surface in the app, and it is one
// component with two shapes: a popover at the pointer on a desktop viewport, an
// action sheet on a compact one. Both projects run this file, so every
// assertion below is made against both -- which is the point, because the
// gestures, the keyboard and the nested pages are the same declared data drawn
// two different ways.
//
// Driven through the track menu, which is the one that has everything: a nested
// page, a typed filter, and a list long enough to filter.

const menuItem = (page, name) => page.getByRole('menuitem', { name })

const openTrackMenu = async (page, isMobile) => {
  const row = trackRow(page, 0)
  if (isMobile) await pressAndHold(page, row)
  else await row.click({ button: 'right' })
  await expect(menuItem(page, 'Add to playlist')).toBeVisible()
}

const openTargets = async (page, isMobile) => {
  await openTrackMenu(page, isMobile)
  await menuItem(page, 'Add to playlist').click()
  await expect(menuItem(page, 'Favorites')).toBeVisible()
}

const filterField = (page) => page.getByRole('textbox', { name: 'Find a playlist' })

test.describe('the menu names what it is about', () => {
  test('a single row is headed by the track', async ({ page, isMobile }) => {
    await openLibrary(page)
    await openTrackMenu(page, isMobile)

    // The header is what makes a menu opened by a gesture safe to act on: on a
    // phone the sheet covers the row it was summoned from, so without it there
    // is nothing on screen saying which track is about to be filed. Scoped to
    // the menu, because the row it names is on screen behind it.
    const menu = page.locator('body > div').filter({ has: menuItem(page, 'Add to playlist') })
    await expect(menu).toContainText('Los Calientes')
    await expect(menu).toContainText('Babasónicos')
  })

  test('a selection is headed by its size instead', async ({ page, isMobile }) => {
    test.skip(isMobile, 'building a selection needs Shift and the arrows')

    await openLibrary(page)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(page.locator('[role="row"][data-selected="true"]')).toHaveCount(3)

    await openTrackMenu(page, isMobile)
    await expect(page.getByText('3 tracks')).toBeVisible()
  })
})

test.describe('a nested page', () => {
  test('it slides in place and steps back where it came from', async ({ page, isMobile }) => {
    await openLibrary(page)
    await openTrackMenu(page, isMobile)

    // In place on both surfaces rather than a flyout on one of them: a flyout
    // that closes when the pointer strays is the wrong place to put a
    // confirmation, and one drill-in beats two half-tested ones. The page it
    // came from stays in the panel, inert and slid aside, which is what the
    // back button is named after.
    const back = page.getByRole('button', { name: 'Add to playlist' })
    await expect(back).toHaveCount(0)

    await menuItem(page, 'Add to playlist').click()
    await expect(menuItem(page, 'Favorites')).toBeVisible()
    await expect(back).toBeVisible()

    await back.click()
    await expect(back).toHaveCount(0)
    await expect(menuItem(page, 'Add to playlist')).toBeVisible()
  })

  test('it offers the playlists you can file into, and no others', async ({ page, isMobile }) => {
    await openLibrary(page)
    await openTargets(page, isMobile)

    // Not the one you are already in, and not Jean's own -- filing a track into
    // the scratch would put it somewhere the next search empties.
    await expect(menuItem(page, 'Favorites')).toBeVisible()
    await expect(menuItem(page, 'Rock en Español')).toBeVisible()
    await expect(menuItem(page, /^Library$/)).toHaveCount(0)
    await expect(menuItem(page, /#Jean/)).toHaveCount(0)
  })
})

test.describe('typing at a menu', () => {
  test('it narrows the page, through the same matching as everything else', async ({
    page,
    isMobile,
  }) => {
    await openLibrary(page)
    await openTargets(page, isMobile)

    // Accents and all: the filter goes through the same fold() the library
    // search and the finder use, so typing at a menu behaves like typing at the
    // search field rather than like a different product in the same window.
    await filterField(page).fill('espanol')

    await expect(menuItem(page, 'Rock en Español')).toBeVisible()
    await expect(menuItem(page, 'Favorites')).toHaveCount(0)
  })

  test('it says so when nothing matches, rather than emptying the page', async ({
    page,
    isMobile,
  }) => {
    await openLibrary(page)
    await openTargets(page, isMobile)

    await filterField(page).fill('zzzz')
    await expect(page.getByText('Nothing matches that.')).toBeVisible()
  })

  test('Enter takes the first match, without reaching for the arrows', async ({
    page,
    isMobile,
    player,
  }) => {
    test.skip(isMobile, 'there is no Enter key on the phone')

    await openLibrary(page)
    await openTargets(page, isMobile)

    await filterField(page).fill('fav')
    await filterField(page).press('Enter')

    await expect(page.getByRole('status')).toContainText('Favorites')
    await expect
      .poll(() => player.playlists.find((entry) => entry.title === 'Favorites').items.length)
      .toBe(8)
  })

  test('the field takes focus on a pointer and waits to be tapped on touch', async ({
    page,
    isMobile,
  }) => {
    await openLibrary(page)
    await openTargets(page, isMobile)

    // Most opens of this menu are scroll-and-tap, and on a phone a field that
    // takes focus on open costs half the screen to a keyboard nobody asked for.
    // Where a keyboard is already there, not focusing it is a wasted keystroke.
    if (isMobile) await expect(filterField(page)).not.toBeFocused()
    else await expect(filterField(page)).toBeFocused()
  })
})

test.describe('while a menu is open', () => {
  test('no key belongs to the app behind it', async ({ page, isMobile, player }) => {
    test.skip(isMobile, 'these are keyboard events')

    await openLibrary(page)
    await openTrackMenu(page, isMobile)

    // Without stopping propagation the arrows seek the player while you are
    // choosing an action, and the space bar toggles playback while you are
    // typing a playlist name.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')

    expect(player.requests.filter((entry) => entry.path.startsWith('/api/player'))).toEqual([])
  })

  test('Escape closes it and does nothing else', async ({ page, isMobile }) => {
    test.skip(isMobile, 'these are keyboard events')

    await openLibrary(page)
    await page.keyboard.press('ArrowDown')
    await expect(trackRow(page, 1)).toHaveAttribute('data-cursor', 'true')

    await openTrackMenu(page, isMobile)
    await page.keyboard.press('Escape')

    await expect(menuItem(page, 'Add to playlist')).toHaveCount(0)
    // The same key clears the track selection when the menu is not there, so
    // this is also the check that it did not reach past the menu.
    await expect(page.locator('[role="row"][data-selected="true"]')).toHaveCount(1)
  })
})

// The other menu surface, and the reason `menuKeys.js` exists: a dropdown you
// opened from a button you can see rather than one you summoned at the pointer.
// It used to leave every key to the app behind it, so Escape closed the panel
// and cleared the track selection in the same keystroke.
test.describe('a dropdown owns the keyboard too', () => {
  test.skip(({ isMobile }) => isMobile, 'these are keyboard events')

  const viewOptions = (page) => page.getByRole('button', { name: 'View options' })
  const columnOption = (page, name) => page.getByRole('menuitemcheckbox', { name })

  test('Escape closes it without reaching the list behind it', async ({ page }) => {
    await openLibrary(page)
    await page.keyboard.press('ArrowDown')
    await expect(trackRow(page, 1)).toHaveAttribute('data-cursor', 'true')

    await viewOptions(page).click()
    await expect(columnOption(page, 'Artwork')).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(columnOption(page, 'Artwork')).toHaveCount(0)
    // The same key clears the track selection when no menu is open, which is
    // exactly what it used to do *as well as* closing this.
    await expect(page.locator('[role="row"][data-selected="true"]')).toHaveCount(1)
  })

  test('the arrows walk its options rather than seeking the player', async ({ page, player }) => {
    await openLibrary(page)
    await viewOptions(page).click()
    await expect(columnOption(page, 'Artwork')).toBeVisible()

    // Which option is first depends on what this player can supply, so this
    // asks that the arrows land on options at all and then move between them.
    const focused = () =>
      page.evaluate(() => [
        document.activeElement.getAttribute('role'),
        document.activeElement.textContent.trim(),
      ])

    await page.keyboard.press('ArrowDown')
    const [firstRole, first] = await focused()
    expect(firstRole).toMatch(/^menuitem/)

    await page.keyboard.press('ArrowDown')
    const [secondRole, second] = await focused()
    expect(secondRole).toMatch(/^menuitem/)
    expect(second).not.toBe(first)

    // And the horizontal pair, which is what seeks the player everywhere else.
    await page.keyboard.press('ArrowRight')
    expect(player.requests.filter((entry) => entry.path.startsWith('/api/player'))).toEqual([])
  })
})

test.describe('a player that will not let Jean change playlists', () => {
  test.use({
    playerState: {
      permissions: { changePlaylists: false, changeOutput: true, changeClientConfig: true },
    },
  })

  test('the sidebar offers no edits rather than buttons that would 403', async ({ page }) => {
    await openLibrary(page)
    await openSidebar(page)

    // A read-only instance gets a read-only Jean. The playlists are still there
    // to browse -- this is a narrower app, not a broken one.
    await expect(page.getByRole('button', { name: 'New playlist' })).toHaveCount(0)
    await expect(sidebar(page).getByRole('button', { name: /Favorites/ })).toBeVisible()
  })

  test('and the row menu offers nowhere to file a track', async ({ page, isMobile }) => {
    await openLibrary(page)
    await openTrackMenu(page, isMobile)

    // Present and disabled rather than absent: the action exists, this player
    // will not have it, and saying so beats leaving a hole where it was.
    await expect(menuItem(page, 'Add to playlist')).toBeDisabled()
  })
})
